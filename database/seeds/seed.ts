
import { PrismaClient, Role, TransactionType, TransactionStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seeding...')

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('admin123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@aiplatform.com' },
    update: {},
    create: {
      email: 'admin@aiplatform.com',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      firstName: 'System',
      lastName: 'Administrator',
      language: 'en',
      timezone: 'UTC',
      isActive: true,
    },
  })

  // Create employee users
  const employeePasswordHash = await bcrypt.hash('employee123', 12)
  const employees = await Promise.all([
    prisma.user.upsert({
      where: { email: 'john.doe@company.com' },
      update: {},
      create: {
        email: 'john.doe@company.com',
        passwordHash: employeePasswordHash,
        role: Role.EMPLOYEE,
        firstName: 'John',
        lastName: 'Doe',
        language: 'en',
        timezone: 'America/New_York',
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'jane.smith@company.com' },
      update: {},
      create: {
        email: 'jane.smith@company.com',
        passwordHash: employeePasswordHash,
        role: Role.EMPLOYEE,
        firstName: 'Jane',
        lastName: 'Smith',
        language: 'en',
        timezone: 'Europe/London',
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'nguyen.van.a@company.com' },
      update: {},
      create: {
        email: 'nguyen.van.a@company.com',
        passwordHash: employeePasswordHash,
        role: Role.EMPLOYEE,
        firstName: 'Nguyễn Văn',
        lastName: 'A',
        language: 'vi',
        timezone: 'Asia/Ho_Chi_Minh',
        isActive: true,
      },
    }),
  ])

  console.log('👥 Created users:', { admin: admin.email, employees: employees.length })

  // Create credit accounts for all users
  const allUsers = [admin, ...employees]
  for (const user of allUsers) {
    await prisma.creditAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        balance: user.role === Role.ADMIN ? 10000.00 : 100.00,
        totalSpent: 0.00,
        totalToppedUp: user.role === Role.ADMIN ? 10000.00 : 100.00,
      },
    })
  }

  console.log('💰 Created credit accounts for all users')

  // Create AI Agents
  const aiAgents = await Promise.all([
    prisma.aIAgent.upsert({
      where: { id: 'openai-gpt4' },
      update: {},
      create: {
        id: 'openai-gpt4',
        name: 'GPT-4 Turbo',
        provider: 'OpenAI',
        model: 'gpt-4-turbo-preview',
        capabilities: ['text-generation', 'code-generation', 'analysis', 'translation'],
        costPerToken: 0.000030,
        maxTokens: 128000,
        responseTimeAvg: 2500,
        accuracyScore: 0.95,
        isActive: true,
        config: {
          temperature: 0.7,
          top_p: 1.0,
          frequency_penalty: 0.0,
          presence_penalty: 0.0,
        },
      },
    }),
    prisma.aIAgent.upsert({
      where: { id: 'openai-gpt35' },
      update: {},
      create: {
        id: 'openai-gpt35',
        name: 'GPT-3.5 Turbo',
        provider: 'OpenAI',
        model: 'gpt-3.5-turbo',
        capabilities: ['text-generation', 'analysis', 'translation'],
        costPerToken: 0.000002,
        maxTokens: 16385,
        responseTimeAvg: 1500,
        accuracyScore: 0.88,
        isActive: true,
        config: {
          temperature: 0.7,
          top_p: 1.0,
        },
      },
    }),
    prisma.aIAgent.upsert({
      where: { id: 'claude-3-opus' },
      update: {},
      create: {
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        provider: 'Anthropic',
        model: 'claude-3-opus-20240229',
        capabilities: ['text-generation', 'code-generation', 'analysis', 'reasoning'],
        costPerToken: 0.000015,
        maxTokens: 200000,
        responseTimeAvg: 3000,
        accuracyScore: 0.93,
        isActive: true,
        config: {
          max_tokens: 4096,
        },
      },
    }),
    prisma.aIAgent.upsert({
      where: { id: 'gemini-pro' },
      update: {},
      create: {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        provider: 'Google',
        model: 'gemini-pro',
        capabilities: ['text-generation', 'multimodal', 'analysis'],
        costPerToken: 0.000001,
        maxTokens: 32768,
        responseTimeAvg: 2000,
        accuracyScore: 0.90,
        isActive: true,
        config: {
          temperature: 0.9,
          topK: 1,
          topP: 1.0,
        },
      },
    }),
  ])

  console.log('🤖 Created AI agents:', aiAgents.length)

  // Create sample transactions
  const sampleTransactions = []
  for (const user of employees.slice(0, 2)) {
    // Top-up transaction
    sampleTransactions.push(
      prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.TOPUP,
          amount: 100.00,
          description: 'Initial credit top-up',
          paymentMethod: 'credit_card',
          paymentId: `pm_${Math.random().toString(36).substr(2, 9)}`,
          status: TransactionStatus.COMPLETED,
          metadata: {
            source: 'web_portal',
            currency: 'USD',
          },
        },
      })
    )

    // Usage transaction
    sampleTransactions.push(
      prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.USAGE,
          amount: 2.50,
          description: 'AI request - Text generation',
          aiAgentId: aiAgents[0].id,
          tokensUsed: 1250,
          status: TransactionStatus.COMPLETED,
          metadata: {
            request_type: 'completion',
            model_used: 'gpt-4-turbo-preview',
          },
        },
      })
    )
  }

  await Promise.all(sampleTransactions)
  console.log('💳 Created sample transactions:', sampleTransactions.length)

  // Create official plugins
  const officialPlugins = await Promise.all([
    prisma.plugin.upsert({
      where: { id: 'code-generator-v1' },
      update: {},
      create: {
        id: 'code-generator-v1',
        name: 'Code Generator',
        version: '1.0.0',
        author: 'AI Platform Team',
        description: 'Generate code in multiple programming languages',
        category: 'Development',
        isOfficial: true,
        isActive: true,
        configSchema: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: ['javascript', 'typescript', 'python', 'java'] },
            style: { type: 'string', enum: ['functional', 'object-oriented'] },
            includeDocs: { type: 'boolean', default: true },
          },
        },
        manifest: {
          entry: 'index.js',
          permissions: ['ai-access', 'file-system'],
          runtime: 'node',
        },
      },
    }),
    prisma.plugin.upsert({
      where: { id: 'data-visualizer-v1' },
      update: {},
      create: {
        id: 'data-visualizer-v1',
        name: 'Data Visualizer',
        version: '1.0.0',
        author: 'AI Platform Team',
        description: 'Create charts and visualizations from data',
        category: 'Analytics',
        isOfficial: true,
        isActive: true,
        configSchema: {
          type: 'object',
          properties: {
            chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'scatter'] },
            theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
            exportFormat: { type: 'string', enum: ['png', 'svg', 'pdf'] },
          },
        },
        manifest: {
          entry: 'visualizer.js',
          permissions: ['ai-access', 'data-access'],
          runtime: 'browser',
        },
      },
    }),
    prisma.plugin.upsert({
      where: { id: 'document-analyzer-v1' },
      update: {},
      create: {
        id: 'document-analyzer-v1',
        name: 'Document Analyzer',
        version: '1.0.0',
        author: 'AI Platform Team',
        description: 'Analyze and extract insights from documents',
        category: 'Document Processing',
        isOfficial: true,
        isActive: true,
        configSchema: {
          type: 'object',
          properties: {
            analysisType: { type: 'string', enum: ['summary', 'extraction', 'classification'] },
            languages: { type: 'array', items: { type: 'string' } },
            outputFormat: { type: 'string', enum: ['json', 'markdown', 'html'] },
          },
        },
        manifest: {
          entry: 'analyzer.js',
          permissions: ['ai-access', 'file-system', 'network'],
          runtime: 'node',
        },
      },
    }),
  ])

  console.log('🔌 Created official plugins:', officialPlugins.length)

  // Install some plugins for users
  for (const user of employees) {
    await prisma.userPlugin.upsert({
      where: { userId_pluginId: { userId: user.id, pluginId: officialPlugins[0].id } },
      update: {},
      create: {
        userId: user.id,
        pluginId: officialPlugins[0].id,
        config: {
          language: 'typescript',
          style: 'functional',
          includeDocs: true,
        },
        isEnabled: true,
      },
    })
  }

  console.log('📦 Installed plugins for employees')

  // Create budget limits for employees
  for (const user of employees) {
    await prisma.budgetLimit.upsert({
      where: { id: `${user.id}-monthly` },
      update: {},
      create: {
        id: `${user.id}-monthly`,
        userId: user.id,
        limitType: 'monthly',
        amount: 500.00,
        currentSpent: Math.random() * 100, // Random spent amount
        resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        isActive: true,
      },
    })
  }

  console.log('💸 Created budget limits for employees')

  console.log('✅ Database seeding completed successfully!')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
