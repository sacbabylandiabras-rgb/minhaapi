import Redis from 'ioredis'
import { config } from '../config'
import { logger } from './logger'

let redisClient: Redis | null = null

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
    })

    redisClient.on('connect', () => logger.info('Redis connected'))
    redisClient.on('error', (err) => logger.error({ err }, 'Redis error'))
  }

  return redisClient
}

export function getRedisForBullMQ(): Redis {
  // BullMQ needs a separate connection
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
