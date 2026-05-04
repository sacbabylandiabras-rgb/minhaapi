import { Queue, Worker, Job } from 'bullmq'
import axios from 'axios'
import { getRedisForBullMQ } from '../utils/redis'
import { prisma } from '../services/prisma'
import { config } from '../config'
import { logger } from '../utils/logger'

interface WebhookJobData {
  instanceId: string
  instanceName: string
  event: string
  webhookUrl: string
  webhookToken?: string | null
  data: Record<string, any>
  timestamp: number
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export const webhookQueue = new Queue<WebhookJobData>('webhook', {
  connection: getRedisForBullMQ(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
})

// ── Worker ────────────────────────────────────────────────────────────────────
export function startWebhookWorker(): void {
  const worker = new Worker<WebhookJobData>(
    'webhook',
    async (job: Job<WebhookJobData>) => {
      const { instanceId, instanceName, event, webhookUrl, webhookToken, data, timestamp } =
        job.data

      const payload = {
        event,
        instanceId,
        instanceName,
        data,
        timestamp,
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'ZAPI-Clone/1.0',
      }

      if (webhookToken) {
        headers['Authorization'] = `Bearer ${webhookToken}`
      }

      logger.debug({ instanceId, event, webhookUrl, attempt: job.attemptsMade + 1 }, 'Sending webhook')

      const response = await axios.post(webhookUrl, payload, {
        headers,
        timeout: config.webhook.timeout,
        validateStatus: (status) => status < 500,
      })

      // Log webhook attempt
      await prisma.webhookLog.create({
        data: {
          instanceId,
          event,
          payload: payload as any,
          statusCode: response.status,
          response: JSON.stringify(response.data).substring(0, 500),
          attempts: job.attemptsMade + 1,
          success: response.status >= 200 && response.status < 300,
        },
      })

      if (response.status >= 400) {
        throw new Error(`Webhook returned status ${response.status}`)
      }

      logger.debug({ instanceId, event, statusCode: response.status }, 'Webhook delivered')
    },
    {
      connection: getRedisForBullMQ(),
      concurrency: 10,
    },
  )

  worker.on('failed', async (job, err) => {
    if (!job) return
    logger.warn(
      { jobId: job.id, instanceId: job.data.instanceId, event: job.data.event, err: err.message },
      'Webhook job failed',
    )

    // Log final failure
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await prisma.webhookLog.create({
        data: {
          instanceId: job.data.instanceId,
          event: job.data.event,
          payload: job.data as any,
          attempts: job.attemptsMade,
          success: false,
          response: err.message,
        },
      })
    }
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'Webhook worker error')
  })

  logger.info('Webhook worker started')
}
