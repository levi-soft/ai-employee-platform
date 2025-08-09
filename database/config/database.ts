
import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

export const prisma = global.__prisma || new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
  errorFormat: 'pretty',
})

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma
}

export const connectDatabase = async () => {
  try {
    await prisma.$connect()
    console.log('✅ Connected to PostgreSQL database')
    return prisma
  } catch (error) {
    console.error('❌ Failed to connect to database:', error)
    throw error
  }
}

export const disconnectDatabase = async () => {
  try {
    await prisma.$disconnect()
    console.log('🔌 Disconnected from database')
  } catch (error) {
    console.error('Failed to disconnect from database:', error)
  }
}

// Health check function
export const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'healthy', timestamp: new Date() }
  } catch (error) {
    return { status: 'unhealthy', error: error.message, timestamp: new Date() }
  }
}
