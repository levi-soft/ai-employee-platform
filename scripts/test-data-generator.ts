
import { PrismaClient, Role, TransactionType, TransactionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

/**
 * Advanced Test Data Generator for AI Employee Platform
 * Generates realistic test data for various testing scenarios
 */

const prisma = new PrismaClient();

interface GenerationConfig {
    scenario: 'development' | 'testing' | 'performance' | 'demo' | 'load_test' | 'custom';
    userCount?: number;
    adminRatio?: number;
    transactionMultiplier?: number;
    aiRequestMultiplier?: number;
    timeRange?: {
        start: Date;
        end: Date;
    };
    realistic?: boolean;
    includeProblematicData?: boolean;
    outputSummary?: boolean;
}

interface UserProfile {
    firstName: string;
    lastName: string;
    email: string;
    department: string;
    jobTitle: string;
    usagePattern: 'light' | 'moderate' | 'heavy' | 'sporadic';
    preferredAgents: string[];
    creditBudget: number;
}

class TestDataGenerator {
    private config: GenerationConfig;
    private generatedData: {
        users: number;
        transactions: number;
        aiRequests: number;
        plugins: number;
        userPlugins: number;
    } = {
        users: 0,
        transactions: 0,
        aiRequests: 0,
        plugins: 0,
        userPlugins: 0
    };

    // Realistic data pools
    private firstNames = [
        'Alexander', 'Amelia', 'Benjamin', 'Charlotte', 'Daniel', 'Emma', 'Ethan', 'Grace',
        'Henry', 'Isabella', 'Jack', 'Julia', 'Liam', 'Madison', 'Mason', 'Natalie',
        'Noah', 'Olivia', 'Owen', 'Penelope', 'Samuel', 'Sophia', 'Theodore', 'Victoria',
        'William', 'Zoe', 'Andrew', 'Ava', 'Christopher', 'Chloe', 'David', 'Elizabeth',
        'James', 'Lily', 'Michael', 'Mia', 'Nicholas', 'Rachel', 'Ryan', 'Sarah'
    ];

    private lastNames = [
        'Anderson', 'Brown', 'Davis', 'Garcia', 'Johnson', 'Jones', 'Martinez', 'Miller',
        'Moore', 'Rodriguez', 'Smith', 'Taylor', 'Thomas', 'Wilson', 'Clark', 'Lewis',
        'Robinson', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott',
        'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker',
        'Gonzalez', 'Carter', 'Mitchell', 'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell'
    ];

    private departments = [
        { name: 'Engineering', weight: 30, roles: ['Software Engineer', 'Senior Developer', 'Tech Lead', 'DevOps Engineer'] },
        { name: 'Product Management', weight: 10, roles: ['Product Manager', 'Senior PM', 'Product Owner', 'Strategy Lead'] },
        { name: 'Marketing', weight: 15, roles: ['Marketing Manager', 'Content Creator', 'Growth Hacker', 'Brand Manager'] },
        { name: 'Sales', weight: 20, roles: ['Sales Rep', 'Account Manager', 'Business Development', 'Sales Director'] },
        { name: 'Customer Success', weight: 12, roles: ['Customer Success Manager', 'Support Specialist', 'Account Specialist'] },
        { name: 'Finance', weight: 8, roles: ['Financial Analyst', 'Accountant', 'Controller', 'Finance Manager'] },
        { name: 'Human Resources', weight: 5, roles: ['HR Generalist', 'Recruiter', 'HR Manager', 'People Ops'] }
    ];

    private companies = ['TechCorp', 'InnovateLabs', 'DataSystems', 'CloudFirst', 'NextGen'];

    private aiPromptTemplates = [
        {
            category: 'code_generation',
            templates: [
                'Write a {language} function to {action} with error handling',
                'Create a {language} class that implements {pattern}',
                'Generate unit tests for a {language} function that {description}',
                'Refactor this {language} code to improve performance: {code_snippet}'
            ],
            variables: {
                language: ['Python', 'JavaScript', 'Java', 'Go', 'TypeScript'],
                action: ['calculate fibonacci numbers', 'sort an array', 'validate email', 'parse JSON'],
                pattern: ['singleton pattern', 'factory pattern', 'observer pattern', 'strategy pattern'],
                description: ['validates user input', 'processes data', 'handles API requests']
            }
        },
        {
            category: 'content_writing',
            templates: [
                'Write a professional email to {recipient} about {topic}',
                'Create a {type} for {audience} about {subject}',
                'Draft a {document_type} for {purpose}',
                'Compose a {format} explaining {concept} to {target_audience}'
            ],
            variables: {
                recipient: ['team members', 'clients', 'stakeholders', 'management'],
                topic: ['project updates', 'meeting scheduling', 'policy changes', 'feedback'],
                type: ['blog post', 'article', 'press release', 'social media post'],
                audience: ['developers', 'customers', 'investors', 'employees'],
                subject: ['new product features', 'industry trends', 'company updates'],
                document_type: ['proposal', 'report', 'memo', 'presentation'],
                purpose: ['budget approval', 'project planning', 'team communication'],
                format: ['tutorial', 'guide', 'FAQ', 'documentation'],
                concept: ['machine learning', 'data analysis', 'project management'],
                target_audience: ['beginners', 'experts', 'general public']
            }
        },
        {
            category: 'analysis',
            templates: [
                'Analyze the {data_type} data and provide insights on {metric}',
                'Review the {document_type} and summarize key findings',
                'Compare {item1} and {item2} in terms of {criteria}',
                'Evaluate the {subject} and recommend {action_type}'
            ],
            variables: {
                data_type: ['sales', 'user engagement', 'performance', 'financial', 'market research'],
                metric: ['trends', 'growth patterns', 'anomalies', 'correlations'],
                document_type: ['contract', 'research paper', 'business plan', 'report'],
                item1: ['product A', 'strategy 1', 'option X', 'approach 1'],
                item2: ['product B', 'strategy 2', 'option Y', 'approach 2'],
                criteria: ['cost-effectiveness', 'performance', 'scalability', 'user experience'],
                subject: ['current process', 'system architecture', 'marketing campaign'],
                action_type: ['improvements', 'next steps', 'optimization strategies']
            }
        },
        {
            category: 'creative',
            templates: [
                'Write a {creative_type} about {theme} in {style} style',
                'Create a {content_format} for {purpose} with {tone} tone',
                'Generate {count} {item_type} for {context}',
                'Develop a {creative_format} that {objective}'
            ],
            variables: {
                creative_type: ['short story', 'poem', 'script', 'song lyrics'],
                theme: ['technology', 'future work', 'team collaboration', 'innovation'],
                style: ['humorous', 'professional', 'inspiring', 'educational'],
                content_format: ['slogan', 'tagline', 'headline', 'description'],
                purpose: ['product launch', 'marketing campaign', 'team motivation'],
                tone: ['energetic', 'confident', 'friendly', 'authoritative'],
                count: ['5', '10', '3', '7'],
                item_type: ['ideas', 'names', 'concepts', 'titles'],
                context: ['brainstorming session', 'product naming', 'feature development'],
                creative_format: ['presentation', 'pitch', 'proposal', 'concept'],
                objective: ['engages the audience', 'explains complex ideas', 'motivates action']
            }
        }
    ];

    constructor(config: GenerationConfig) {
        this.config = {
            scenario: 'development',
            userCount: 25,
            adminRatio: 0.1,
            transactionMultiplier: 3,
            aiRequestMultiplier: 5,
            timeRange: {
                start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
                end: new Date()
            },
            realistic: true,
            includeProblematicData: false,
            outputSummary: true,
            ...config
        };

        // Adjust defaults based on scenario
        this.adjustConfigForScenario();
    }

    private adjustConfigForScenario(): void {
        switch (this.config.scenario) {
            case 'development':
                this.config.userCount = Math.min(this.config.userCount || 25, 25);
                this.config.realistic = true;
                break;
            
            case 'testing':
                this.config.userCount = Math.min(this.config.userCount || 50, 100);
                this.config.includeProblematicData = true;
                break;
            
            case 'performance':
                this.config.userCount = Math.max(this.config.userCount || 500, 500);
                this.config.transactionMultiplier = 10;
                this.config.aiRequestMultiplier = 15;
                this.config.realistic = false; // Optimize for speed
                break;
            
            case 'demo':
                this.config.userCount = Math.min(this.config.userCount || 15, 20);
                this.config.realistic = true;
                this.config.includeProblematicData = false;
                break;
            
            case 'load_test':
                this.config.userCount = Math.max(this.config.userCount || 1000, 1000);
                this.config.transactionMultiplier = 5;
                this.config.aiRequestMultiplier = 8;
                this.config.realistic = false;
                break;
        }
    }

    async generate(): Promise<void> {
        console.log(`🎯 Generating test data for scenario: ${this.config.scenario}`);
        console.log(`📊 Configuration: ${JSON.stringify(this.config, null, 2)}`);
        console.log('');

        try {
            // Generate in dependency order
            await this.generateUsers();
            await this.generateCreditAccounts();
            await this.ensureAIAgents();
            await this.generateTransactions();
            await this.generateAIRequests();
            await this.generatePlugins();
            await this.generateUserPlugins();
            await this.generateBudgetLimits();

            // Add problematic data for testing
            if (this.config.includeProblematicData) {
                await this.generateProblematicData();
            }

            if (this.config.outputSummary) {
                await this.generateSummaryReport();
            }

            console.log('✅ Test data generation completed successfully!');

        } catch (error) {
            console.error('❌ Test data generation failed:', error);
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    }

    private async generateUsers(): Promise<void> {
        console.log('👥 Generating users...');
        
        const users: any[] = [];
        const adminCount = Math.ceil(this.config.userCount! * this.config.adminRatio!);
        const employeeCount = this.config.userCount! - adminCount;

        // Generate admin users
        for (let i = 0; i < adminCount; i++) {
            const profile = this.generateUserProfile('admin', i);
            const hashedPassword = await bcrypt.hash(`Admin123!`, 12);
            
            users.push({
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                passwordHash: hashedPassword,
                role: Role.ADMIN,
                isActive: true,
                emailVerified: true,
                metadata: {
                    source: 'test_data_generator',
                    scenario: this.config.scenario,
                    type: 'admin',
                    department: profile.department,
                    jobTitle: profile.jobTitle,
                    generatedAt: new Date().toISOString()
                }
            });
        }

        // Generate employee users
        for (let i = 0; i < employeeCount; i++) {
            const profile = this.generateUserProfile('employee', i);
            const hashedPassword = await bcrypt.hash(`Employee123!`, 12);
            
            users.push({
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                passwordHash: hashedPassword,
                role: Role.EMPLOYEE,
                isActive: Math.random() > 0.05, // 95% active
                emailVerified: Math.random() > 0.02, // 98% verified
                metadata: {
                    source: 'test_data_generator',
                    scenario: this.config.scenario,
                    type: 'employee',
                    department: profile.department,
                    jobTitle: profile.jobTitle,
                    usagePattern: profile.usagePattern,
                    preferredAgents: profile.preferredAgents,
                    creditBudget: profile.creditBudget,
                    generatedAt: new Date().toISOString()
                }
            });
        }

        // Add mandatory test account if not exists
        const existingTestAccount = await prisma.user.findUnique({
            where: { email: 'john@doe.com' }
        });

        if (!existingTestAccount) {
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
        }

        await prisma.user.createMany({ data: users });
        this.generatedData.users = users.length;
        console.log(`✅ Generated ${users.length} users`);
    }

    private generateUserProfile(type: 'admin' | 'employee', index: number): UserProfile {
        const firstName = this.randomChoice(this.firstNames);
        const lastName = this.randomChoice(this.lastNames);
        const department = this.weightedChoice(this.departments);
        const company = this.randomChoice(this.companies);
        
        let email: string;
        if (this.config.realistic) {
            email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.toLowerCase()}.com`;
        } else {
            email = `${type}${index + 1}@testcompany.com`;
        }

        const usagePatterns: Array<'light' | 'moderate' | 'heavy' | 'sporadic'> = ['light', 'moderate', 'heavy', 'sporadic'];
        const usageWeights = [0.3, 0.4, 0.2, 0.1]; // Most users are light to moderate
        
        return {
            firstName,
            lastName,
            email,
            department: department.name,
            jobTitle: this.randomChoice(department.roles),
            usagePattern: this.weightedChoiceSimple(usagePatterns, usageWeights),
            preferredAgents: this.generatePreferredAgents(),
            creditBudget: this.generateCreditBudget(type)
        };
    }

    private generatePreferredAgents(): string[] {
        const agents = ['GPT-4', 'GPT-3.5-Turbo', 'Claude-3-Sonnet', 'Gemini-Pro'];
        const count = Math.floor(Math.random() * 3) + 1; // 1-3 preferred agents
        return this.shuffleArray([...agents]).slice(0, count);
    }

    private generateCreditBudget(type: 'admin' | 'employee'): number {
        if (type === 'admin') {
            return Math.floor(Math.random() * 5000) + 5000; // 5,000-10,000 credits
        } else {
            return Math.floor(Math.random() * 1000) + 200; // 200-1,200 credits
        }
    }

    private async generateCreditAccounts(): Promise<void> {
        console.log('💰 Generating credit accounts...');
        
        const users = await prisma.user.findMany();
        const creditAccounts: any[] = [];

        for (const user of users) {
            const metadata = user.metadata as any;
            const creditBudget = metadata?.creditBudget || (user.role === Role.ADMIN ? 8000 : 500);
            const bonusCredits = Math.floor(Math.random() * creditBudget * 0.1); // Up to 10% bonus
            const usedCredits = Math.floor(Math.random() * creditBudget * 0.3); // Used up to 30%
            
            creditAccounts.push({
                userId: user.id,
                totalCredits: creditBudget + bonusCredits,
                usedCredits,
                bonusCredits,
                lastResetAt: this.randomDateInRange(),
                metadata: {
                    initialAllocation: creditBudget,
                    accountType: user.role === Role.ADMIN ? 'admin' : 'standard',
                    grantedBy: 'test_data_generator',
                    scenario: this.config.scenario
                }
            });
        }

        await prisma.creditAccount.createMany({ data: creditAccounts });
        console.log(`✅ Generated ${creditAccounts.length} credit accounts`);
    }

    private async ensureAIAgents(): Promise<void> {
        console.log('🤖 Ensuring AI agents exist...');
        
        const existingAgents = await prisma.aIAgent.count();
        if (existingAgents === 0) {
            const agents = [
                {
                    name: 'GPT-4',
                    description: 'Most capable GPT model for complex reasoning',
                    provider: 'openai',
                    model: 'gpt-4',
                    costPerToken: 0.00003,
                    isActive: true,
                    capabilities: ['reasoning', 'creative_writing', 'code_generation'],
                    maxTokens: 8192,
                    metadata: { context_window: 8192 }
                },
                {
                    name: 'GPT-3.5-Turbo',
                    description: 'Fast and efficient for most tasks',
                    provider: 'openai',
                    model: 'gpt-3.5-turbo',
                    costPerToken: 0.0000015,
                    isActive: true,
                    capabilities: ['conversation', 'summarization'],
                    maxTokens: 4096,
                    metadata: { context_window: 4096 }
                },
                {
                    name: 'Claude-3-Sonnet',
                    description: 'Balanced model for analysis',
                    provider: 'anthropic',
                    model: 'claude-3-sonnet',
                    costPerToken: 0.000015,
                    isActive: true,
                    capabilities: ['analysis', 'safety', 'reasoning'],
                    maxTokens: 200000,
                    metadata: { context_window: 200000 }
                },
                {
                    name: 'Gemini-Pro',
                    description: 'Multimodal AI model',
                    provider: 'google',
                    model: 'gemini-pro',
                    costPerToken: 0.0000005,
                    isActive: true,
                    capabilities: ['multimodal', 'reasoning'],
                    maxTokens: 32768,
                    metadata: { context_window: 32768 }
                }
            ];

            await prisma.aIAgent.createMany({ data: agents });
            console.log(`✅ Created ${agents.length} AI agents`);
        } else {
            console.log(`✅ Found ${existingAgents} existing AI agents`);
        }
    }

    private async generateTransactions(): Promise<void> {
        console.log('💳 Generating transactions...');
        
        const users = await prisma.user.findMany({ include: { creditAccount: true } });
        const transactions: any[] = [];
        const transactionCount = this.config.userCount! * this.config.transactionMultiplier!;

        for (let i = 0; i < transactionCount; i++) {
            const user = this.randomChoice(users);
            const transactionType = this.weightedChoiceSimple(
                [TransactionType.CREDIT_PURCHASE, TransactionType.CREDIT_USAGE, TransactionType.BONUS_CREDIT, TransactionType.REFUND],
                [0.4, 0.45, 0.1, 0.05]
            );

            let amount: number;
            let description: string;

            switch (transactionType) {
                case TransactionType.CREDIT_PURCHASE:
                    amount = this.generatePurchaseAmount();
                    description = `Credit purchase - ${amount} credits`;
                    break;
                case TransactionType.CREDIT_USAGE:
                    amount = -this.generateUsageAmount(user);
                    description = `AI request usage - ${Math.abs(amount)} credits`;
                    break;
                case TransactionType.BONUS_CREDIT:
                    amount = Math.floor(Math.random() * 100) + 25;
                    description = `Bonus credits - ${this.randomChoice(['welcome bonus', 'monthly bonus', 'referral bonus'])}`;
                    break;
                case TransactionType.REFUND:
                    amount = Math.floor(Math.random() * 25) + 5;
                    description = `Refund - ${this.randomChoice(['failed request', 'service issue', 'billing error'])}`;
                    break;
            }

            const status = this.weightedChoiceSimple(
                [TransactionStatus.COMPLETED, TransactionStatus.PENDING, TransactionStatus.FAILED],
                [0.92, 0.05, 0.03]
            );

            transactions.push({
                userId: user.id,
                amount,
                type: transactionType,
                status,
                description,
                metadata: {
                    source: 'test_data_generator',
                    scenario: this.config.scenario,
                    transactionId: `TXN-${Date.now()}-${i}`,
                    userEmail: user.email,
                    generatedAt: new Date().toISOString()
                },
                createdAt: this.randomDateInRange()
            });
        }

        await prisma.transaction.createMany({ data: transactions });
        this.generatedData.transactions = transactions.length;
        console.log(`✅ Generated ${transactions.length} transactions`);
    }

    private generatePurchaseAmount(): number {
        const amounts = [100, 250, 500, 1000, 2500];
        const weights = [0.4, 0.3, 0.15, 0.1, 0.05];
        return this.weightedChoiceSimple(amounts, weights);
    }

    private generateUsageAmount(user: any): number {
        const metadata = user.metadata as any;
        const usagePattern = metadata?.usagePattern || 'moderate';
        
        switch (usagePattern) {
            case 'light':
                return Math.floor(Math.random() * 10) + 1; // 1-10 credits
            case 'moderate':
                return Math.floor(Math.random() * 25) + 5; // 5-30 credits
            case 'heavy':
                return Math.floor(Math.random() * 50) + 20; // 20-70 credits
            case 'sporadic':
                return Math.random() > 0.7 ? Math.floor(Math.random() * 100) + 10 : Math.floor(Math.random() * 5) + 1;
            default:
                return Math.floor(Math.random() * 15) + 5;
        }
    }

    private async generateAIRequests(): Promise<void> {
        console.log('🧠 Generating AI requests...');
        
        const users = await prisma.user.findMany();
        const agents = await prisma.aIAgent.findMany({ where: { isActive: true } });
        const requests: any[] = [];
        const requestCount = this.config.userCount! * this.config.aiRequestMultiplier!;

        for (let i = 0; i < requestCount; i++) {
            const user = this.randomChoice(users);
            const userMetadata = user.metadata as any;
            
            // Choose agent based on user preferences if available
            let agent: any;
            if (userMetadata?.preferredAgents && Math.random() > 0.3) {
                const preferredNames = userMetadata.preferredAgents;
                const preferredAgents = agents.filter(a => preferredNames.includes(a.name));
                agent = preferredAgents.length > 0 ? this.randomChoice(preferredAgents) : this.randomChoice(agents);
            } else {
                agent = this.randomChoice(agents);
            }

            const promptData = this.generateAIPrompt(userMetadata?.department);
            const tokensUsed = this.estimateTokenUsage(promptData.prompt);
            const cost = tokensUsed * agent.costPerToken;
            const responseTime = this.generateResponseTime(agent.name, tokensUsed);
            
            const requestStatus = this.weightedChoiceSimple(
                ['completed', 'failed', 'timeout'],
                [0.93, 0.05, 0.02]
            );

            requests.push({
                userId: user.id,
                agentId: agent.id,
                prompt: promptData.prompt,
                response: requestStatus === 'completed' ? this.generateAIResponse(promptData) : null,
                tokensUsed: requestStatus === 'completed' ? tokensUsed : 0,
                cost: requestStatus === 'completed' ? cost : 0,
                responseTimeMs: responseTime,
                metadata: {
                    source: 'test_data_generator',
                    scenario: this.config.scenario,
                    requestId: `REQ-${Date.now()}-${i}`,
                    category: promptData.category,
                    status: requestStatus,
                    agentModel: agent.model,
                    agentProvider: agent.provider,
                    userDepartment: userMetadata?.department || 'unknown',
                    estimatedComplexity: promptData.complexity
                },
                createdAt: this.randomDateInRange()
            });
        }

        await prisma.aIRequest.createMany({ data: requests });
        this.generatedData.aiRequests = requests.length;
        console.log(`✅ Generated ${requests.length} AI requests`);
    }

    private generateAIPrompt(department?: string): { prompt: string; category: string; complexity: number } {
        const template = this.randomChoice(this.aiPromptTemplates);
        const promptTemplate = this.randomChoice(template.templates);
        
        // Replace variables in template
        let prompt = promptTemplate;
        const variableRegex = /{(\w+)}/g;
        prompt = prompt.replace(variableRegex, (match, variable) => {
            const options = template.variables[variable];
            return options ? this.randomChoice(options) : match;
        });

        // Add department-specific context if available
        if (department && Math.random() > 0.7) {
            const contextPhrases = [
                `for our ${department} team`,
                `related to ${department} work`,
                `that helps with ${department} tasks`
            ];
            prompt += ` ${this.randomChoice(contextPhrases)}`;
        }

        const complexity = this.assessPromptComplexity(prompt);

        return {
            prompt,
            category: template.category,
            complexity
        };
    }

    private estimateTokenUsage(prompt: string): number {
        // Rough estimation: ~4 characters per token
        const promptTokens = Math.ceil(prompt.length / 4);
        const responseTokens = Math.floor(Math.random() * 200) + 50; // 50-250 response tokens
        return promptTokens + responseTokens;
    }

    private generateResponseTime(agentName: string, tokens: number): number {
        const baseTime = {
            'GPT-4': 5000,
            'GPT-3.5-Turbo': 2000,
            'Claude-3-Sonnet': 4000,
            'Gemini-Pro': 3000
        }[agentName] || 3000;

        const tokenFactor = tokens / 100; // More tokens = longer time
        const randomFactor = Math.random() * 0.5 + 0.75; // 75-125% variation
        
        return Math.floor(baseTime * tokenFactor * randomFactor);
    }

    private generateAIResponse(promptData: { prompt: string; category: string }): string {
        const responses = {
            code_generation: [
                "Here's a solution that implements the requested functionality with proper error handling and documentation.",
                "I've created the code with best practices in mind, including input validation and clear variable names.",
                "The implementation includes comprehensive error handling and follows coding standards."
            ],
            content_writing: [
                "I've crafted a professional and engaging piece that addresses all your key points.",
                "The content is structured for clarity and includes a compelling call-to-action.",
                "I've written this with your target audience in mind, using appropriate tone and style."
            ],
            analysis: [
                "Based on my analysis, I've identified several key patterns and actionable insights.",
                "The data reveals interesting trends that can inform your decision-making process.",
                "I've provided a comprehensive breakdown with specific recommendations."
            ],
            creative: [
                "I've created an engaging piece that captures the essence of your request with creativity and flair.",
                "The content balances creativity with your practical requirements and brand voice.",
                "I've developed something unique that should resonate well with your intended audience."
            ]
        };

        const categoryResponses = responses[promptData.category as keyof typeof responses] || responses.content_writing;
        return this.randomChoice(categoryResponses);
    }

    private assessPromptComplexity(prompt: string): number {
        let score = 1;
        score += Math.min(prompt.split(' ').length / 20, 3); // Length factor
        score += (prompt.match(/[?]/g) || []).length * 0.5; // Question complexity
        score += /complex|detailed|comprehensive|analyze|generate|create/.test(prompt.toLowerCase()) ? 2 : 0;
        return Math.min(Math.round(score), 5);
    }

    private async generatePlugins(): Promise<void> {
        console.log('🔌 Generating plugins...');
        
        const existingPlugins = await prisma.plugin.count();
        if (existingPlugins > 0) {
            console.log(`✅ Found ${existingPlugins} existing plugins, skipping generation`);
            return;
        }

        const plugins = [
            {
                name: 'Document Analyzer Pro',
                description: 'Advanced document analysis with AI insights',
                version: '2.1.0',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 1520,
                rating: 4.8,
                metadata: {
                    category: 'productivity',
                    tags: ['documents', 'analysis', 'ai'],
                    features: ['text_extraction', 'summarization', 'insights'],
                    scenario: this.config.scenario
                }
            },
            {
                name: 'Code Assistant',
                description: 'AI-powered code generation and review',
                version: '3.0.2',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 2340,
                rating: 4.9,
                metadata: {
                    category: 'development',
                    tags: ['code', 'ai', 'productivity'],
                    features: ['generation', 'review', 'optimization'],
                    scenario: this.config.scenario
                }
            },
            {
                name: 'Data Visualizer',
                description: 'Create stunning charts from your data',
                version: '1.8.5',
                author: 'AI Platform Team',
                isActive: true,
                isOfficial: true,
                downloadCount: 890,
                rating: 4.6,
                metadata: {
                    category: 'analytics',
                    tags: ['charts', 'visualization', 'data'],
                    features: ['interactive_charts', 'export', 'templates'],
                    scenario: this.config.scenario
                }
            },
            {
                name: 'Smart Translator',
                description: 'Context-aware AI translation',
                version: '1.5.3',
                author: 'Community Developer',
                isActive: true,
                isOfficial: false,
                downloadCount: 670,
                rating: 4.3,
                metadata: {
                    category: 'language',
                    tags: ['translation', 'ai', 'multilingual'],
                    features: ['context_aware', 'batch_processing'],
                    scenario: this.config.scenario
                }
            },
            {
                name: 'Meeting Assistant',
                description: 'Automatically generate meeting summaries',
                version: '1.2.1',
                author: 'Community Developer',
                isActive: Math.random() > 0.2, // 80% active
                isOfficial: false,
                downloadCount: 340,
                rating: 4.1,
                metadata: {
                    category: 'productivity',
                    tags: ['meetings', 'notes', 'transcription'],
                    features: ['auto_summary', 'action_items'],
                    scenario: this.config.scenario
                }
            }
        ];

        await prisma.plugin.createMany({ data: plugins });
        this.generatedData.plugins = plugins.length;
        console.log(`✅ Generated ${plugins.length} plugins`);
    }

    private async generateUserPlugins(): Promise<void> {
        console.log('🔗 Generating user-plugin relationships...');
        
        const users = await prisma.user.findMany();
        const plugins = await prisma.plugin.findMany({ where: { isActive: true } });
        const userPlugins: any[] = [];

        for (const user of users) {
            const userMetadata = user.metadata as any;
            const usagePattern = userMetadata?.usagePattern || 'moderate';
            
            // Determine how many plugins this user should have
            let pluginCount: number;
            switch (usagePattern) {
                case 'light':
                    pluginCount = Math.floor(Math.random() * 2) + 1; // 1-2 plugins
                    break;
                case 'moderate':
                    pluginCount = Math.floor(Math.random() * 3) + 2; // 2-4 plugins
                    break;
                case 'heavy':
                    pluginCount = Math.floor(Math.random() * 4) + 3; // 3-6 plugins
                    break;
                case 'sporadic':
                    pluginCount = Math.random() > 0.5 ? 1 : Math.floor(Math.random() * 3) + 1;
                    break;
                default:
                    pluginCount = Math.floor(Math.random() * 3) + 1;
            }

            pluginCount = Math.min(pluginCount, plugins.length);
            const userPluginSelection = this.shuffleArray([...plugins]).slice(0, pluginCount);

            for (const plugin of userPluginSelection) {
                const installedAt = this.randomDateInRange();
                const hasUsed = Math.random() > 0.2; // 80% have used their installed plugins
                const usageCount = hasUsed ? this.generatePluginUsageCount(usagePattern) : 0;
                const lastUsed = hasUsed && usageCount > 0 ? 
                    new Date(installedAt.getTime() + Math.random() * (Date.now() - installedAt.getTime())) : null;

                userPlugins.push({
                    userId: user.id,
                    pluginId: plugin.id,
                    isEnabled: Math.random() > 0.1, // 90% enabled
                    installedAt,
                    lastUsedAt: lastUsed,
                    usageCount,
                    settings: {
                        theme: this.randomChoice(['light', 'dark', 'auto']),
                        notifications: Math.random() > 0.3,
                        autoUpdate: Math.random() > 0.2,
                        customConfig: {
                            maxResults: Math.floor(Math.random() * 20) + 10,
                            language: 'en',
                            advancedMode: Math.random() > 0.6
                        }
                    }
                });
            }
        }

        await prisma.userPlugin.createMany({ data: userPlugins });
        this.generatedData.userPlugins = userPlugins.length;
        console.log(`✅ Generated ${userPlugins.length} user-plugin relationships`);
    }

    private generatePluginUsageCount(usagePattern: string): number {
        switch (usagePattern) {
            case 'light':
                return Math.floor(Math.random() * 10) + 1; // 1-10 uses
            case 'moderate':
                return Math.floor(Math.random() * 30) + 10; // 10-40 uses
            case 'heavy':
                return Math.floor(Math.random() * 100) + 30; // 30-130 uses
            case 'sporadic':
                return Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : Math.floor(Math.random() * 50) + 10;
            default:
                return Math.floor(Math.random() * 20) + 5;
        }
    }

    private async generateBudgetLimits(): Promise<void> {
        console.log('💰 Generating budget limits...');
        
        const employees = await prisma.user.findMany({ where: { role: Role.EMPLOYEE } });
        const budgetLimits: any[] = [];

        for (const employee of employees) {
            // Only some employees have budget limits (70%)
            if (Math.random() > 0.3) {
                const employeeMetadata = employee.metadata as any;
                const usagePattern = employeeMetadata?.usagePattern || 'moderate';
                
                let dailyLimit: number;
                switch (usagePattern) {
                    case 'light':
                        dailyLimit = Math.floor(Math.random() * 20) + 10; // 10-30 credits/day
                        break;
                    case 'moderate':
                        dailyLimit = Math.floor(Math.random() * 30) + 25; // 25-55 credits/day
                        break;
                    case 'heavy':
                        dailyLimit = Math.floor(Math.random() * 50) + 50; // 50-100 credits/day
                        break;
                    case 'sporadic':
                        dailyLimit = Math.floor(Math.random() * 40) + 15; // 15-55 credits/day
                        break;
                    default:
                        dailyLimit = Math.floor(Math.random() * 30) + 20;
                }

                const monthlyLimit = dailyLimit * 28; // ~1 month
                const currentDailyUsage = Math.floor(Math.random() * dailyLimit * 0.8); // Used up to 80%
                const currentMonthlyUsage = Math.floor(Math.random() * monthlyLimit * 0.6); // Used up to 60%

                budgetLimits.push({
                    userId: employee.id,
                    dailyLimit,
                    monthlyLimit,
                    currentDailyUsage,
                    currentMonthlyUsage,
                    isActive: Math.random() > 0.05, // 95% active
                    alertThreshold: 0.8, // Alert at 80%
                    metadata: {
                        setBy: 'test_data_generator',
                        reason: `Budget limit for ${usagePattern} user`,
                        department: employeeMetadata?.department || 'General',
                        scenario: this.config.scenario
                    }
                });
            }
        }

        await prisma.budgetLimit.createMany({ data: budgetLimits });
        console.log(`✅ Generated ${budgetLimits.length} budget limits`);
    }

    private async generateProblematicData(): Promise<void> {
        console.log('⚠️ Generating problematic data for testing...');
        
        // Create user with invalid email (for testing validation)
        try {
            await prisma.user.create({
                data: {
                    email: 'invalid-email-format',
                    firstName: 'Test',
                    lastName: 'Invalid',
                    passwordHash: await bcrypt.hash('test123', 12),
                    role: Role.EMPLOYEE,
                    isActive: true,
                    emailVerified: false,
                    metadata: {
                        source: 'problematic_test_data',
                        issue: 'invalid_email_format'
                    }
                }
            });
        } catch (error) {
            // Email validation might prevent this, which is expected
        }

        // Create transactions with edge cases
        const users = await prisma.user.findMany({ take: 2 });
        if (users.length >= 2) {
            const problematicTransactions = [
                {
                    userId: users[0].id,
                    amount: 0, // Zero amount transaction
                    type: TransactionType.CREDIT_PURCHASE,
                    status: TransactionStatus.COMPLETED,
                    description: 'Zero amount test transaction',
                    metadata: { issue: 'zero_amount' }
                },
                {
                    userId: users[1].id,
                    amount: -1000000, // Extremely large negative amount
                    type: TransactionType.CREDIT_USAGE,
                    status: TransactionStatus.COMPLETED,
                    description: 'Large negative amount test',
                    metadata: { issue: 'large_negative_amount' }
                }
            ];

            try {
                await prisma.transaction.createMany({ data: problematicTransactions });
            } catch (error) {
                console.log('Some problematic transactions were rejected (expected)');
            }
        }

        console.log('✅ Generated problematic test data');
    }

    private async generateSummaryReport(): Promise<void> {
        console.log('📊 Generating summary report...');
        
        const stats = {
            ...this.generatedData,
            totalUsers: await prisma.user.count(),
            totalCreditAccounts: await prisma.creditAccount.count(),
            totalTransactions: await prisma.transaction.count(),
            totalAIRequests: await prisma.aIRequest.count(),
            totalPlugins: await prisma.plugin.count(),
            totalUserPlugins: await prisma.userPlugin.count(),
            totalBudgetLimits: await prisma.budgetLimit.count()
        };

        const totalCreditsResult = await prisma.creditAccount.aggregate({
            _sum: { totalCredits: true }
        });

        const totalCostResult = await prisma.aIRequest.aggregate({
            _sum: { cost: true }
        });

        const report = `# Test Data Generation Report

Generated: ${new Date().toISOString()}
Scenario: ${this.config.scenario}
Configuration: ${JSON.stringify(this.config, null, 2)}

## Generated Data Summary

### Users & Accounts
- Users Generated: ${this.generatedData.users}
- Total Users in DB: ${stats.totalUsers}
- Credit Accounts: ${stats.totalCreditAccounts}
- Total Credits Allocated: ${totalCreditsResult._sum.totalCredits?.toLocaleString() || 0}

### Transactions & AI Usage
- Transactions Generated: ${this.generatedData.transactions}
- Total Transactions in DB: ${stats.totalTransactions}
- AI Requests Generated: ${this.generatedData.aiRequests}
- Total AI Requests in DB: ${stats.totalAIRequests}
- Total AI Cost: $${totalCostResult._sum.cost?.toFixed(4) || '0.0000'}

### Plugin Ecosystem
- Plugins Generated: ${this.generatedData.plugins}
- Total Plugins in DB: ${stats.totalPlugins}
- User-Plugin Relations Generated: ${this.generatedData.userPlugins}
- Total User-Plugin Relations: ${stats.totalUserPlugins}

### Budget Management
- Budget Limits: ${stats.totalBudgetLimits}

## Test Scenarios Covered

${this.config.scenario === 'testing' && this.config.includeProblematicData ? 
    '- Edge cases and validation scenarios\n- Problematic data for error handling tests\n' : ''}
${this.config.realistic ? '- Realistic user behavior patterns\n- Department-based user distribution\n' : ''}
- Multiple usage patterns (light, moderate, heavy, sporadic)
- Various transaction types and statuses
- Different AI request categories and complexities
- Plugin installation and usage patterns
- Budget limit scenarios

## Recommended Next Steps

1. Run data validation scripts to verify data integrity
2. Test application functionality with generated data
3. Perform load testing if using performance scenario
4. Review user patterns and adjust as needed for specific test cases

---

Generated by AI Employee Platform Test Data Generator
        `;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(process.cwd(), 'database', 'seeds', `test-data-report-${timestamp}.md`);
        
        fs.writeFileSync(reportPath, report);
        console.log(`📄 Summary report saved to: ${reportPath}`);
        
        console.log('\n📊 GENERATION SUMMARY');
        console.log('='.repeat(40));
        console.log(`Scenario: ${this.config.scenario}`);
        console.log(`Users: ${this.generatedData.users}`);
        console.log(`Transactions: ${this.generatedData.transactions}`);
        console.log(`AI Requests: ${this.generatedData.aiRequests}`);
        console.log(`Plugins: ${this.generatedData.plugins}`);
        console.log(`User-Plugin Relations: ${this.generatedData.userPlugins}`);
    }

    // Utility methods
    private randomChoice<T>(array: T[]): T {
        return array[Math.floor(Math.random() * array.length)];
    }

    private weightedChoice(items: Array<{ name: string; weight: number; roles: string[] }>): { name: string; roles: string[] } {
        const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
        const random = Math.random() * totalWeight;
        
        let currentWeight = 0;
        for (const item of items) {
            currentWeight += item.weight;
            if (random <= currentWeight) {
                return { name: item.name, roles: item.roles };
            }
        }
        
        return items[0];
    }

    private weightedChoiceSimple<T>(items: T[], weights: number[]): T {
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const random = Math.random() * totalWeight;
        
        let currentWeight = 0;
        for (let i = 0; i < items.length; i++) {
            currentWeight += weights[i];
            if (random <= currentWeight) {
                return items[i];
            }
        }
        
        return items[0];
    }

    private shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    private randomDateInRange(): Date {
        const start = this.config.timeRange!.start.getTime();
        const end = this.config.timeRange!.end.getTime();
        return new Date(start + Math.random() * (end - start));
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Test Data Generator for AI Employee Platform

Usage: npx tsx scripts/test-data-generator.ts [OPTIONS]

Options:
  --scenario TYPE     Generation scenario (development, testing, performance, demo, load_test, custom)
  --users NUMBER      Number of users to generate
  --admins RATIO      Admin ratio (0.0-1.0)
  --realistic         Use realistic data patterns
  --problematic       Include problematic data for testing
  --no-summary        Skip summary report generation
  --help             Show this help message

Scenarios:
  development        Small dataset for development (25 users, realistic)
  testing           Medium dataset with edge cases (50-100 users)
  performance       Large dataset optimized for speed (500+ users)
  demo             Small, clean dataset for demonstrations (15-20 users)
  load_test        Very large dataset for load testing (1000+ users)
  custom           Use custom parameters

Examples:
  npx tsx scripts/test-data-generator.ts --scenario development
  npx tsx scripts/test-data-generator.ts --scenario testing --problematic
  npx tsx scripts/test-data-generator.ts --scenario custom --users 100 --realistic
  npx tsx scripts/test-data-generator.ts --scenario performance --users 1000
        `);
        process.exit(0);
    }

    // Parse arguments
    const config: GenerationConfig = {
        scenario: 'development'
    };

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace('--', '');
        const value = args[i + 1];

        switch (key) {
            case 'scenario':
                config.scenario = value as any;
                break;
            case 'users':
                config.userCount = parseInt(value) || 25;
                break;
            case 'admins':
                config.adminRatio = parseFloat(value) || 0.1;
                break;
            case 'realistic':
                config.realistic = true;
                i--; // No value for this flag
                break;
            case 'problematic':
                config.includeProblematicData = true;
                i--; // No value for this flag
                break;
            case 'no-summary':
                config.outputSummary = false;
                i--; // No value for this flag
                break;
        }
    }

    try {
        const generator = new TestDataGenerator(config);
        await generator.generate();
    } catch (error) {
        console.error('❌ Test data generation failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { TestDataGenerator, type GenerationConfig };
