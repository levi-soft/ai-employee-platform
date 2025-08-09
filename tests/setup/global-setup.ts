
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

const execAsync = promisify(exec);

// Load test environment variables
dotenv.config({ path: '.env.test' });

/**
 * Global Jest setup - runs before all tests
 * Sets up test database and required services
 */
async function globalSetup(): Promise<void> {
  console.log('🚀 Starting global test setup...');
  
  try {
    // Check if Docker is available
    try {
      await execAsync('docker --version');
      console.log('✅ Docker is available');
    } catch (error) {
      console.warn('⚠️ Docker not available, skipping containerized services');
    }
    
    // Setup test environment variables
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5433/ai_platform_test';
    process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6380';
    
    // Start test services if needed
    console.log('📦 Test environment configured');
    console.log('🔧 Database URL:', process.env.DATABASE_URL);
    console.log('🔧 Redis URL:', process.env.REDIS_URL);
    
    // Additional setup can be added here
    // - Start test containers
    // - Run database migrations
    // - Seed test data
    
    console.log('✅ Global test setup completed');
  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    process.exit(1);
  }
}

export default globalSetup;
