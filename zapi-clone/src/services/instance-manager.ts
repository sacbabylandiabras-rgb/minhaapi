import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
  proto,
  delay,
} from 'baileys'
import { Boom } from '@hapi/boom'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import { prisma } from './prisma'
import { config } from '../config'
import { logger } from '../utils/logger'
import { webhookQueue } from '../queues/webhook.queue'
import { WebhookEvent } from '../types'

interface InstanceState {
  socket: WASocket | null
  qrCode: string | null
  qrCodeBase64: string | null
  status: 'DISCONNECTED' | 'CONNECTING' | 'QR_CODE' | 'CONNECTED'
  retryCount: number
}

class WhatsAppInstanceManager {
  private instances: Map<string, InstanceState> = new Map()

  private getSessionDir(instanceId: string): string {
    return path.join(config.sessions.dir, instanceId)
  }

  async createInstance(instanceId: string, instanceName: string): Promise<void> {
    if (this.instances.has(instanceId)) {
      logger.warn({ instanceId }, 'Instance already exists in memory')
      return
    }

    logger.info({ instanceId, instanceName }, 'Creating WhatsApp instance')

    const state: InstanceState = {
      socket: null,
      qrCode: null,
      qrCodeBase64: null,
      status: 'CONNECTING',
      retryCount: 0,
    }

    this.instances.set(instanceId, state)
    await this.connect(instanceId, instanceName)
  }

  private async connect(instanceId: string, instanceName: string): Promise<void> {
    const state = this.instances.get(instanceId)
    if (!state) return

    const sessionDir = this.getSessionDir(instanceId)

    if (!existsSync(sessionDir)) {
      await mkdir(sessionDir, { recursive: true })
    }

    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir)
    const { version } = await fetchLatestBaileysVersion()

    logger.info({ instanceId, version }, 'Connecting with Baileys version')

    const socket = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      logger: logger.child({ instanceId }) as any,
      browser: ['ZAPI', 'Chrome', '10.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
    })

    state.socket = socket

    // ── Connection updates ──────────────────────────────────────────────────
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        logger.info({ instanceId }, 'QR Code generated')
        state.qrCode = qr
        state.qrCodeBase64 = await QRCode.toDataURL(qr)
        state.status = 'QR_CODE'

        await prisma.instance.update({
          where: { id: instanceId },
          data: { status: 'QR_CODE' },
        })

        await this.emitWebhook(instanceId, instanceName, 'qr.updated', {
          qrCode: state.qrCodeBase64,
        })
      }

      if (connection === 'open') {
        logger.info({ instanceId }, 'WhatsApp connected!')
        state.status = 'CONNECTED'
        state.qrCode = null
        state.qrCodeBase64 = null
        state.retryCount = 0

        const jid = socket.user?.id || ''
        const phone = jid.split(':')[0].split('@')[0]
        const profileName = socket.user?.name || null

        await prisma.instance.update({
          where: { id: instanceId },
          data: { status: 'CONNECTED', phone, profileName },
        })

        await this.emitWebhook(instanceId, instanceName, 'connection.update', {
          status: 'CONNECTED',
          phone,
          profileName,
        })
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        logger.warn({ instanceId, statusCode, shouldReconnect }, 'Connection closed')

        state.status = 'DISCONNECTED'
        state.socket = null

        await prisma.instance.update({
          where: { id: instanceId },
          data: { status: 'DISCONNECTED', phone: null },
        })

        await this.emitWebhook(instanceId, instanceName, 'connection.update', {
          status: 'DISCONNECTED',
          statusCode,
        })

        if (shouldReconnect && state.retryCount < 5) {
          state.retryCount++
          const retryDelay = Math.min(state.retryCount * 3000, 15000)
          logger.info({ instanceId, retryCount: state.retryCount, retryDelay }, 'Reconnecting...')
          setTimeout(() => this.connect(instanceId, instanceName), retryDelay)
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.warn({ instanceId }, 'Logged out — clearing session')
          await this.clearSession(instanceId)
        }
      }
    })

    // ── Save credentials ────────────────────────────────────────────────────
    socket.ev.on('creds.update', saveCreds)

    // ── Incoming messages ───────────────────────────────────────────────────
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const message of messages) {
        if (!message.message) continue

        const isFromMe = message.key.fromMe ?? false
        const remoteJid = message.key.remoteJid ?? ''

        logger.debug({ instanceId, remoteJid, isFromMe }, 'Message received')

        const messageData = this.extractMessageContent(message)

        await prisma.message.create({
          data: {
            instanceId,
            remoteJid,
            messageId: message.key.id ?? '',
            fromMe: isFromMe,
            type: messageData.type,
            content: messageData as any,
            status: isFromMe ? 'SENT' : 'DELIVERED',
          },
        })

        await this.emitWebhook(instanceId, instanceName, 'message.received', {
          key: message.key,
          pushName: message.pushName,
          message: messageData,
          messageTimestamp: message.messageTimestamp,
        })
      }
    })

    // ── Message ACK ─────────────────────────────────────────────────────────
    socket.ev.on('message-receipt.update', async (updates) => {
      for (const update of updates) {
        await this.emitWebhook(instanceId, instanceName, 'message.ack', {
          key: update.key,
          receipt: update.receipt,
        })
      }
    })
  }

  // ── Send methods ──────────────────────────────────────────────────────────

  async sendText(instanceId: string, to: string, text: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, { text })
    return result!
  }

  async sendImage(instanceId: string, to: string, url: string, caption?: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, { image: { url }, caption })
    return result!
  }

  async sendVideo(instanceId: string, to: string, url: string, caption?: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, { video: { url }, caption })
    return result!
  }

  async sendAudio(instanceId: string, to: string, url: string, ptt = false): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, { audio: { url }, ptt })
    return result!
  }

  async sendDocument(instanceId: string, to: string, url: string, fileName: string, mimetype: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, { document: { url }, fileName, mimetype })
    return result!
  }

  async sendLocation(instanceId: string, to: string, lat: number, lon: number, name?: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, {
      location: { degreesLatitude: lat, degreesLongitude: lon, name },
    })
    return result!
  }

  async sendReaction(instanceId: string, to: string, messageId: string, emoji: string): Promise<proto.WebMessageInfo> {
    const socket = this.getSocket(instanceId)
    const result = await socket.sendMessage(to, {
      react: { text: emoji, key: { remoteJid: to, id: messageId } },
    })
    return result!
  }

  async markAsRead(instanceId: string, to: string, messageId: string): Promise<void> {
    const socket = this.getSocket(instanceId)
    await socket.readMessages([{ remoteJid: to, id: messageId, fromMe: false }])
  }

  async setPresence(instanceId: string, to: string, presence: 'composing' | 'recording' | 'paused'): Promise<void> {
    const socket = this.getSocket(instanceId)
    await socket.sendPresenceUpdate(presence, to)
  }

  async getProfilePicture(instanceId: string, jid: string): Promise<string | null> {
    const socket = this.getSocket(instanceId)
    try {
      return (await socket.profilePictureUrl(jid, 'image')) ?? null
    } catch {
      return null
    }
  }

  async checkNumberExists(instanceId: string, jid: string): Promise<boolean> {
    const socket = this.getSocket(instanceId)
    const [result] = await socket.onWhatsApp(jid)
    return result?.exists ?? false
  }

  // ── Instance lifecycle ────────────────────────────────────────────────────

  async disconnectInstance(instanceId: string): Promise<void> {
    const state = this.instances.get(instanceId)
    if (!state?.socket) return
    await state.socket.logout()
    state.socket = null
    state.status = 'DISCONNECTED'
  }

  async restartInstance(instanceId: string, instanceName: string): Promise<void> {
    await this.disconnectInstance(instanceId)
    this.instances.delete(instanceId)
    await delay(1000)
    await this.createInstance(instanceId, instanceName)
  }

  getQRCode(instanceId: string): { qrCode: string | null; qrCodeBase64: string | null } {
    const state = this.instances.get(instanceId)
    return {
      qrCode: state?.qrCode ?? null,
      qrCodeBase64: state?.qrCodeBase64 ?? null,
    }
  }

  getStatus(instanceId: string): string {
    return this.instances.get(instanceId)?.status ?? 'DISCONNECTED'
  }

  isConnected(instanceId: string): boolean {
    return this.instances.get(instanceId)?.status === 'CONNECTED'
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getSocket(instanceId: string): WASocket {
    const state = this.instances.get(instanceId)
    if (!state?.socket || state.status !== 'CONNECTED') {
      throw new Error(`Instance ${instanceId} is not connected`)
    }
    return state.socket
  }

  private async clearSession(instanceId: string): Promise<void> {
    const { rm } = await import('fs/promises')
    const sessionDir = this.getSessionDir(instanceId)
    if (existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true })
    }
  }

  private extractMessageContent(message: proto.IWebMessageInfo): Record<string, any> {
    const msg = message.message

    if (msg?.conversation || msg?.extendedTextMessage) {
      return { type: 'text', text: msg.conversation || msg.extendedTextMessage?.text || '' }
    }
    if (msg?.imageMessage) {
      return { type: 'image', caption: msg.imageMessage.caption || '', mimetype: msg.imageMessage.mimetype || 'image/jpeg' }
    }
    if (msg?.videoMessage) {
      return { type: 'video', caption: msg.videoMessage.caption || '', mimetype: msg.videoMessage.mimetype || 'video/mp4' }
    }
    if (msg?.audioMessage) {
      return { type: 'audio', ptt: msg.audioMessage.ptt || false, mimetype: msg.audioMessage.mimetype || 'audio/ogg' }
    }
    if (msg?.documentMessage) {
      return { type: 'document', fileName: msg.documentMessage.fileName || '', mimetype: msg.documentMessage.mimetype || 'application/octet-stream' }
    }
    if (msg?.locationMessage) {
      return { type: 'location', lat: msg.locationMessage.degreesLatitude, lon: msg.locationMessage.degreesLongitude, name: msg.locationMessage.name }
    }
    if (msg?.contactMessage) {
      return { type: 'contact', displayName: msg.contactMessage.displayName, vcard: msg.contactMessage.vcard }
    }
    if (msg?.reactionMessage) {
      return { type: 'reaction', text: msg.reactionMessage.text, key: msg.reactionMessage.key }
    }

    return { type: 'unknown', raw: msg }
  }

  private async emitWebhook(instanceId: string, instanceName: string, event: WebhookEvent, data: Record<string, any>): Promise<void> {
    try {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { webhookUrl: true, webhookToken: true },
      })

      if (!instance?.webhookUrl) return

      await webhookQueue.add(
        'send-webhook',
        {
          instanceId,
          instanceName,
          event,
          webhookUrl: instance.webhookUrl,
          webhookToken: instance.webhookToken,
          data,
          timestamp: Date.now(),
        },
        {
          attempts: config.webhook.maxRetries,
          backoff: { type: 'exponential', delay: config.webhook.retryDelay },
        },
      )
    } catch (err) {
      logger.error({ err, instanceId, event }, 'Failed to queue webhook')
    }
  }

  // ── Load all instances from DB on startup ─────────────────────────────────
  async loadInstances(): Promise<void> {
    const instances = await prisma.instance.findMany({
      where: { status: { in: ['CONNECTED', 'CONNECTING', 'QR_CODE'] } },
    })

    logger.info({ count: instances.length }, 'Loading instances from database')

    for (const instance of instances) {
      await this.createInstance(instance.id, instance.name)
    }
  }
}

export const instanceManager = new WhatsAppInstanceManager()