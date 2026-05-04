import { FastifyInstance } from 'fastify'
import { instanceManager } from '../services/instance-manager'
import { instanceTokenAuth } from '../middlewares/auth'
import { messageQueue } from '../queues/message.queue'
import { prisma } from '../services/prisma'
import { formatPhone, formatGroup } from '../utils/phone'
import { logger } from '../utils/logger'

type Params = { instanceName: string }

export async function messageRoutes(app: FastifyInstance): Promise<void> {

  // Helper to resolve the JID (phone or group)
  function resolveJid(phone: string): string {
    if (phone.includes('@g.us')) return phone
    if (phone.endsWith('@s.whatsapp.net')) return phone
    if (phone.includes('-')) return formatGroup(phone) // group id pattern
    return formatPhone(phone)
  }

  // ── Send text ─────────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/text',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, message, delayMs } = request.body as {
        phone: string
        message: string
        delayMs?: number
      }

      if (!phone || !message) {
        return reply.status(400).send({ error: 'phone and message are required' })
      }

      if (!instanceManager.isConnected(instance.id)) {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      const to = resolveJid(phone)

      // Save message record
      const msg = await prisma.message.create({
        data: {
          instanceId: instance.id,
          remoteJid: to,
          messageId: `pending-${Date.now()}`,
          fromMe: true,
          type: 'text',
          content: { type: 'text', text: message },
          status: 'QUEUED',
        },
      })

      // Send directly
      const result = await instanceManager.sendText(instance.id, to, message)
      return reply.send({ sent: true, messageId: result?.key?.id })
    },
  )

  // ── Send image ────────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/image',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, url, caption } = request.body as {
        phone: string
        url: string
        caption?: string
      }

      if (!phone || !url) {
        return reply.status(400).send({ error: 'phone and url are required' })
      }

      if (!instanceManager.isConnected(instance.id)) {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'image',
        payload: { url, caption },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Send video ────────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/video',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, url, caption } = request.body as {
        phone: string
        url: string
        caption?: string
      }

      if (!phone || !url) {
        return reply.status(400).send({ error: 'phone and url are required' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'video',
        payload: { url, caption },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Send audio ────────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/audio',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, url, ptt = false } = request.body as {
        phone: string
        url: string
        ptt?: boolean
      }

      if (!phone || !url) {
        return reply.status(400).send({ error: 'phone and url are required' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'audio',
        payload: { url, ptt },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Send document ─────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/document',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, url, fileName, mimetype } = request.body as {
        phone: string
        url: string
        fileName: string
        mimetype: string
      }

      if (!phone || !url || !fileName) {
        return reply.status(400).send({ error: 'phone, url and fileName are required' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'document',
        payload: { url, fileName, mimetype: mimetype || 'application/octet-stream' },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Send location ─────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/location',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, lat, lon, name } = request.body as {
        phone: string
        lat: number
        lon: number
        name?: string
      }

      if (!phone || lat === undefined || lon === undefined) {
        return reply.status(400).send({ error: 'phone, lat and lon are required' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'location',
        payload: { lat, lon, name },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Send reaction ─────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/reaction',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, messageId, emoji } = request.body as {
        phone: string
        messageId: string
        emoji: string
      }

      if (!phone || !messageId || !emoji) {
        return reply.status(400).send({ error: 'phone, messageId and emoji are required' })
      }

      const to = resolveJid(phone)

      await messageQueue.add('send-message', {
        instanceId: instance.id,
        instanceName: instance.name,
        to,
        type: 'reaction',
        payload: { messageId, emoji },
      })

      return reply.status(202).send({ queued: true })
    },
  )

  // ── Mark as read ──────────────────────────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/messages/read',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, messageId } = request.body as { phone: string; messageId: string }

      const to = resolveJid(phone)
      await instanceManager.markAsRead(instance.id, to, messageId)

      return reply.send({ success: true })
    },
  )

  // ── Set presence (typing indicator) ──────────────────────────────────
  app.post<{ Params: Params }>(
    '/instances/:instanceName/presence',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, presence } = request.body as {
        phone: string
        presence: 'composing' | 'recording' | 'paused'
      }

      const to = resolveJid(phone)
      await instanceManager.setPresence(instance.id, to, presence)

      return reply.send({ success: true })
    },
  )

  // ── List messages ─────────────────────────────────────────────────────
  app.get<{ Params: Params; Querystring: { phone?: string; page?: number; limit?: number } }>(
    '/instances/:instanceName/messages',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone, page = 1, limit = 50 } = request.query

      const where: any = { instanceId: instance.id }
      if (phone) {
        where.remoteJid = resolveJid(phone)
      }

      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.message.count({ where }),
      ])

      return reply.send({ messages, total, page, pages: Math.ceil(total / limit) })
    },
  )
}