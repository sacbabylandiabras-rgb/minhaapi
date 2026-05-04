import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  })

prisma.$on('warn' as never, (e: any) => logger.warn(e, 'Prisma warning'))
prisma.$on('error' as never, (e: any) => logger.error(e, 'Prisma error'))

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma
}
