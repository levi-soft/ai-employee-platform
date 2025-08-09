
#!/usr/bin/env ts-node

import { execSync } from 'child_process'
import { connectDatabase, checkDatabaseHealth } from '../config/database'
import { connectRedis } from '../config/redis'

async function setupDatabase() {
  console.log('🚀 Starting database setup...')

  try {
    // Check if PostgreSQL is available
    console.log('🔍 Checking PostgreSQL connection...')
    const db = await connectDatabase()
    const health = await checkDatabaseHealth()
    
    if (health.status !== 'healthy') {
      throw new Error('Database health check failed')
    }
    
    console.log('✅ PostgreSQL connection successful')

    // Check if Redis is available
    console.log('🔍 Checking Redis connection...')
    await connectRedis()
    console.log('✅ Redis connection successful')

    // Generate Prisma client
    console.log('🔧 Generating Prisma client...')
    execSync('npx prisma generate', { stdio: 'inherit', cwd: process.cwd() })
    
    // Run database migrations
    console.log('🗄️ Running database migrations...')
    execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: process.cwd() })
    
    // Run database seeding
    console.log('🌱 Seeding database...')
    execSync('npx prisma db seed', { stdio: 'inherit', cwd: process.cwd() })
    
    console.log('✅ Database setup completed successfully!')
    
  } catch (error) {
    console.error('❌ Database setup failed:', error)
    process.exit(1)
  }
}

async function resetDatabase() {
  console.log('⚠️ Resetting database...')
  
  try {
    // Reset database
    execSync('npx prisma migrate reset --force', { stdio: 'inherit', cwd: process.cwd() })
    console.log('✅ Database reset completed!')
    
  } catch (error) {
    console.error('❌ Database reset failed:', error)
    process.exit(1)
  }
}

// Command line interface
const command = process.argv[2]

switch (command) {
  case 'setup':
    setupDatabase()
    break
  case 'reset':
    resetDatabase()
    break
  default:
    console.log(`
Usage:
  ts-node scripts/setup.ts setup  - Setup database with migrations and seeds
  ts-node scripts/setup.ts reset  - Reset database completely
    `)
}
