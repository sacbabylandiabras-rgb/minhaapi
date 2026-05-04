import { FastifyInstance } from 'fastify'
import { prisma } from '../services/prisma'
import { instanceManager } from '../services/instance-manager'
import { masterKeyAuth, instanceTokenAuth } from '../middlewares/auth'
import { logger } from '../utils/logger'

export async function instanceRoutes(app: FastifyInstance): Promise<void> {

  // ── Create instance ─────────────────────────────────────────────────────
  app.post(
    '/instances',
    { preHandler: masterKeyAuth },
    async (request, reply) => {
      const { name, webhookUrl, webhookToken } = request.body as {
        name: string
        webhookUrl?: string
        webhookToken?: string
      }

      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return reply.status(400).send({
          error: 'Invalid name. Use only letters, numbers, hyphens and underscores.',
        })
      }

      const existing = await prisma.instance.findUnique({ where: { name } })
      if (existing) {
        return reply.status(409).send({ error: 'Instance name already exists' })
      }

      const instance = await prisma.instance.create({
        data: { name, webhookUrl, webhookToken, status: 'CONNECTING' },
      })

      // Start the WhatsApp connection in background
      instanceManager.createInstance(instance.id, instance.name).catch((err) =>
        logger.error({ err, instanceId: instance.id }, 'Failed to create instance'),
      )

      return reply.status(201).send({
        id: instance.id,
        name: instance.name,
        token: instance.token,
        status: instance.status,
        webhookUrl: instance.webhookUrl,
        message: 'Instance created. Connect via QR Code.',
      })
    },
  )

  // ── List instances ──────────────────────────────────────────────────────
  app.get(
    '/instances',
    { preHandler: masterKeyAuth },
    async (request, reply) => {
      const instances = await prisma.instance.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          phone: true,
          profileName: true,
          webhookUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send({ instances, total: instances.length })
    },
  )

  // ── Get instance info ───────────────────────────────────────────────────
  app.get<{ Params: { instanceName: string } }>(
    '/instances/:instanceName',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance

      return reply.send({
        id: instance.id,
        name: instance.name,
        status: instanceManager.getStatus(instance.id),
        phone: instance.phone,
        profileName: instance.profileName,
        profilePic: instance.profilePic,
        webhookUrl: instance.webhookUrl,
        connected: instanceManager.isConnected(instance.id),
      })
    },
  )

  // ── Get QR Code ─────────────────────────────────────────────────────────
  app.get<{ Params: { instanceName: string } }>(
    '/instances/:instanceName/qrcode',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { qrCode, qrCodeBase64 } = instanceManager.getQRCode(instance.id)

      if (!qrCode) {
        const status = instanceManager.getStatus(instance.id)
        if (status === 'CONNECTED') {
          return reply.status(200).send({ connected: true, message: 'Already connected' })
        }
        return reply.status(202).send({ connected: false, message: 'QR Code not ready yet, try again in a few seconds' })
      }

      return reply.send({
        connected: false,
        qrCode,
        qrCodeBase64,
      })
    },
  )

  // ── Restart instance ────────────────────────────────────────────────────
  app.post<{ Params: { instanceName: string } }>(
    '/instances/:instanceName/restart',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance

      instanceManager
        .restartInstance(instance.id, instance.name)
        .catch((err) => logger.error({ err, instanceId: instance.id }, 'Failed to restart instance'))

      return reply.send({ message: 'Instance restarting...' })
    },
  )

  // ── Disconnect instance ─────────────────────────────────────────────────
  app.post<{ Params: { instanceName: string } }>(
    '/instances/:instanceName/disconnect',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      await instanceManager.disconnectInstance(instance.id)

      return reply.send({ message: 'Disconnected successfully' })
    },
  )

  // ── Update webhook ──────────────────────────────────────────────────────
  app.patch<{ Params: { instanceName: string } }>(
    '/instances/:instanceName/webhook',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { webhookUrl, webhookToken } = request.body as {
        webhookUrl?: string
        webhookToken?: string
      }

      await prisma.instance.update({
        where: { id: instance.id },
        data: { webhookUrl, webhookToken },
      })

      return reply.send({ message: 'Webhook updated successfully' })
    },
  )


  // ── QR Code as PNG image (open directly in browser) ────────────────────
  app.get(
    '/instances/:instanceName/qrcode.png',
    async (request: any, reply: any) => {
      const { instanceName } = request.params
      const token = (request.query.token || request.headers['x-api-key']) as string

      if (!token) return reply.status(401).send('Missing token')

      const instance = await prisma.instance.findFirst({ where: { name: instanceName, token } })
      if (!instance) return reply.status(401).send('Invalid token')

      const { qrCodeBase64 } = instanceManager.getQRCode(instance.id)
      const status = instanceManager.getStatus(instance.id)

      if (!qrCodeBase64) {
        const html = `<html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>Status: ${status}</h2>
          <p>${status === 'CONNECTED' ? '✅ Conectado!' : '⏳ QR Code ainda não gerado. Aguarde...'}</p>
          <script>if('${status}' !== 'CONNECTED') setTimeout(()=>location.reload(), 3000)</script>
        </body></html>`
        return reply.type('text/html').send(html)
      }

      const base64Data = qrCodeBase64.replace(/^data:image\/png;base64,/, '')
      return reply.type('image/png').send(Buffer.from(base64Data, 'base64'))
    },
  )

  // ── Delete instance ─────────────────────────────────────────────────────
  app.delete<{ Params: { instanceName: string } }>(
    '/instances/:instanceName',
    { preHandler: masterKeyAuth },
    async (request, reply) => {
      const { instanceName } = request.params
      const instance = await prisma.instance.findUnique({ where: { name: instanceName } })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      await instanceManager.disconnectInstance(instance.id)
      await prisma.instance.delete({ where: { id: instance.id } })

      return reply.send({ message: 'Instance deleted successfully' })
    },
  )
}