
import { createClient } from 'redis'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

export const redisClient = createClient({
  url: redisUrl,
  retry_strategy: (options: any) => {
    if (options.error && (options.error.code === 'ECONNREFUSED' || options.error.code === 'NR_CLOSED')) {
      // Try to reconnect after 2 seconds
      return 2000
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      // End reconnecting after 1 hour
      return new Error('Retry time exhausted')
    }
    if (options.attempt > 10) {
      // End reconnecting with built in error
      return undefined
    }
    // reconnect after this time
    return Math.min(options.attempt * 100, 3000)
  },
})

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err)
})

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis')
})

redisClient.on('ready', () => {
  console.log('🚀 Redis is ready')
})

export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect()
    }
    return redisClient
  } catch (error) {
    console.error('Failed to connect to Redis:', error)
    throw error
  }
}

export const disconnectRedis = async () => {
  try {
    if (redisClient.isOpen) {
      await redisClient.disconnect()
    }
  } catch (error) {
    console.error('Failed to disconnect from Redis:', error)
  }
}

// Session store configuration for Redis
export const sessionConfig = {
  store: redisClient,
  secret: process.env.REDIS_SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}
