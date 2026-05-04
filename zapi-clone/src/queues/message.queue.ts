import { Queue, Worker, Job } from 'bullmq'
import { getRedisForBullMQ } from '../utils/redis'
import { instanceManager } from '../services/instance-manager'
import { prisma } from '../services/prisma'
import { logger } from '../utils/logger'

interface MessageJobData {
  instanceId: string
  instanceName: string
  to: string
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'reaction'
  payload: Record<string, any>
  delayMs?: number
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export const messageQueue = new Queue<MessageJobData>('messages', {
  connection: getRedisForBullMQ(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
})

// ── Worker ────────────────────────────────────────────────────────────────────
export function startMessageWorker(): void {
  const worker = new Worker<MessageJobData>(
    'messages',
    async (job: Job<MessageJobData>) => {
      const { instanceId, to, type, payload, delayMs } = job.data

      if (!instanceManager.isConnected(instanceId)) {
        throw new Error(`Instance ${instanceId} is not connected`)
      }

      // Optional delay between messages (anti-spam)
      if (delayMs && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      let result

      switch (type) {
        case 'text':
          result = await instanceManager.sendText(instanceId, to, payload.text)
          break
        case 'image':
          result = await instanceManager.sendImage(instanceId, to, payload.url, payload.caption)
          break
        case 'video':
          result = await instanceManager.sendVideo(instanceId, to, payload.url, payload.caption)
          break
        case 'audio':
          result = await instanceManager.sendAudio(instanceId, to, payload.url, payload.ptt)
          break
        case 'document':
          result = await instanceManager.sendDocument(
            instanceId,
            to,
            payload.url,
            payload.fileName,
            payload.mimetype,
          )
          break
        case 'location':
          result = await instanceManager.sendLocation(
            instanceId,
            to,
            payload.lat,
            payload.lon,
            payload.name,
          )
          break
        case 'reaction':
          result = await instanceManager.sendReaction(
            instanceId,
            to,
            payload.messageId,
            payload.emoji,
          )
          break
        default:
          throw new Error(`Unknown message type: ${type}`)
      }

      // Update message status to SENT
      if (result?.key?.id) {
        await prisma.message.updateMany({
          where: { messageId: result.key.id, instanceId },
          data: { status: 'SENT' },
        })
      }

      logger.debug({ instanceId, to, type }, 'Message sent successfully')
      return result
    },
    {
      connection: getRedisForBullMQ(),
      concurrency: 5, // max 5 concurrent sends per worker
    },
  )

  worker.on('failed', (job, err) => {
    if (!job) return
    logger.error(
      { jobId: job.id, instanceId: job.data.instanceId, to: job.data.to, err: err.message },
      'Message job failed',
    )
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'Message worker error')
  })

  logger.info('Message worker started')
}
