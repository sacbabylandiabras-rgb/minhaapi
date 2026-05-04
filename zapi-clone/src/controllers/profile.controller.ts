import { FastifyInstance } from 'fastify'
import { instanceManager } from '../services/instance-manager'
import { instanceTokenAuth } from '../middlewares/auth'
import { formatPhone } from '../utils/phone'

type Params = { instanceName: string }

export async function profileRoutes(app: FastifyInstance): Promise<void> {

  // ── Check if number exists on WhatsApp ────────────────────────────────
  app.get<{ Params: Params; Querystring: { phone: string } }>(
    '/instances/:instanceName/check-number',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone } = request.query

      if (!phone) {
        return reply.status(400).send({ error: 'phone is required' })
      }

      const jid = formatPhone(phone)
      const exists = await instanceManager.checkNumberExists(instance.id, jid)

      return reply.send({ phone, jid, exists })
    },
  )

  // ── Get profile picture ───────────────────────────────────────────────
  app.get<{ Params: Params; Querystring: { phone: string } }>(
    '/instances/:instanceName/profile-picture',
    { preHandler: instanceTokenAuth },
    async (request, reply) => {
      const instance = (request as any).instance
      const { phone } = request.query

      if (!phone) {
        return reply.status(400).send({ error: 'phone is required' })
      }

      const jid = formatPhone(phone)
      const pictureUrl = await instanceManager.getProfilePicture(instance.id, jid)

      return reply.send({ phone, jid, pictureUrl })
    },
  )
}
