import pino from 'pino'
import { config } from '../config'

export const logger = pino({
  level: config.app.env === 'production' ? 'info' : 'debug',
  transport:
    config.app.env !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
})
