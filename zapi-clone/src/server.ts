import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import { logger } from './utils/logger'
import { getRedis } from './utils/redis'
import { instanceManager } from './services/instance-manager'
import { startWebhookWorker } from './queues/webhook.queue'
import { startMessageWorker } from './queues/message.queue'
import { instanceRoutes } from './controllers/instance.controller'
import { messageRoutes } from './controllers/message.controller'
import { profileRoutes } from './controllers/profile.controller'
import { prisma } from './services/prisma'
import fastifyStatic from '@fastify/static'
import path from 'path'

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: false, // using pino directly
    trustProxy: true,
  })

  // ── Plugins ─────────────────────────────────────────────────────────────
  await app.register(cors, { origin: true })
  await app.register(helmet)
  await app.register(fastifyStatic, {
  root: path.join(process.cwd(), 'public'),
  prefix: '/painel',
})
  await app.register(rateLimit, {
    redis: getRedis(),
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-api-key'] as string) || req.ip,
  })

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    })
  })

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(instanceRoutes, { prefix: '/api/v1' })
  await app.register(messageRoutes, { prefix: '/api/v1' })
  await app.register(profileRoutes, { prefix: '/api/v1' })

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Request error')

    if (error.statusCode) {
      return reply.status(error.statusCode).send({ error: error.message })
    }

    return reply.status(500).send({
      error: 'Internal Server Error',
      message: config.app.env === 'development' ? error.message : undefined,
    })
  })

  // ── Not found handler ─────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` })
  })

  // ── Start workers ─────────────────────────────────────────────────────────
  startWebhookWorker()
  startMessageWorker()

  // ── Load existing instances ───────────────────────────────────────────────
  await instanceManager.loadInstances()

  // ── Start server ──────────────────────────────────────────────────────────
  const address = await app.listen({ port: config.app.port, host: '0.0.0.0' })
  logger.info(`🚀 Server running at ${address}`)

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...')
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})
