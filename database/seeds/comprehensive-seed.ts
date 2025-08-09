
import { PrismaClient, Role, TransactionType, TransactionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Comprehensive Seed Script for AI Employee Platform
 * Creates realistic test data for all scenarios
 */

const prisma = new PrismaClient();

interface SeedOptions {
    userCount?: number;
    adminCount?: number;
    transactionCount?: number;
    aiRequestCount?: number;
    pluginCount?: number;
    skipExisting?: boolean;
}

class ComprehensiveSeed {
    private options: SeedOptions;

    constructor(options: SeedOptions = {}) {
        this.options = {
            userCount: 50,
            adminCount: 3,
            transactionCount: 200,
            aiRequestCount: 500,
            pluginCount: 10,
            skipExisting: true,
            ...options
        };
    }

    async run() {
        console.log('🌱 Starting comprehensive database seeding...');
        console.log(`Configuration: ${JSON.stringify(this.options, null, 2)}`);

        try {
            // Clean existing data if not skipping
            if (!this.options.skipExisting) {
                await this.cleanDatabase();
            }

            // Seed in dependency order
            await this.seedUsers();
            await this.seedCreditAccounts();
            await this.seedAIAgents();
            await this.seedTransactions();
            await this.seedAIRequests();
            await this.seedPlugins();
            await this.seedUserPlugins();
            await this.seedBudgetLimits();

            console.log('✅ Comprehensive seeding completed successfully!');
            await this.generateSeedReport();

        } catch (error) {
            console.error('❌ Seeding failed:', error);
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    }

    private async cleanDatabase() {
        console.log('🧹 Cleaning existing data...');

        // Delete in reverse dependency order
        await prisma.aIRequest.deleteMany();
        await prisma.transaction.deleteMany();
        await prisma.budgetLimit.deleteMany();
        await prisma.userPlugin.deleteMany();
        await prisma.plugin.deleteMany();
        await prisma.aIAgent.deleteMany();
        await prisma.creditAccount.deleteMany();
        await prisma.user.deleteMany();

        console.log('✅ Database cleaned');
    }

    private async seedUsers() {
        console.log('👥 Seeding users...');

        const totalUsers = this.options.userCount! + this.options.adminCount!;
        const users = [];

        // Create admin users
        for (let i = 1; i <= this.options.adminCount!; i++) {
            const hashedPassword = await bcrypt.hash(`Admin123!`, 12);
            
            users.push({
                email: `admin${i}@aiplatform.com`,
                firstName: `Admin`,
                lastName: `User${i}`,
                passwordHash: hashedPassword,
                role: Role.ADMIN,
                isActive: true,
                emailVerified: true,
                metadata: {
                    source: 'comprehensive_seed',
                    type: 'admin',
                    permissions: ['all']
                }
            });
        }

        // Create employee users with realistic data
        const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'James', 'Jennifer', 'William', 'Patricia', 'Richard', 'Linda', 'Thomas', 'Barbara', 'Charles', 'Susan', 'Daniel', 'Jessica'];
        const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
        const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Customer Success', 'Product', 'Design', 'Legal'];
        
        for (let i = 1; i <= this.options.userCount!; i++) {
            const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
            const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
            const department = departments[Math.floor(Math.random() * departments.length)];
            const hashedPassword = await bcrypt.hash(`Employee123!`, 12);
            
            users.push({
                email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@company.com`,
                firstName,
                lastName,
                passwordHash: hashedPassword,
                role: Role.EMPLOYEE,
                isActive: Math.random() > 0.1, // 90% active
                emailVerified: Math.random() > 0.05, // 95% verified
                metadata: {
                    source: 'comprehensive_seed',
                    type: 'employee',
                    department,
                    joinDate: this.randomDate(new Date(2022, 0, 1), new Date()),
                    employeeId: `EMP${String(i).padStart(4, '0')}`
                }
            });
        }

        // Add the mandatory test account
        const testAccountHash = await bcrypt.hash('johndoe123', 12);
        users.push({
            email: 'john@doe.com',
            firstName: 'John',
            lastName: 'Doe',
            passwordHash: testAccountHash,
            role: Role.ADMIN,
            isActive: true,
            emailVerified: true,
            metadata: {
                source: 'test_account',
                type: 'test_admin',
                note: 'Mandatory test account for application testing'
            }
        });

        // Batch create users
        await prisma.user.createMany({ data: users });
        console.log(`✅ Created ${users.length} users (${this.options.adminCount} admins, ${this.options.userCount} employees, 1 test account)`);
    }

    private async seedCreditAccounts() {
        console.log('💰 Seeding credit accounts...');

        const users = await prisma.user.findMany();
        const creditAccounts = [];

        for (const user of users) {
            const isAdmin = user.role === Role.ADMIN;
            const baseCredits = isAdmin ? 10000 : Math.floor(Math.random() * 1000) + 100;
            const bonusCredits = Math.floor(Math.random() * 500);
            
            creditAccounts.push({
                userId: user.id,
                totalCredits: baseCredits + bonusCredits,
                usedCredits: Math.floor(Math.random() * baseCredits * 0.3), // Used 0-30%
                bonusCredits: bonusCredits,
                lastResetAt: this.randomDate(new Date(2024, 0, 1), new Date()),
                metadata: {
                    initialAllocation: baseCredits,
                    accountType: isAdmin ? 'admin' : 'standard',
                    grantedBy: isAdmin ? 'system' : 'admin',
                    notes: isAdmin ? 'Admin account with elevated credit limit' : 'Standard employee allocation'
                }
            });
        }

        await prisma.creditAccount.createMany({ data: creditAccounts });
        console.log(`✅ Created ${creditAccounts.length} credit accounts`);
    }

    private async seedAIAgents() {
        console.log('🤖 Seeding AI agents...');

        const aiAgents = [
            {
                name: 'GPT-4',
                description: 'Most capable GPT model for complex reasoning and creative tasks',
                provider: 'openai',
                model: 'gpt-4',
                costPerToken: 0.00003,
                isActive: true,
                capabilities: ['reasoning', 'creative_writing', 'code_generation', 'analysis'],
                maxTokens: 8192,
                metadata: {
                    provider_url: 'https://api.openai.com/v1/chat/completions',
                    context_window: 8192,
                    training_cutoff: '2023-04',
                    strengths: ['complex reasoning', 'creative tasks', 'code analysis'],
                    use_cases: ['research', 'writing', 'programming', 'analysis']
                }
            },
            {
                name: 'GPT-3.5-Turbo',
                description: 'Fast and efficient model for most conversational AI tasks',
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                costPerToken: 0.0000015,
                isActive: true,
                capabilities: ['conversation', 'basic_reasoning', 'summarization'],
                maxTokens: 4096,
                metadata: {
                    provider_url: 'https://api.openai.com/v1/chat/completions',
                    context_window: 4096,
                    training_cutoff: '2021-09',
                    strengths: ['speed', 'cost_efficiency', 'general_conversation'],
                    use_cases: ['chat', 'support', 'basic_tasks']
                }
            },
            {
                name: 'Claude-3-Sonnet',
                description: 'Anthropic\'s balanced model for analysis and conversation',
                provider: 'anthropic',
                model: 'claude-3-sonnet-20240229',
                costPerToken: 0.000015,
                isActive: true,
                capabilities: ['analysis', 'reasoning', 'safety', 'conversation'],
                maxTokens: 200000,
                metadata: {
                    provider_url: 'https://api.anthropic.com/v1/messages',
                    context_window: 200000,
                    training_cutoff: '2024-02',
                    strengths: ['safety', 'analysis', 'long_context'],
                    use_cases: ['document_analysis', 'research', 'content_review']
                }
            },
            {
                name: 'Claude-3-Haiku',
                description: 'Anthropic\'s fastest model for quick tasks',
                provider: 'anthropic',
                model: 'claude-3-haiku-20240307',
                costPerToken: 0.00000025,
                isActive: true,
                capabilities: ['conversation', 'quick_tasks', 'summarization'],
                maxTokens: 200000,
                metadata: {
                    provider_url: 'https://api.anthropic.com/v1/messages',
                    context_window: 200000,
                    training_cutoff: '2024-03',
                    strengths: ['speed', 'efficiency', 'cost'],
                    use_cases: ['quick_responses', 'summarization', 'simple_tasks']
                }
            },
            {
                name: 'Gemini-Pro',
                description: 'Google\'s advanced model for multimodal tasks',
                provider: 'google',
                model: 'gemini-pro',
                costPerToken: 0.0000005,
                isActive: true,
                capabilities: ['multimodal', 'reasoning', 'code_generation', 'analysis'],
                maxTokens: 32768,
                metadata: {
                    provider_url: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent',
                    context_window: 32768,
                    training_cutoff: '2024-02',
                    strengths: ['multimodal', 'integration', 'reasoning'],
                    use_cases: ['multimodal_analysis', 'development', 'research']
                }
            },
            {
                name: 'Llama-3-70B',
                description: 'Meta\'s open-source large language model',
                provider: 'meta',
                model: 'llama-3-70b-instruct',
                costPerToken: 0.0000008,
                isActive: true,
                capabilities: ['reasoning', 'conversation', 'code_generation'],
                maxTokens: 8192,
                metadata: {
                    provider_url: 'https://api.together.ai/inference',
                    context_window: 8192,
                    training_cutoff: '2024-03',
                    strengths: ['open_source', 'reasoning', 'cost_efficiency'],
                    use_cases: ['general_purpose', 'development', 'research']
                }
            }
        ];

        await prisma.aIAgent.createMany({ data: aiAgents });
        console.log(`✅ Created ${aiAgents.length} AI agents`);
    }

    private async seedTransactions() {
        console.log('💳 Seeding transactions...');

        const users = await prisma.user.findMany({ include: { creditAccount: true } });
        const transactions = [];

        for (let i = 0; i < this.options.transactionCount!; i++) {
            const user = users[Math.floor(Math.random() * users.length)];
            const transactionTypes = [TransactionType.CREDIT_PURCHASE, TransactionType.CREDIT_USAGE, TransactionType.BONUS_CREDIT, TransactionType.REFUND];
            const transactionType = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];
            
            let amount: number;
            let description: string;
            
            switch (transactionType) {
                case TransactionType.CREDIT_PURCHASE:
                    amount = Math.floor(Math.random() * 500) + 100; // 100-600 credits
                    description = `Credit purchase - ${amount} credits`;
                    break;
                case TransactionType.CREDIT_USAGE:
                    amount = -(Math.floor(Math.random() * 50) + 1); // 1-50 credits used
                    description = `AI request usage - ${Math.abs(amount)} credits`;
                    break;
                case TransactionType.BONUS_CREDIT:
                    amount = Math.floor(Math.random() * 100) + 10; // 10-110 bonus credits
                    description = `Bonus credits - welcome bonus`;
                    break;
                case TransactionType.REFUND:
                    amount = Math.floor(Math.random() * 25) + 5; // 5-30 credits refunded
                    description = `Refund - failed AI request`;
                    break;
            }

            const status = Math.random() > 0.05 ? TransactionStatus.COMPLETED : 
                          (Math.random() > 0.5 ? TransactionStatus.PENDING : TransactionStatus.FAILED);

            transactions.push({
                userId: user.id,
                amount,
                type: transactionType,
                status,
                description,
                metadata: {
                    source: 'comprehensive_seed',
                    userEmail: user.email,
                    timestamp: this.randomDate(new Date(2024, 0, 1), new Date()).toISOString(),
                    transactionId: `TXN-${String(i + 1).padStart(6, '0')}`
                },
                createdAt: this.randomDate(new Date(2024, 0, 1), new Date())
            });
        }

        await prisma.transaction.createMany({ data: transactions });
        console.log(`✅ Created ${transactions.length} transactions`);
    }

    private async seedAIRequests() {
        console.log('🧠 Seeding AI requests...');

        const users = await prisma.user.findMany();
        const aiAgents = await prisma.aIAgent.findMany();
        const aiRequests = [];

        const samplePrompts = [
            { prompt: "Write a professional email to schedule a team meeting", expectedTokens: 120 },
            { prompt: "Explain the concept of machine learning in simple terms", expectedTokens: 200 },
            { prompt: "Generate a Python function to calculate fibonacci numbers", expectedTokens: 150 },
            { prompt: "Summarize the key points of project management best practices", expectedTokens: 180 },
            { prompt: "Write a creative story about artificial intelligence", expectedTokens: 300 },
            { prompt: "Analyze the pros and cons of remote work", expectedTokens: 250 },
            { prompt: "Create a marketing strategy for a new mobile app", expectedTokens: 400 },
            { prompt: "Explain quantum computing and its applications", expectedTokens: 350 },
            { prompt: "Write SQL queries to analyze customer data", expectedTokens: 200 },
            { prompt: "Generate ideas for improving employee engagement", expectedTokens: 180 }
        ];

        for (let i = 0; i < this.options.aiRequestCount!; i++) {
            const user = users[Math.floor(Math.random() * users.length)];
            const aiAgent = aiAgents[Math.floor(Math.random() * aiAgents.length)];
            const samplePrompt = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
            
            const tokensUsed = Math.floor(samplePrompt.expectedTokens * (0.8 + Math.random() * 0.4)); // ±20% variation
            const cost = tokensUsed * aiAgent.costPerToken;
            const responseTime = Math.floor(Math.random() * 30000) + 1000; // 1-30 seconds
            
            const requestStatus = Math.random() > 0.05 ? 'completed' : 
                                (Math.random() > 0.5 ? 'failed' : 'timeout');

            aiRequests.push({
                userId: user.id,
                agentId: aiAgent.id,
                prompt: samplePrompt.prompt,
                response: requestStatus === 'completed' ? 
                    `Generated response for: ${samplePrompt.prompt.substring(0, 50)}...` : null,
                tokensUsed: requestStatus === 'completed' ? tokensUsed : 0,
                cost: requestStatus === 'completed' ? cost : 0,
                responseTimeMs: responseTime,
                metadata: {
                    source: 'comprehensive_seed',
                    requestId: `REQ-${String(i + 1).padStart(8, '0')}`,
                    userAgent: 'AI Platform Web Client',
                    ipAddress: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
                    status: requestStatus,
                    agentModel: aiAgent.model,
                    agentProvider: aiAgent.provider,
                    processingTime: {
                        queueTime: Math.floor(Math.random() * 1000),
                        processingTime: responseTime - Math.floor(Math.random() * 1000),
                        networkTime: Math.floor(Math.random() * 200)
                    }
                },
                createdAt: this.randomDate(new Date(2024, 0, 1), new Date())
            });
        }

        await prisma.aIRequest.createMany({ data: aiRequests });
        console.log(`✅ Created ${aiRequests.length} AI requests`);
    }

    private async seedPlugins() {
        console.log('🔌 Seeding plugins...');

        const plugins = [
            {
                name: 'Document Analyzer',
                description: 'Analyze and extract insights from various document formats',
                version: '1.2.0',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 1250,
                rating: 4.8,
                metadata: {
                    category: 'productivity',
                    tags: ['documents', 'analysis', 'pdf', 'extraction'],
                    supportedFormats: ['pdf', 'docx', 'txt', 'md'],
                    features: ['text_extraction', 'summarization', 'key_insights', 'metadata_analysis'],
                    requirements: {
                        minVersion: '1.0.0',
                        maxFileSize: '50MB',
                        supportedLanguages: ['en', 'es', 'fr', 'de']
                    }
                }
            },
            {
                name: 'Code Generator',
                description: 'Generate code snippets and templates for various programming languages',
                version: '2.1.5',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 2100,
                rating: 4.9,
                metadata: {
                    category: 'development',
                    tags: ['code', 'generation', 'templates', 'programming'],
                    supportedLanguages: ['javascript', 'python', 'java', 'csharp', 'go', 'rust'],
                    features: ['boilerplate_generation', 'function_templates', 'class_scaffolding', 'test_generation'],
                    requirements: {
                        minVersion: '1.0.0',
                        dependencies: ['prettier', 'eslint']
                    }
                }
            },
            {
                name: 'Data Visualizer',
                description: 'Create charts and visualizations from data sets',
                version: '1.5.3',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 980,
                rating: 4.6,
                metadata: {
                    category: 'analytics',
                    tags: ['data', 'visualization', 'charts', 'graphs'],
                    chartTypes: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'treemap'],
                    features: ['interactive_charts', 'export_options', 'real_time_updates', 'custom_styling'],
                    requirements: {
                        minVersion: '1.0.0',
                        maxDataPoints: 10000
                    }
                }
            },
            {
                name: 'Translation Tool',
                description: 'Translate text between multiple languages with AI assistance',
                version: '1.0.8',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 756,
                rating: 4.4,
                metadata: {
                    category: 'language',
                    tags: ['translation', 'multilingual', 'ai', 'localization'],
                    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko'],
                    features: ['batch_translation', 'context_preservation', 'format_retention', 'quality_scoring'],
                    requirements: {
                        minVersion: '1.0.0',
                        maxTextLength: 5000
                    }
                }
            },
            {
                name: 'Email Assistant',
                description: 'Generate professional emails and responses with AI',
                version: '1.3.2',
                author: 'Community Developer',
                isActive: true,
                isOfficial: false,
                downloadCount: 432,
                rating: 4.2,
                metadata: {
                    category: 'communication',
                    tags: ['email', 'writing', 'assistant', 'professional'],
                    features: ['email_templates', 'tone_adjustment', 'grammar_check', 'response_generation'],
                    templates: ['meeting_request', 'follow_up', 'proposal', 'thank_you', 'apology'],
                    requirements: {
                        minVersion: '1.0.0'
                    }
                }
            },
            {
                name: 'Meeting Notes',
                description: 'Automatically generate meeting notes and action items',
                version: '0.9.1',
                author: 'Community Developer',
                isActive: true,
                isOfficial: false,
                downloadCount: 289,
                rating: 3.9,
                metadata: {
                    category: 'productivity',
                    tags: ['meetings', 'notes', 'transcription', 'action_items'],
                    features: ['audio_transcription', 'speaker_identification', 'action_item_extraction', 'summary_generation'],
                    supportedFormats: ['mp3', 'wav', 'm4a'],
                    requirements: {
                        minVersion: '1.0.0',
                        maxAudioLength: '2 hours'
                    }
                }
            },
            {
                name: 'Social Media Manager',
                description: 'Create and schedule social media content with AI assistance',
                version: '2.0.0',
                author: 'Community Developer',
                isActive: true,
                isOfficial: false,
                downloadCount: 567,
                rating: 4.5,
                metadata: {
                    category: 'marketing',
                    tags: ['social_media', 'content', 'scheduling', 'hashtags'],
                    platforms: ['twitter', 'linkedin', 'facebook', 'instagram'],
                    features: ['content_generation', 'hashtag_suggestions', 'optimal_timing', 'performance_analytics'],
                    requirements: {
                        minVersion: '1.0.0',
                        apiKeys: ['twitter', 'linkedin']
                    }
                }
            },
            {
                name: 'Resume Builder',
                description: 'Create professional resumes with AI-powered content suggestions',
                version: '1.1.4',
                author: 'Community Developer',
                isActive: false, // Inactive plugin for testing
                isOfficial: false,
                downloadCount: 201,
                rating: 4.0,
                metadata: {
                    category: 'career',
                    tags: ['resume', 'cv', 'career', 'job_search'],
                    templates: ['modern', 'classic', 'creative', 'minimal', 'executive'],
                    features: ['skill_highlighting', 'experience_optimization', 'keyword_suggestions', 'ats_optimization'],
                    requirements: {
                        minVersion: '1.0.0'
                    }
                }
            }
        ];

        await prisma.plugin.createMany({ data: plugins });
        console.log(`✅ Created ${plugins.length} plugins`);
    }

    private async seedUserPlugins() {
        console.log('🔗 Seeding user-plugin relationships...');

        const users = await prisma.user.findMany();
        const plugins = await prisma.plugin.findMany({ where: { isActive: true } });
        const userPlugins = [];

        // Give each user a random selection of plugins
        for (const user of users) {
            const pluginCount = Math.floor(Math.random() * 5) + 1; // 1-5 plugins per user
            const shuffledPlugins = [...plugins].sort(() => 0.5 - Math.random());
            const selectedPlugins = shuffledPlugins.slice(0, pluginCount);

            for (const plugin of selectedPlugins) {
                const installedAt = this.randomDate(new Date(2024, 0, 1), new Date());
                const lastUsed = Math.random() > 0.3 ? 
                    this.randomDate(installedAt, new Date()) : null; // 70% have used the plugin

                userPlugins.push({
                    userId: user.id,
                    pluginId: plugin.id,
                    isEnabled: Math.random() > 0.1, // 90% enabled
                    installedAt,
                    lastUsedAt: lastUsed,
                    usageCount: lastUsed ? Math.floor(Math.random() * 50) : 0,
                    settings: {
                        theme: Math.random() > 0.5 ? 'dark' : 'light',
                        notifications: Math.random() > 0.3,
                        autoUpdate: Math.random() > 0.2,
                        customSettings: {
                            maxResults: Math.floor(Math.random() * 20) + 10,
                            defaultLanguage: 'en',
                            cacheEnabled: Math.random() > 0.4
                        }
                    }
                });
            }
        }

        await prisma.userPlugin.createMany({ data: userPlugins });
        console.log(`✅ Created ${userPlugins.length} user-plugin relationships`);
    }

    private async seedBudgetLimits() {
        console.log('💰 Seeding budget limits...');

        const users = await prisma.user.findMany({ where: { role: Role.EMPLOYEE } });
        const budgetLimits = [];

        for (const user of users) {
            // Not all users have budget limits (only ~60%)
            if (Math.random() > 0.4) {
                const dailyLimit = Math.floor(Math.random() * 50) + 10; // 10-60 credits per day
                const monthlyLimit = dailyLimit * 25; // ~25 days worth
                
                budgetLimits.push({
                    userId: user.id,
                    dailyLimit,
                    monthlyLimit,
                    currentDailyUsage: Math.floor(Math.random() * dailyLimit * 0.8), // Used up to 80%
                    currentMonthlyUsage: Math.floor(Math.random() * monthlyLimit * 0.6), // Used up to 60%
                    isActive: Math.random() > 0.1, // 90% active
                    alertThreshold: 0.8, // Alert at 80%
                    metadata: {
                        setBy: 'admin',
                        reason: 'Standard employee budget limit',
                        reviewDate: new Date(2024, 11, 31).toISOString(), // End of year review
                        department: user.metadata?.department || 'General'
                    }
                });
            }
        }

        await prisma.budgetLimit.createMany({ data: budgetLimits });
        console.log(`✅ Created ${budgetLimits.length} budget limits`);
    }

    private async generateSeedReport() {
        console.log('📊 Generating seed report...');

        const stats = {
            users: await prisma.user.count(),
            adminUsers: await prisma.user.count({ where: { role: Role.ADMIN } }),
            employeeUsers: await prisma.user.count({ where: { role: Role.EMPLOYEE } }),
            activeUsers: await prisma.user.count({ where: { isActive: true } }),
            creditAccounts: await prisma.creditAccount.count(),
            aiAgents: await prisma.aIAgent.count(),
            activeAgents: await prisma.aIAgent.count({ where: { isActive: true } }),
            transactions: await prisma.transaction.count(),
            completedTransactions: await prisma.transaction.count({ where: { status: TransactionStatus.COMPLETED } }),
            aiRequests: await prisma.aIRequest.count(),
            plugins: await prisma.plugin.count(),
            officialPlugins: await prisma.plugin.count({ where: { isOfficial: true } }),
            activePlugins: await prisma.plugin.count({ where: { isActive: true } }),
            userPluginInstalls: await prisma.userPlugin.count(),
            budgetLimits: await prisma.budgetLimit.count(),
            activeBudgetLimits: await prisma.budgetLimit.count({ where: { isActive: true } })
        };

        // Calculate totals
        const totalCreditsResult = await prisma.creditAccount.aggregate({
            _sum: { totalCredits: true }
        });
        const totalCostResult = await prisma.aIRequest.aggregate({
            _sum: { cost: true }
        });

        const report = `
# Comprehensive Seed Report

Generated: ${new Date().toISOString()}

## User Statistics
- Total Users: ${stats.users}
- Admin Users: ${stats.adminUsers}
- Employee Users: ${stats.employeeUsers}
- Active Users: ${stats.activeUsers}

## Financial Data
- Credit Accounts: ${stats.creditAccounts}
- Total Credits Allocated: ${totalCreditsResult._sum.totalCredits?.toLocaleString() || 0}
- Total Transactions: ${stats.transactions}
- Completed Transactions: ${stats.completedTransactions}

## AI System
- AI Agents: ${stats.aiAgents}
- Active Agents: ${stats.activeAgents}
- AI Requests: ${stats.aiRequests}
- Total Cost: $${totalCostResult._sum.cost?.toFixed(4) || '0.0000'}

## Plugin Ecosystem
- Total Plugins: ${stats.plugins}
- Official Plugins: ${stats.officialPlugins}
- Active Plugins: ${stats.activePlugins}
- User Installations: ${stats.userPluginInstalls}

## Budget Controls
- Budget Limits: ${stats.budgetLimits}
- Active Budget Limits: ${stats.activeBudgetLimits}

## Configuration Used
${JSON.stringify(this.options, null, 2)}
        `;

        console.log(report);
        
        // Save report to file
        const fs = require('fs');
        const path = require('path');
        const reportPath = path.join(process.cwd(), 'database', 'seeds', `seed-report-${Date.now()}.md`);
        fs.writeFileSync(reportPath, report);
        
        console.log(`📄 Seed report saved to: ${reportPath}`);
    }

    private randomDate(start: Date, end: Date): Date {
        return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const options: SeedOptions = {};

    // Parse command line arguments
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace('--', '');
        const value = args[i + 1];

        switch (key) {
            case 'users':
                options.userCount = parseInt(value) || 50;
                break;
            case 'admins':
                options.adminCount = parseInt(value) || 3;
                break;
            case 'transactions':
                options.transactionCount = parseInt(value) || 200;
                break;
            case 'requests':
                options.aiRequestCount = parseInt(value) || 500;
                break;
            case 'plugins':
                options.pluginCount = parseInt(value) || 10;
                break;
            case 'clean':
                options.skipExisting = false;
                break;
            case 'help':
                console.log(`
Usage: npx tsx database/seeds/comprehensive-seed.ts [OPTIONS]

Options:
  --users NUMBER       Number of employee users to create (default: 50)
  --admins NUMBER      Number of admin users to create (default: 3)
  --transactions NUMBER Number of transactions to create (default: 200)
  --requests NUMBER    Number of AI requests to create (default: 500)
  --plugins NUMBER     Number of plugins to create (default: 10)
  --clean             Clean existing data before seeding (default: skip existing)
  --help              Show this help message

Examples:
  npx tsx database/seeds/comprehensive-seed.ts
  npx tsx database/seeds/comprehensive-seed.ts --users 100 --transactions 500
  npx tsx database/seeds/comprehensive-seed.ts --clean --users 25
                `);
                process.exit(0);
        }
    }

    try {
        const seeder = new ComprehensiveSeed(options);
        await seeder.run();
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { ComprehensiveSeed };
