import 'dotenv/config'

export const config = {
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    apiKey: process.env.API_KEY || 'changeme',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  sessions: {
    dir: process.env.SESSIONS_DIR || './sessions',
  },
  webhook: {
    timeout: Number(process.env.WEBHOOK_TIMEOUT) || 10000,
    maxRetries: Number(process.env.WEBHOOK_MAX_RETRIES) || 5,
    retryDelay: Number(process.env.WEBHOOK_RETRY_DELAY) || 5000,
  },
}
