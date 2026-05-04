import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../services/prisma'
import { config } from '../config'

/**
 * Master API Key — used for admin routes (create/delete instances)
 */
export async function masterKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKey =
    request.headers['x-api-key'] ||
    request.headers['authorization']?.replace('Bearer ', '')

  if (!apiKey || apiKey !== config.app.apiKey) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key' })
  }
}

/**
 * Instance token — used for instance-specific routes
 * Validates the token and injects the instance into the request
 */
export async function instanceTokenAuth(
  request: FastifyRequest<{ Params: { instanceName: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const token =
    request.headers['x-api-key'] ||
    request.headers['authorization']?.replace('Bearer ', '')

  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Missing token' })
  }

  const instance = await prisma.instance.findFirst({
    where: {
      name: request.params.instanceName,
      token: token as string,
    },
  })

  if (!instance) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid token for this instance' })
  }

  // Inject instance into request for use in controllers
  ;(request as any).instance = instance
}
