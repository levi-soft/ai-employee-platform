
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { logger } from '@ai-platform/shared-utils'
import routes from './routes'
import { errorHandler } from './middleware/error.middleware'
import { requestLogger } from './middleware/logging.middleware'

// Import provider integrations
import OpenAIIntegration from './integrations/openai.integration'
import ClaudeIntegration from './integrations/claude.integration'
import GeminiIntegration from './integrations/gemini.integration'
import OllamaIntegration from './integrations/ollama.integration'
import HealthMonitorService from './services/health-monitor.service'

const app = express()
const PORT = process.env.PORT || 3004

// Initialize provider integrations
const providers = new Map()
const healthMonitor = new HealthMonitorService({
  checkInterval: 30000,
  unhealthyThreshold: 5000,
  degradedThreshold: 2000,
})

// Initialize providers if API keys are available
if (process.env.OPENAI_API_KEY) {
  const openaiProvider = new OpenAIIntegration({
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.OPENAI_ORGANIZATION,
  })
  providers.set('openai', openaiProvider)
  healthMonitor.registerProvider(openaiProvider)
  logger.info('OpenAI provider initialized')
}

if (process.env.CLAUDE_API_KEY) {
  const claudeProvider = new ClaudeIntegration({
    apiKey: process.env.CLAUDE_API_KEY,
  })
  providers.set('claude', claudeProvider)
  healthMonitor.registerProvider(claudeProvider)
  logger.info('Claude provider initialized')
}

if (process.env.GEMINI_API_KEY) {
  const geminiProvider = new GeminiIntegration({
    apiKey: process.env.GEMINI_API_KEY,
  })
  providers.set('gemini', geminiProvider)
  healthMonitor.registerProvider(geminiProvider)
  logger.info('Gemini provider initialized')
}

if (process.env.OLLAMA_BASE_URL) {
  const ollamaProvider = new OllamaIntegration({
    baseURL: process.env.OLLAMA_BASE_URL,
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'llama2',
  })
  providers.set('ollama', ollamaProvider)
  healthMonitor.registerProvider(ollamaProvider)
  logger.info('Ollama provider initialized')
}

// Make providers and health monitor available to routes
app.locals.providers = providers
app.locals.healthMonitor = healthMonitor

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}))

// Rate limiting - more generous for AI routing service
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Allow more requests for AI routing
  message: {
    success: false,
    error: 'Too many routing requests from this IP, please try again later.'
  }
})
app.use(limiter)

// Body parsing
app.use(express.json({ limit: '50mb' })) // Larger limit for AI requests
app.use(express.urlencoded({ extended: true }))

// Request logging
app.use(requestLogger)

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'ai-routing-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// API routes
app.use('/api/ai', routes)

// Error handling
app.use(errorHandler)

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'AI routing endpoint not found'
  })
})

// Start server
app.listen(PORT, () => {
  logger.info(`AI Routing Service started on port ${PORT}`)
  logger.info('AI Routing Service features:', {
    routeLLM: 'enabled',
    costOptimization: 'enabled',
    loadBalancing: 'enabled',
    capabilityMatching: 'enabled',
    providersCount: providers.size,
    healthMonitoring: 'enabled'
  })
  
  // Start health monitoring
  if (providers.size > 0) {
    healthMonitor.startMonitoring()
    logger.info('Provider health monitoring started')
  }
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down AI routing service gracefully')
  healthMonitor.stopMonitoring()
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down AI routing service gracefully')
  healthMonitor.stopMonitoring()
  process.exit(0)
})

export default app
