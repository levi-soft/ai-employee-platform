
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

/**
 * Data Validation Scripts for AI Employee Platform
 * Validates data integrity, relationships, and business rules
 */

const prisma = new PrismaClient();

interface ValidationResult {
    ruleName: string;
    passed: boolean;
    recordsChecked: number;
    violationCount: number;
    violations: any[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    recommendation?: string;
}

interface ValidationReport {
    timestamp: string;
    totalRules: number;
    passedRules: number;
    failedRules: number;
    criticalViolations: number;
    highViolations: number;
    results: ValidationResult[];
    overallStatus: 'PASS' | 'FAIL' | 'WARNING';
}

class DataValidator {
    private results: ValidationResult[] = [];

    async runAllValidations(): Promise<ValidationReport> {
        console.log('🔍 Starting comprehensive data validation...');
        this.results = [];

        // User data validations
        await this.validateUserData();
        await this.validateUserEmailUniqueness();
        await this.validateUserRoles();
        await this.validatePasswordHashes();

        // Credit system validations
        await this.validateCreditAccountConsistency();
        await this.validateCreditBalances();
        await this.validateTransactionIntegrity();

        // AI system validations
        await this.validateAIAgentConfiguration();
        await this.validateAIRequestData();
        await this.validateAIRequestCosts();

        // Plugin system validations
        await this.validatePluginData();
        await this.validateUserPluginRelationships();

        // Business rule validations
        await this.validateBudgetLimits();
        await this.validateDataConsistency();
        await this.validateMetadataStructure();

        // Referential integrity validations
        await this.validateReferentialIntegrity();

        // Performance validations
        await this.validateDataDistribution();

        return this.generateReport();
    }

    private async validateUserData(): Promise<void> {
        console.log('👥 Validating user data...');
        
        const users = await prisma.user.findMany();
        const violations: any[] = [];

        for (const user of users) {
            // Check email format
            if (!this.isValidEmail(user.email)) {
                violations.push({
                    userId: user.id,
                    email: user.email,
                    issue: 'Invalid email format'
                });
            }

            // Check name fields
            if (!user.firstName?.trim() || !user.lastName?.trim()) {
                violations.push({
                    userId: user.id,
                    email: user.email,
                    issue: 'Missing first name or last name'
                });
            }

            // Check metadata structure for employees
            if (user.role === 'EMPLOYEE' && user.metadata) {
                const metadata = user.metadata as any;
                if (!metadata.department || !metadata.employeeId) {
                    violations.push({
                        userId: user.id,
                        email: user.email,
                        issue: 'Employee missing required metadata (department/employeeId)'
                    });
                }
            }
        }

        this.results.push({
            ruleName: 'User Data Integrity',
            passed: violations.length === 0,
            recordsChecked: users.length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates user data fields for completeness and format',
            recommendation: violations.length > 0 ? 'Fix user data with missing or invalid fields' : undefined
        });
    }

    private async validateUserEmailUniqueness(): Promise<void> {
        console.log('📧 Validating email uniqueness...');
        
        const emailCounts = await prisma.user.groupBy({
            by: ['email'],
            _count: {
                email: true
            },
            having: {
                email: {
                    _count: {
                        gt: 1
                    }
                }
            }
        });

        const violations = emailCounts.map(group => ({
            email: group.email,
            count: group._count.email,
            issue: 'Duplicate email address'
        }));

        this.results.push({
            ruleName: 'Email Uniqueness',
            passed: violations.length === 0,
            recordsChecked: await prisma.user.count(),
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'CRITICAL' : 'LOW',
            description: 'Ensures all user email addresses are unique',
            recommendation: violations.length > 0 ? 'Remove or merge duplicate email accounts' : undefined
        });
    }

    private async validateUserRoles(): Promise<void> {
        console.log('🔐 Validating user roles...');
        
        const users = await prisma.user.findMany();
        const validRoles = ['ADMIN', 'EMPLOYEE'];
        const violations: any[] = [];

        for (const user of users) {
            if (!validRoles.includes(user.role)) {
                violations.push({
                    userId: user.id,
                    email: user.email,
                    currentRole: user.role,
                    issue: 'Invalid user role'
                });
            }
        }

        // Check admin count (should have at least 1, but not more than reasonable)
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
        if (adminCount === 0) {
            violations.push({
                issue: 'No admin users found - system needs at least one admin',
                severity: 'CRITICAL'
            });
        } else if (adminCount > 10) {
            violations.push({
                issue: `Too many admin users (${adminCount}) - security risk`,
                severity: 'MEDIUM'
            });
        }

        this.results.push({
            ruleName: 'User Role Validation',
            passed: violations.length === 0,
            recordsChecked: users.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.severity === 'CRITICAL') ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates user roles and admin count',
            recommendation: violations.length > 0 ? 'Fix invalid roles and ensure proper admin count' : undefined
        });
    }

    private async validatePasswordHashes(): Promise<void> {
        console.log('🔒 Validating password hashes...');
        
        const users = await prisma.user.findMany();
        const violations: any[] = [];

        for (const user of users) {
            // Check if password hash exists
            if (!user.passwordHash) {
                violations.push({
                    userId: user.id,
                    email: user.email,
                    issue: 'Missing password hash'
                });
            } else {
                // Check bcrypt hash format (should start with $2a$, $2b$, or $2y$)
                if (!user.passwordHash.match(/^\$2[aby]\$/)) {
                    violations.push({
                        userId: user.id,
                        email: user.email,
                        issue: 'Invalid password hash format'
                    });
                }
            }
        }

        this.results.push({
            ruleName: 'Password Hash Validation',
            passed: violations.length === 0,
            recordsChecked: users.length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'CRITICAL' : 'LOW',
            description: 'Validates password hash existence and format',
            recommendation: violations.length > 0 ? 'Fix users with missing or invalid password hashes' : undefined
        });
    }

    private async validateCreditAccountConsistency(): Promise<void> {
        console.log('💰 Validating credit account consistency...');
        
        // Check that every user has a credit account
        const usersWithoutCredits = await prisma.user.findMany({
            where: {
                creditAccount: null
            }
        });

        // Check that every credit account has a user
        const creditsWithoutUsers = await prisma.creditAccount.findMany({
            where: {
                user: null
            }
        });

        const violations = [
            ...usersWithoutCredits.map(user => ({
                userId: user.id,
                email: user.email,
                issue: 'User without credit account'
            })),
            ...creditsWithoutUsers.map(account => ({
                creditAccountId: account.id,
                userId: account.userId,
                issue: 'Credit account without user'
            }))
        ];

        this.results.push({
            ruleName: 'Credit Account Consistency',
            passed: violations.length === 0,
            recordsChecked: await prisma.user.count() + await prisma.creditAccount.count(),
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Ensures every user has exactly one credit account',
            recommendation: violations.length > 0 ? 'Create missing credit accounts or fix orphaned accounts' : undefined
        });
    }

    private async validateCreditBalances(): Promise<void> {
        console.log('💳 Validating credit balances...');
        
        const creditAccounts = await prisma.creditAccount.findMany();
        const violations: any[] = [];

        for (const account of creditAccounts) {
            // Check for negative balances
            const remainingCredits = account.totalCredits - account.usedCredits;
            if (remainingCredits < 0) {
                violations.push({
                    creditAccountId: account.id,
                    userId: account.userId,
                    totalCredits: account.totalCredits,
                    usedCredits: account.usedCredits,
                    deficit: Math.abs(remainingCredits),
                    issue: 'Negative credit balance'
                });
            }

            // Check for unrealistic credit amounts
            if (account.totalCredits > 100000) {
                violations.push({
                    creditAccountId: account.id,
                    userId: account.userId,
                    totalCredits: account.totalCredits,
                    issue: 'Unrealistically high credit amount',
                    severity: 'MEDIUM'
                });
            }

            // Check for bonus credits exceeding total
            if (account.bonusCredits > account.totalCredits) {
                violations.push({
                    creditAccountId: account.id,
                    userId: account.userId,
                    bonusCredits: account.bonusCredits,
                    totalCredits: account.totalCredits,
                    issue: 'Bonus credits exceed total credits'
                });
            }
        }

        this.results.push({
            ruleName: 'Credit Balance Validation',
            passed: violations.length === 0,
            recordsChecked: creditAccounts.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.issue.includes('Negative')) ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates credit balances for logical consistency',
            recommendation: violations.length > 0 ? 'Fix accounts with invalid credit balances' : undefined
        });
    }

    private async validateTransactionIntegrity(): Promise<void> {
        console.log('📊 Validating transaction integrity...');
        
        const transactions = await prisma.transaction.findMany({
            include: { user: true }
        });
        
        const violations: any[] = [];

        for (const transaction of transactions) {
            // Check for transactions without users
            if (!transaction.user) {
                violations.push({
                    transactionId: transaction.id,
                    userId: transaction.userId,
                    issue: 'Transaction references non-existent user'
                });
            }

            // Check for zero amount transactions
            if (transaction.amount === 0) {
                violations.push({
                    transactionId: transaction.id,
                    amount: transaction.amount,
                    issue: 'Transaction with zero amount',
                    severity: 'MEDIUM'
                });
            }

            // Check transaction type consistency
            if (transaction.type === 'CREDIT_USAGE' && transaction.amount > 0) {
                violations.push({
                    transactionId: transaction.id,
                    type: transaction.type,
                    amount: transaction.amount,
                    issue: 'Credit usage transaction with positive amount'
                });
            } else if ((transaction.type === 'CREDIT_PURCHASE' || transaction.type === 'BONUS_CREDIT') && transaction.amount < 0) {
                violations.push({
                    transactionId: transaction.id,
                    type: transaction.type,
                    amount: transaction.amount,
                    issue: 'Credit addition transaction with negative amount'
                });
            }

            // Check for missing descriptions
            if (!transaction.description?.trim()) {
                violations.push({
                    transactionId: transaction.id,
                    issue: 'Transaction missing description',
                    severity: 'MEDIUM'
                });
            }
        }

        this.results.push({
            ruleName: 'Transaction Integrity',
            passed: violations.length === 0,
            recordsChecked: transactions.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.issue.includes('non-existent user')) ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates transaction data integrity and business rules',
            recommendation: violations.length > 0 ? 'Fix transactions with data integrity issues' : undefined
        });
    }

    private async validateAIAgentConfiguration(): Promise<void> {
        console.log('🤖 Validating AI agent configuration...');
        
        const agents = await prisma.aIAgent.findMany();
        const violations: any[] = [];

        for (const agent of agents) {
            // Check for required fields
            if (!agent.name?.trim()) {
                violations.push({
                    agentId: agent.id,
                    issue: 'Agent missing name'
                });
            }

            if (!agent.provider?.trim()) {
                violations.push({
                    agentId: agent.id,
                    name: agent.name,
                    issue: 'Agent missing provider'
                });
            }

            if (!agent.model?.trim()) {
                violations.push({
                    agentId: agent.id,
                    name: agent.name,
                    issue: 'Agent missing model'
                });
            }

            // Check cost per token
            if (agent.costPerToken <= 0) {
                violations.push({
                    agentId: agent.id,
                    name: agent.name,
                    costPerToken: agent.costPerToken,
                    issue: 'Agent has invalid cost per token'
                });
            }

            // Check max tokens
            if (agent.maxTokens <= 0) {
                violations.push({
                    agentId: agent.id,
                    name: agent.name,
                    maxTokens: agent.maxTokens,
                    issue: 'Agent has invalid max tokens'
                });
            }

            // Check capabilities array
            if (!agent.capabilities || agent.capabilities.length === 0) {
                violations.push({
                    agentId: agent.id,
                    name: agent.name,
                    issue: 'Agent has no capabilities defined',
                    severity: 'MEDIUM'
                });
            }
        }

        // Check for at least one active agent
        const activeAgentCount = await prisma.aIAgent.count({ where: { isActive: true } });
        if (activeAgentCount === 0) {
            violations.push({
                issue: 'No active AI agents available',
                severity: 'CRITICAL'
            });
        }

        this.results.push({
            ruleName: 'AI Agent Configuration',
            passed: violations.length === 0,
            recordsChecked: agents.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.severity === 'CRITICAL') ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates AI agent configuration and availability',
            recommendation: violations.length > 0 ? 'Fix AI agents with configuration issues' : undefined
        });
    }

    private async validateAIRequestData(): Promise<void> {
        console.log('🧠 Validating AI request data...');
        
        const requests = await prisma.aIRequest.findMany({
            include: { user: true, agent: true }
        });
        
        const violations: any[] = [];

        for (const request of requests) {
            // Check for orphaned requests
            if (!request.user) {
                violations.push({
                    requestId: request.id,
                    userId: request.userId,
                    issue: 'AI request references non-existent user'
                });
            }

            if (!request.agent) {
                violations.push({
                    requestId: request.id,
                    agentId: request.agentId,
                    issue: 'AI request references non-existent agent'
                });
            }

            // Check for empty prompts
            if (!request.prompt?.trim()) {
                violations.push({
                    requestId: request.id,
                    issue: 'AI request with empty prompt'
                });
            }

            // Check token usage consistency
            if (request.tokensUsed < 0) {
                violations.push({
                    requestId: request.id,
                    tokensUsed: request.tokensUsed,
                    issue: 'AI request with negative token usage'
                });
            }

            if (request.agent && request.tokensUsed > request.agent.maxTokens * 2) {
                violations.push({
                    requestId: request.id,
                    tokensUsed: request.tokensUsed,
                    agentMaxTokens: request.agent.maxTokens,
                    issue: 'Token usage significantly exceeds agent limit',
                    severity: 'MEDIUM'
                });
            }

            // Check cost calculation
            if (request.agent && request.tokensUsed > 0) {
                const expectedCost = request.tokensUsed * request.agent.costPerToken;
                const costDifference = Math.abs(request.cost - expectedCost);
                
                if (costDifference > expectedCost * 0.1) { // 10% tolerance
                    violations.push({
                        requestId: request.id,
                        calculatedCost: request.cost,
                        expectedCost,
                        difference: costDifference,
                        issue: 'Cost calculation mismatch',
                        severity: 'MEDIUM'
                    });
                }
            }

            // Check response time
            if (request.responseTimeMs < 0) {
                violations.push({
                    requestId: request.id,
                    responseTimeMs: request.responseTimeMs,
                    issue: 'Negative response time'
                });
            }
        }

        this.results.push({
            ruleName: 'AI Request Data Validation',
            passed: violations.length === 0,
            recordsChecked: requests.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.issue.includes('non-existent')) ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates AI request data integrity and calculations',
            recommendation: violations.length > 0 ? 'Fix AI requests with data issues' : undefined
        });
    }

    private async validateAIRequestCosts(): Promise<void> {
        console.log('💰 Validating AI request costs against transactions...');
        
        const costComparison = await prisma.$queryRaw`
            SELECT 
                u.email,
                SUM(ar.cost) as total_ai_cost,
                SUM(CASE WHEN t.type = 'CREDIT_USAGE' THEN ABS(t.amount) ELSE 0 END) as total_usage_transactions
            FROM "User" u
            LEFT JOIN "AIRequest" ar ON u.id = ar."userId"
            LEFT JOIN "Transaction" t ON u.id = t."userId" AND t.type = 'CREDIT_USAGE'
            GROUP BY u.id, u.email
            HAVING SUM(ar.cost) > 0 OR SUM(CASE WHEN t.type = 'CREDIT_USAGE' THEN ABS(t.amount) ELSE 0 END) > 0
        `;

        const violations: any[] = [];
        const threshold = 0.01; // $0.01 tolerance

        for (const row of costComparison as any[]) {
            const aiCost = parseFloat(row.total_ai_cost) || 0;
            const transactionCost = parseFloat(row.total_usage_transactions) || 0;
            const difference = Math.abs(aiCost - transactionCost);

            if (difference > threshold) {
                violations.push({
                    userEmail: row.email,
                    aiRequestCost: aiCost,
                    transactionCost: transactionCost,
                    difference,
                    issue: 'AI request costs do not match usage transactions'
                });
            }
        }

        this.results.push({
            ruleName: 'AI Cost Transaction Consistency',
            passed: violations.length === 0,
            recordsChecked: (costComparison as any[]).length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates AI request costs match credit usage transactions',
            recommendation: violations.length > 0 ? 'Reconcile AI costs with transaction records' : undefined
        });
    }

    private async validatePluginData(): Promise<void> {
        console.log('🔌 Validating plugin data...');
        
        const plugins = await prisma.plugin.findMany();
        const violations: any[] = [];

        for (const plugin of plugins) {
            // Check required fields
            if (!plugin.name?.trim()) {
                violations.push({
                    pluginId: plugin.id,
                    issue: 'Plugin missing name'
                });
            }

            if (!plugin.version?.trim()) {
                violations.push({
                    pluginId: plugin.id,
                    name: plugin.name,
                    issue: 'Plugin missing version'
                });
            }

            if (!plugin.author?.trim()) {
                violations.push({
                    pluginId: plugin.id,
                    name: plugin.name,
                    issue: 'Plugin missing author'
                });
            }

            // Check version format (should be semantic versioning)
            if (plugin.version && !this.isValidVersion(plugin.version)) {
                violations.push({
                    pluginId: plugin.id,
                    name: plugin.name,
                    version: plugin.version,
                    issue: 'Plugin has invalid version format',
                    severity: 'MEDIUM'
                });
            }

            // Check rating bounds
            if (plugin.rating < 0 || plugin.rating > 5) {
                violations.push({
                    pluginId: plugin.id,
                    name: plugin.name,
                    rating: plugin.rating,
                    issue: 'Plugin rating out of valid range (0-5)'
                });
            }

            // Check download count
            if (plugin.downloadCount < 0) {
                violations.push({
                    pluginId: plugin.id,
                    name: plugin.name,
                    downloadCount: plugin.downloadCount,
                    issue: 'Plugin has negative download count'
                });
            }
        }

        this.results.push({
            ruleName: 'Plugin Data Validation',
            passed: violations.length === 0,
            recordsChecked: plugins.length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'MEDIUM' : 'LOW',
            description: 'Validates plugin data integrity and format',
            recommendation: violations.length > 0 ? 'Fix plugins with invalid data' : undefined
        });
    }

    private async validateUserPluginRelationships(): Promise<void> {
        console.log('🔗 Validating user-plugin relationships...');
        
        const userPlugins = await prisma.userPlugin.findMany({
            include: { user: true, plugin: true }
        });
        
        const violations: any[] = [];

        for (const userPlugin of userPlugins) {
            // Check for orphaned relationships
            if (!userPlugin.user) {
                violations.push({
                    userPluginId: userPlugin.id,
                    userId: userPlugin.userId,
                    issue: 'User-plugin relationship references non-existent user'
                });
            }

            if (!userPlugin.plugin) {
                violations.push({
                    userPluginId: userPlugin.id,
                    pluginId: userPlugin.pluginId,
                    issue: 'User-plugin relationship references non-existent plugin'
                });
            }

            // Check usage count consistency
            if (userPlugin.usageCount < 0) {
                violations.push({
                    userPluginId: userPlugin.id,
                    usageCount: userPlugin.usageCount,
                    issue: 'Negative plugin usage count'
                });
            }

            if (userPlugin.usageCount > 0 && !userPlugin.lastUsedAt) {
                violations.push({
                    userPluginId: userPlugin.id,
                    usageCount: userPlugin.usageCount,
                    issue: 'Plugin has usage count but no last used date',
                    severity: 'MEDIUM'
                });
            }

            // Check date consistency
            if (userPlugin.lastUsedAt && userPlugin.lastUsedAt < userPlugin.installedAt) {
                violations.push({
                    userPluginId: userPlugin.id,
                    installedAt: userPlugin.installedAt,
                    lastUsedAt: userPlugin.lastUsedAt,
                    issue: 'Plugin last used date is before installation date'
                });
            }
        }

        this.results.push({
            ruleName: 'User-Plugin Relationship Validation',
            passed: violations.length === 0,
            recordsChecked: userPlugins.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.issue.includes('non-existent')) ? 'CRITICAL' : 
                     violations.length > 0 ? 'MEDIUM' : 'LOW',
            description: 'Validates user-plugin relationship data integrity',
            recommendation: violations.length > 0 ? 'Fix user-plugin relationships with data issues' : undefined
        });
    }

    private async validateBudgetLimits(): Promise<void> {
        console.log('💰 Validating budget limits...');
        
        const budgetLimits = await prisma.budgetLimit.findMany({
            include: { user: true }
        });
        
        const violations: any[] = [];

        for (const limit of budgetLimits) {
            // Check for orphaned budget limits
            if (!limit.user) {
                violations.push({
                    budgetLimitId: limit.id,
                    userId: limit.userId,
                    issue: 'Budget limit references non-existent user'
                });
            }

            // Check limit values
            if (limit.dailyLimit <= 0) {
                violations.push({
                    budgetLimitId: limit.id,
                    dailyLimit: limit.dailyLimit,
                    issue: 'Invalid daily limit (must be positive)'
                });
            }

            if (limit.monthlyLimit <= 0) {
                violations.push({
                    budgetLimitId: limit.id,
                    monthlyLimit: limit.monthlyLimit,
                    issue: 'Invalid monthly limit (must be positive)'
                });
            }

            if (limit.monthlyLimit < limit.dailyLimit * 20) {
                violations.push({
                    budgetLimitId: limit.id,
                    dailyLimit: limit.dailyLimit,
                    monthlyLimit: limit.monthlyLimit,
                    issue: 'Monthly limit seems too low compared to daily limit',
                    severity: 'MEDIUM'
                });
            }

            // Check usage values
            if (limit.currentDailyUsage < 0) {
                violations.push({
                    budgetLimitId: limit.id,
                    currentDailyUsage: limit.currentDailyUsage,
                    issue: 'Negative daily usage'
                });
            }

            if (limit.currentMonthlyUsage < 0) {
                violations.push({
                    budgetLimitId: limit.id,
                    currentMonthlyUsage: limit.currentMonthlyUsage,
                    issue: 'Negative monthly usage'
                });
            }

            // Check alert threshold
            if (limit.alertThreshold < 0 || limit.alertThreshold > 1) {
                violations.push({
                    budgetLimitId: limit.id,
                    alertThreshold: limit.alertThreshold,
                    issue: 'Invalid alert threshold (must be between 0 and 1)'
                });
            }
        }

        this.results.push({
            ruleName: 'Budget Limit Validation',
            passed: violations.length === 0,
            recordsChecked: budgetLimits.length,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.issue.includes('non-existent user')) ? 'CRITICAL' : 
                     violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates budget limit configuration and values',
            recommendation: violations.length > 0 ? 'Fix budget limits with invalid configurations' : undefined
        });
    }

    private async validateDataConsistency(): Promise<void> {
        console.log('🔄 Validating cross-table data consistency...');
        
        const violations: any[] = [];

        // Check credit account balances against transaction totals
        const creditConsistency = await prisma.$queryRaw`
            SELECT 
                ca."userId",
                ca."totalCredits",
                ca."usedCredits",
                COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as credited_amount,
                COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as debited_amount
            FROM "CreditAccount" ca
            LEFT JOIN "Transaction" t ON ca."userId" = t."userId" AND t.status = 'COMPLETED'
            GROUP BY ca."userId", ca."totalCredits", ca."usedCredits"
        `;

        for (const row of creditConsistency as any[]) {
            const totalFromTransactions = parseFloat(row.credited_amount) || 0;
            const usedFromTransactions = parseFloat(row.debited_amount) || 0;
            const accountTotal = parseFloat(row.totalCredits) || 0;
            const accountUsed = parseFloat(row.usedCredits) || 0;

            // Allow small discrepancies due to floating point precision
            if (Math.abs(accountTotal - totalFromTransactions) > 0.01) {
                violations.push({
                    userId: row.userId,
                    accountTotal,
                    transactionTotal: totalFromTransactions,
                    difference: Math.abs(accountTotal - totalFromTransactions),
                    issue: 'Credit account total does not match transaction total'
                });
            }

            if (Math.abs(accountUsed - usedFromTransactions) > 0.01) {
                violations.push({
                    userId: row.userId,
                    accountUsed,
                    transactionUsed: usedFromTransactions,
                    difference: Math.abs(accountUsed - usedFromTransactions),
                    issue: 'Credit account usage does not match transaction usage'
                });
            }
        }

        this.results.push({
            ruleName: 'Data Consistency Check',
            passed: violations.length === 0,
            recordsChecked: (creditConsistency as any[]).length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'HIGH' : 'LOW',
            description: 'Validates consistency between related tables',
            recommendation: violations.length > 0 ? 'Reconcile inconsistent data between tables' : undefined
        });
    }

    private async validateMetadataStructure(): Promise<void> {
        console.log('📋 Validating metadata structure...');
        
        const violations: any[] = [];

        // Check user metadata structure
        const usersWithMetadata = await prisma.user.findMany({
            where: { metadata: { not: null } }
        });

        for (const user of usersWithMetadata) {
            const metadata = user.metadata as any;
            
            if (typeof metadata !== 'object') {
                violations.push({
                    table: 'User',
                    recordId: user.id,
                    email: user.email,
                    issue: 'Metadata is not a valid JSON object'
                });
            }
        }

        // Check transaction metadata structure
        const transactionsWithMetadata = await prisma.transaction.findMany({
            where: { metadata: { not: null } },
            take: 100 // Sample for performance
        });

        for (const transaction of transactionsWithMetadata) {
            const metadata = transaction.metadata as any;
            
            if (typeof metadata !== 'object') {
                violations.push({
                    table: 'Transaction',
                    recordId: transaction.id,
                    issue: 'Metadata is not a valid JSON object'
                });
            }
        }

        this.results.push({
            ruleName: 'Metadata Structure Validation',
            passed: violations.length === 0,
            recordsChecked: usersWithMetadata.length + transactionsWithMetadata.length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'MEDIUM' : 'LOW',
            description: 'Validates JSON metadata structure integrity',
            recommendation: violations.length > 0 ? 'Fix records with malformed metadata' : undefined
        });
    }

    private async validateReferentialIntegrity(): Promise<void> {
        console.log('🔗 Validating referential integrity...');
        
        const violations: any[] = [];

        // Check for foreign key violations using raw queries since Prisma handles this automatically
        // This is more of a sanity check for data that might have been imported externally

        const orphanedTransactions = await prisma.transaction.findMany({
            where: { user: null }
        });

        const orphanedAIRequests = await prisma.aIRequest.findMany({
            where: { 
                OR: [
                    { user: null },
                    { agent: null }
                ]
            }
        });

        const orphanedCreditAccounts = await prisma.creditAccount.findMany({
            where: { user: null }
        });

        const orphanedUserPlugins = await prisma.userPlugin.findMany({
            where: {
                OR: [
                    { user: null },
                    { plugin: null }
                ]
            }
        });

        const orphanedBudgetLimits = await prisma.budgetLimit.findMany({
            where: { user: null }
        });

        violations.push(
            ...orphanedTransactions.map(t => ({
                table: 'Transaction',
                recordId: t.id,
                foreignKey: 'userId',
                foreignValue: t.userId,
                issue: 'References non-existent user'
            })),
            ...orphanedAIRequests.filter(r => !r.user).map(r => ({
                table: 'AIRequest',
                recordId: r.id,
                foreignKey: 'userId',
                foreignValue: r.userId,
                issue: 'References non-existent user'
            })),
            ...orphanedAIRequests.filter(r => !r.agent).map(r => ({
                table: 'AIRequest',
                recordId: r.id,
                foreignKey: 'agentId',
                foreignValue: r.agentId,
                issue: 'References non-existent agent'
            })),
            ...orphanedCreditAccounts.map(ca => ({
                table: 'CreditAccount',
                recordId: ca.id,
                foreignKey: 'userId',
                foreignValue: ca.userId,
                issue: 'References non-existent user'
            })),
            ...orphanedUserPlugins.filter(up => !up.user).map(up => ({
                table: 'UserPlugin',
                recordId: up.id,
                foreignKey: 'userId',
                foreignValue: up.userId,
                issue: 'References non-existent user'
            })),
            ...orphanedUserPlugins.filter(up => !up.plugin).map(up => ({
                table: 'UserPlugin',
                recordId: up.id,
                foreignKey: 'pluginId',
                foreignValue: up.pluginId,
                issue: 'References non-existent plugin'
            })),
            ...orphanedBudgetLimits.map(bl => ({
                table: 'BudgetLimit',
                recordId: bl.id,
                foreignKey: 'userId',
                foreignValue: bl.userId,
                issue: 'References non-existent user'
            }))
        );

        this.results.push({
            ruleName: 'Referential Integrity',
            passed: violations.length === 0,
            recordsChecked: orphanedTransactions.length + orphanedAIRequests.length + 
                           orphanedCreditAccounts.length + orphanedUserPlugins.length + 
                           orphanedBudgetLimits.length,
            violationCount: violations.length,
            violations,
            severity: violations.length > 0 ? 'CRITICAL' : 'LOW',
            description: 'Validates foreign key relationships and referential integrity',
            recommendation: violations.length > 0 ? 'Fix or remove records with broken references' : undefined
        });
    }

    private async validateDataDistribution(): Promise<void> {
        console.log('📊 Validating data distribution and performance indicators...');
        
        const violations: any[] = [];

        // Check for table size anomalies
        const userCount = await prisma.user.count();
        const transactionCount = await prisma.transaction.count();
        const aiRequestCount = await prisma.aIRequest.count();

        if (userCount === 0) {
            violations.push({
                issue: 'No users in the system',
                severity: 'CRITICAL'
            });
        }

        // Check data distribution ratios
        if (userCount > 0) {
            const transactionPerUser = transactionCount / userCount;
            const aiRequestPerUser = aiRequestCount / userCount;

            if (transactionPerUser > 1000) {
                violations.push({
                    transactionPerUser: transactionPerUser.toFixed(2),
                    issue: 'Unusually high transaction count per user',
                    severity: 'MEDIUM'
                });
            }

            if (aiRequestPerUser > 500) {
                violations.push({
                    aiRequestPerUser: aiRequestPerUser.toFixed(2),
                    issue: 'Unusually high AI request count per user',
                    severity: 'MEDIUM'
                });
            }
        }

        // Check for data skew (users with disproportionate activity)
        const topUsers = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                _count: {
                    select: {
                        transactions: true,
                        aiRequests: true
                    }
                }
            },
            orderBy: {
                transactions: {
                    _count: 'desc'
                }
            },
            take: 5
        });

        const avgTransactionsPerUser = transactionCount / userCount;
        for (const user of topUsers) {
            if (user._count.transactions > avgTransactionsPerUser * 10) {
                violations.push({
                    userEmail: user.email,
                    transactionCount: user._count.transactions,
                    avgTransactionCount: avgTransactionsPerUser.toFixed(2),
                    issue: 'User has disproportionately high transaction count',
                    severity: 'MEDIUM'
                });
            }
        }

        this.results.push({
            ruleName: 'Data Distribution Analysis',
            passed: violations.filter(v => v.severity === 'CRITICAL').length === 0,
            recordsChecked: userCount + transactionCount + aiRequestCount,
            violationCount: violations.length,
            violations,
            severity: violations.some(v => v.severity === 'CRITICAL') ? 'CRITICAL' : 
                     violations.length > 0 ? 'MEDIUM' : 'LOW',
            description: 'Analyzes data distribution patterns and identifies anomalies',
            recommendation: violations.length > 0 ? 'Review data patterns and investigate anomalies' : undefined
        });
    }

    // Helper methods
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    private isValidVersion(version: string): boolean {
        const versionRegex = /^\d+\.\d+\.\d+(-[\w\d\-]+)?(\+[\w\d\-]+)?$/;
        return versionRegex.test(version);
    }

    private generateReport(): ValidationReport {
        const totalRules = this.results.length;
        const passedRules = this.results.filter(r => r.passed).length;
        const failedRules = totalRules - passedRules;
        const criticalViolations = this.results.filter(r => r.severity === 'CRITICAL' && !r.passed).length;
        const highViolations = this.results.filter(r => r.severity === 'HIGH' && !r.passed).length;

        let overallStatus: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
        if (criticalViolations > 0) {
            overallStatus = 'FAIL';
        } else if (highViolations > 0 || failedRules > 0) {
            overallStatus = 'WARNING';
        }

        const report: ValidationReport = {
            timestamp: new Date().toISOString(),
            totalRules,
            passedRules,
            failedRules,
            criticalViolations,
            highViolations,
            results: this.results,
            overallStatus
        };

        // Log summary
        console.log('\n📊 VALIDATION SUMMARY');
        console.log('='.repeat(50));
        console.log(`Overall Status: ${overallStatus}`);
        console.log(`Total Rules: ${totalRules}`);
        console.log(`Passed: ${passedRules}`);
        console.log(`Failed: ${failedRules}`);
        console.log(`Critical Issues: ${criticalViolations}`);
        console.log(`High Priority Issues: ${highViolations}`);

        if (failedRules > 0) {
            console.log('\n❌ FAILED VALIDATIONS:');
            this.results.filter(r => !r.passed).forEach(result => {
                console.log(`  - ${result.ruleName}: ${result.violationCount} violations (${result.severity})`);
            });
        }

        return report;
    }

    async saveReport(outputFile?: string): Promise<string> {
        const report = this.generateReport();
        
        if (!outputFile) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            outputFile = path.join(process.cwd(), 'database', 'validation', `validation-report-${timestamp}.json`);
        }

        // Ensure directory exists
        const dir = path.dirname(outputFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
        
        // Generate human-readable summary
        const summaryFile = outputFile.replace('.json', '-summary.txt');
        this.generateTextSummary(report, summaryFile);
        
        console.log(`\n📄 Validation report saved to: ${outputFile}`);
        console.log(`📄 Summary report saved to: ${summaryFile}`);
        
        return outputFile;
    }

    private generateTextSummary(report: ValidationReport, summaryFile: string): void {
        let summary = `Data Validation Summary Report\n`;
        summary += `Generated: ${report.timestamp}\n`;
        summary += `Overall Status: ${report.overallStatus}\n\n`;
        
        summary += `Results Overview:\n`;
        summary += `- Total Validation Rules: ${report.totalRules}\n`;
        summary += `- Passed Rules: ${report.passedRules}\n`;
        summary += `- Failed Rules: ${report.failedRules}\n`;
        summary += `- Critical Issues: ${report.criticalViolations}\n`;
        summary += `- High Priority Issues: ${report.highViolations}\n\n`;
        
        if (report.failedRules > 0) {
            summary += `Failed Validation Details:\n`;
            summary += `${'='.repeat(40)}\n`;
            
            report.results.filter(r => !r.passed).forEach(result => {
                summary += `\n${result.ruleName} (${result.severity})\n`;
                summary += `-`.repeat(result.ruleName.length + result.severity.length + 3) + '\n';
                summary += `Description: ${result.description}\n`;
                summary += `Records Checked: ${result.recordsChecked.toLocaleString()}\n`;
                summary += `Violations: ${result.violationCount}\n`;
                if (result.recommendation) {
                    summary += `Recommendation: ${result.recommendation}\n`;
                }
            });
        }
        
        if (report.overallStatus === 'PASS') {
            summary += `\n✅ All validations passed successfully!\n`;
            summary += `The database is in good health with no critical issues detected.\n`;
        } else if (report.overallStatus === 'WARNING') {
            summary += `\n⚠️  Some issues detected that should be addressed.\n`;
            summary += `Review the failed validations and implement recommended fixes.\n`;
        } else {
            summary += `\n❌ Critical issues detected that require immediate attention!\n`;
            summary += `The system may not function correctly until these issues are resolved.\n`;
        }
        
        fs.writeFileSync(summaryFile, summary);
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Data Validation Tool

Usage: npx tsx database/validation/data-validation.ts [OPTIONS]

Options:
  --output FILE    Output file path for validation report
  --help          Show this help message

Examples:
  npx tsx database/validation/data-validation.ts
  npx tsx database/validation/data-validation.ts --output validation-results.json
        `);
        process.exit(0);
    }

    const outputIndex = args.indexOf('--output');
    const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : undefined;

    try {
        const validator = new DataValidator();
        const report = await validator.runAllValidations();
        
        await validator.saveReport(outputFile);
        
        // Exit with appropriate code
        if (report.overallStatus === 'FAIL') {
            console.log('\n❌ Validation failed with critical issues');
            process.exit(1);
        } else if (report.overallStatus === 'WARNING') {
            console.log('\n⚠️  Validation completed with warnings');
            process.exit(0);
        } else {
            console.log('\n✅ All validations passed successfully!');
            process.exit(0);
        }
        
    } catch (error) {
        console.error('❌ Validation process failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main();
}

export { DataValidator, type ValidationResult, type ValidationReport };
