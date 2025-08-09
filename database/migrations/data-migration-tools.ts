
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

/**
 * Data Migration Tools for AI Employee Platform
 * Provides utilities for migrating data between different schema versions
 */

const prisma = new PrismaClient();

interface MigrationContext {
    fromVersion: string;
    toVersion: string;
    dryRun: boolean;
    backupData: boolean;
    timestamp: string;
}

interface MigrationResult {
    success: boolean;
    recordsProcessed: number;
    recordsModified: number;
    errors: string[];
    duration: number;
    backupFile?: string;
}

class DataMigrationTools {
    private context: MigrationContext;
    private backupDir: string;

    constructor(context: MigrationContext) {
        this.context = context;
        this.backupDir = path.join(process.cwd(), 'database', 'backups');
        
        // Ensure backup directory exists
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    /**
     * Migrate User metadata to new structure
     * Example migration: Add department field to user metadata
     */
    async migrateUserMetadata(): Promise<MigrationResult> {
        console.log('🔄 Migrating user metadata structure...');
        const startTime = Date.now();
        const result: MigrationResult = {
            success: false,
            recordsProcessed: 0,
            recordsModified: 0,
            errors: [],
            duration: 0
        };

        try {
            // Backup existing data if requested
            if (this.context.backupData) {
                result.backupFile = await this.backupUserData();
            }

            // Get all users with metadata
            const users = await prisma.user.findMany({
                where: {
                    metadata: {
                        not: null
                    }
                }
            });

            result.recordsProcessed = users.length;

            for (const user of users) {
                try {
                    const currentMetadata = user.metadata as any;
                    let needsUpdate = false;
                    const newMetadata = { ...currentMetadata };

                    // Migration logic: Add department if missing
                    if (!newMetadata.department && newMetadata.type === 'employee') {
                        newMetadata.department = this.inferDepartmentFromEmail(user.email);
                        needsUpdate = true;
                    }

                    // Migration logic: Add employee ID if missing
                    if (!newMetadata.employeeId && newMetadata.type === 'employee') {
                        newMetadata.employeeId = `EMP${user.id.toString().padStart(6, '0')}`;
                        needsUpdate = true;
                    }

                    // Migration logic: Standardize metadata structure
                    if (!newMetadata.version) {
                        newMetadata.version = this.context.toVersion;
                        newMetadata.migratedAt = new Date().toISOString();
                        needsUpdate = true;
                    }

                    if (needsUpdate && !this.context.dryRun) {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { metadata: newMetadata }
                        });
                        result.recordsModified++;
                    } else if (needsUpdate && this.context.dryRun) {
                        result.recordsModified++;
                        console.log(`[DRY RUN] Would update user ${user.email}: ${JSON.stringify(newMetadata)}`);
                    }

                } catch (error) {
                    const errorMsg = `Failed to migrate user ${user.id}: ${error}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }

            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;

            console.log(`✅ User metadata migration completed: ${result.recordsModified}/${result.recordsProcessed} records updated`);

        } catch (error) {
            result.errors.push(`Migration failed: ${error}`);
            result.duration = Date.now() - startTime;
            console.error('❌ User metadata migration failed:', error);
        }

        return result;
    }

    /**
     * Migrate Transaction metadata to include new tracking fields
     */
    async migrateTransactionMetadata(): Promise<MigrationResult> {
        console.log('🔄 Migrating transaction metadata structure...');
        const startTime = Date.now();
        const result: MigrationResult = {
            success: false,
            recordsProcessed: 0,
            recordsModified: 0,
            errors: [],
            duration: 0
        };

        try {
            if (this.context.backupData) {
                result.backupFile = await this.backupTransactionData();
            }

            const transactions = await prisma.transaction.findMany();
            result.recordsProcessed = transactions.length;

            for (const transaction of transactions) {
                try {
                    const currentMetadata = (transaction.metadata as any) || {};
                    let needsUpdate = false;
                    const newMetadata = { ...currentMetadata };

                    // Add tracking fields if missing
                    if (!newMetadata.transactionId) {
                        newMetadata.transactionId = `TXN-${transaction.id.toString().padStart(8, '0')}`;
                        needsUpdate = true;
                    }

                    if (!newMetadata.sourceSystem) {
                        newMetadata.sourceSystem = 'ai-platform';
                        needsUpdate = true;
                    }

                    if (!newMetadata.category) {
                        newMetadata.category = this.categorizeTransaction(transaction);
                        needsUpdate = true;
                    }

                    // Add audit trail
                    if (!newMetadata.auditTrail) {
                        newMetadata.auditTrail = [{
                            action: 'created',
                            timestamp: transaction.createdAt.toISOString(),
                            system: 'ai-platform'
                        }];
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        newMetadata.version = this.context.toVersion;
                        newMetadata.migratedAt = new Date().toISOString();

                        if (!this.context.dryRun) {
                            await prisma.transaction.update({
                                where: { id: transaction.id },
                                data: { metadata: newMetadata }
                            });
                        }
                        result.recordsModified++;
                    }

                } catch (error) {
                    const errorMsg = `Failed to migrate transaction ${transaction.id}: ${error}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }

            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;

            console.log(`✅ Transaction metadata migration completed: ${result.recordsModified}/${result.recordsProcessed} records updated`);

        } catch (error) {
            result.errors.push(`Migration failed: ${error}`);
            result.duration = Date.now() - startTime;
            console.error('❌ Transaction metadata migration failed:', error);
        }

        return result;
    }

    /**
     * Migrate AI Request data to include performance metrics
     */
    async migrateAIRequestMetadata(): Promise<MigrationResult> {
        console.log('🔄 Migrating AI request metadata structure...');
        const startTime = Date.now();
        const result: MigrationResult = {
            success: false,
            recordsProcessed: 0,
            recordsModified: 0,
            errors: [],
            duration: 0
        };

        try {
            if (this.context.backupData) {
                result.backupFile = await this.backupAIRequestData();
            }

            const aiRequests = await prisma.aIRequest.findMany({
                include: { agent: true, user: true }
            });
            
            result.recordsProcessed = aiRequests.length;

            for (const request of aiRequests) {
                try {
                    const currentMetadata = (request.metadata as any) || {};
                    let needsUpdate = false;
                    const newMetadata = { ...currentMetadata };

                    // Add performance metrics if missing
                    if (!newMetadata.performanceMetrics) {
                        newMetadata.performanceMetrics = {
                            tokenGenerationRate: request.tokensUsed / (request.responseTimeMs / 1000),
                            costPerToken: request.cost / request.tokensUsed,
                            efficiency: this.calculateRequestEfficiency(request),
                            category: this.categorizeRequestComplexity(request.prompt)
                        };
                        needsUpdate = true;
                    }

                    // Add request classification
                    if (!newMetadata.classification) {
                        newMetadata.classification = {
                            type: this.classifyRequestType(request.prompt),
                            complexity: this.assessComplexity(request.prompt),
                            domain: this.identifyDomain(request.prompt),
                            language: 'en' // Default, could be detected
                        };
                        needsUpdate = true;
                    }

                    // Add quality metrics
                    if (!newMetadata.qualityMetrics) {
                        newMetadata.qualityMetrics = {
                            promptClarity: this.assessPromptClarity(request.prompt),
                            responseRelevance: request.response ? this.assessRelevance(request.prompt, request.response) : null,
                            tokenEfficiency: request.tokensUsed / request.prompt.length
                        };
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        newMetadata.version = this.context.toVersion;
                        newMetadata.migratedAt = new Date().toISOString();

                        if (!this.context.dryRun) {
                            await prisma.aIRequest.update({
                                where: { id: request.id },
                                data: { metadata: newMetadata }
                            });
                        }
                        result.recordsModified++;
                    }

                } catch (error) {
                    const errorMsg = `Failed to migrate AI request ${request.id}: ${error}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }

            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;

            console.log(`✅ AI request metadata migration completed: ${result.recordsModified}/${result.recordsProcessed} records updated`);

        } catch (error) {
            result.errors.push(`Migration failed: ${error}`);
            result.duration = Date.now() - startTime;
            console.error('❌ AI request metadata migration failed:', error);
        }

        return result;
    }

    /**
     * Migrate Plugin data to include new marketplace fields
     */
    async migratePluginData(): Promise<MigrationResult> {
        console.log('🔄 Migrating plugin data structure...');
        const startTime = Date.now();
        const result: MigrationResult = {
            success: false,
            recordsProcessed: 0,
            recordsModified: 0,
            errors: [],
            duration: 0
        };

        try {
            if (this.context.backupData) {
                result.backupFile = await this.backupPluginData();
            }

            const plugins = await prisma.plugin.findMany();
            result.recordsProcessed = plugins.length;

            for (const plugin of plugins) {
                try {
                    const currentMetadata = (plugin.metadata as any) || {};
                    let needsUpdate = false;
                    const newMetadata = { ...currentMetadata };

                    // Add marketplace fields
                    if (!newMetadata.marketplace) {
                        newMetadata.marketplace = {
                            featured: plugin.downloadCount > 1000,
                            verified: plugin.isOfficial,
                            lastUpdate: plugin.updatedAt.toISOString(),
                            compatibility: {
                                minVersion: '1.0.0',
                                maxVersion: '2.0.0',
                                tested: true
                            },
                            screenshots: [],
                            documentation: `https://docs.aiplatform.com/plugins/${plugin.name.toLowerCase().replace(/\s+/g, '-')}`
                        };
                        needsUpdate = true;
                    }

                    // Add analytics data
                    if (!newMetadata.analytics) {
                        newMetadata.analytics = {
                            installTrend: this.calculateInstallTrend(plugin.downloadCount),
                            avgRating: plugin.rating,
                            activeUsers: Math.floor(plugin.downloadCount * 0.3), // Estimate
                            retentionRate: Math.random() * 0.4 + 0.6 // 60-100%
                        };
                        needsUpdate = true;
                    }

                    // Add security assessment
                    if (!newMetadata.security) {
                        newMetadata.security = {
                            scanDate: new Date().toISOString(),
                            riskLevel: plugin.isOfficial ? 'low' : 'medium',
                            permissions: this.analyzePluginPermissions(plugin),
                            codeReview: plugin.isOfficial ? 'passed' : 'pending'
                        };
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        newMetadata.version = this.context.toVersion;
                        newMetadata.migratedAt = new Date().toISOString();

                        if (!this.context.dryRun) {
                            await prisma.plugin.update({
                                where: { id: plugin.id },
                                data: { metadata: newMetadata }
                            });
                        }
                        result.recordsModified++;
                    }

                } catch (error) {
                    const errorMsg = `Failed to migrate plugin ${plugin.id}: ${error}`;
                    result.errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }

            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;

            console.log(`✅ Plugin data migration completed: ${result.recordsModified}/${result.recordsProcessed} records updated`);

        } catch (error) {
            result.errors.push(`Migration failed: ${error}`);
            result.duration = Date.now() - startTime;
            console.error('❌ Plugin data migration failed:', error);
        }

        return result;
    }

    /**
     * Run all migrations in sequence
     */
    async runAllMigrations(): Promise<{ [key: string]: MigrationResult }> {
        console.log(`🚀 Starting data migration from ${this.context.fromVersion} to ${this.context.toVersion}`);
        console.log(`Mode: ${this.context.dryRun ? 'DRY RUN' : 'LIVE'}`);
        console.log(`Backup: ${this.context.backupData ? 'YES' : 'NO'}`);
        console.log('');

        const results: { [key: string]: MigrationResult } = {};

        try {
            // Run migrations in order
            results.userMetadata = await this.migrateUserMetadata();
            results.transactionMetadata = await this.migrateTransactionMetadata();
            results.aiRequestMetadata = await this.migrateAIRequestMetadata();
            results.pluginData = await this.migratePluginData();

            // Generate migration report
            await this.generateMigrationReport(results);

            console.log('\n🎉 All migrations completed!');
            
        } catch (error) {
            console.error('❌ Migration process failed:', error);
            throw error;
        }

        return results;
    }

    // Helper methods for data transformation
    private inferDepartmentFromEmail(email: string): string {
        const domain = email.split('@')[1];
        const username = email.split('@')[0];
        
        if (username.includes('eng') || username.includes('dev')) return 'Engineering';
        if (username.includes('sales')) return 'Sales';
        if (username.includes('market')) return 'Marketing';
        if (username.includes('hr')) return 'HR';
        if (username.includes('finance')) return 'Finance';
        if (username.includes('support')) return 'Customer Success';
        
        return 'General';
    }

    private categorizeTransaction(transaction: any): string {
        if (transaction.amount > 0) {
            if (transaction.description.includes('purchase')) return 'credit_purchase';
            if (transaction.description.includes('bonus')) return 'bonus_credit';
            if (transaction.description.includes('refund')) return 'refund';
            return 'credit_addition';
        } else {
            if (transaction.description.includes('AI request')) return 'ai_usage';
            return 'credit_usage';
        }
    }

    private calculateRequestEfficiency(request: any): number {
        // Simple efficiency calculation: tokens per second per dollar
        const tokensPerSecond = request.tokensUsed / (request.responseTimeMs / 1000);
        const tokensPerDollar = request.cost > 0 ? request.tokensUsed / request.cost : 0;
        return (tokensPerSecond + tokensPerDollar) / 2;
    }

    private categorizeRequestComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
        const wordCount = prompt.split(' ').length;
        const hasSpecialRequirements = /code|analyze|explain|generate|create|write/.test(prompt.toLowerCase());
        
        if (wordCount < 10 && !hasSpecialRequirements) return 'simple';
        if (wordCount < 50 && hasSpecialRequirements) return 'medium';
        return 'complex';
    }

    private classifyRequestType(prompt: string): string {
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('code') || lowerPrompt.includes('program')) return 'code_generation';
        if (lowerPrompt.includes('write') || lowerPrompt.includes('compose')) return 'content_writing';
        if (lowerPrompt.includes('analyze') || lowerPrompt.includes('review')) return 'analysis';
        if (lowerPrompt.includes('translate')) return 'translation';
        if (lowerPrompt.includes('summarize') || lowerPrompt.includes('summary')) return 'summarization';
        if (lowerPrompt.includes('explain') || lowerPrompt.includes('define')) return 'explanation';
        
        return 'general_query';
    }

    private assessComplexity(prompt: string): number {
        // Score from 1-10 based on prompt characteristics
        let score = 1;
        
        score += Math.min(prompt.split(' ').length / 20, 3); // Word count factor
        score += (prompt.split('\n').length - 1) * 0.5; // Multi-line factor
        score += (prompt.match(/[?]/g) || []).length * 0.5; // Question complexity
        score += /code|algorithm|complex|detailed|comprehensive/.test(prompt.toLowerCase()) ? 2 : 0;
        
        return Math.min(Math.round(score), 10);
    }

    private identifyDomain(prompt: string): string {
        const lowerPrompt = prompt.toLowerCase();
        
        if (/tech|code|program|software|development/.test(lowerPrompt)) return 'technology';
        if (/business|market|sales|finance|money/.test(lowerPrompt)) return 'business';
        if (/health|medical|doctor|patient/.test(lowerPrompt)) return 'healthcare';
        if (/education|learn|teach|student/.test(lowerPrompt)) return 'education';
        if (/legal|law|contract|regulation/.test(lowerPrompt)) return 'legal';
        if (/creative|art|design|story/.test(lowerPrompt)) return 'creative';
        
        return 'general';
    }

    private assessPromptClarity(prompt: string): number {
        // Score from 1-10 for prompt clarity
        let score = 5; // Base score
        
        // Positive factors
        if (prompt.includes('?')) score += 1; // Has questions
        if (prompt.length > 50) score += 1; // Detailed enough
        if (/please|could you|would you/.test(prompt.toLowerCase())) score += 1; // Polite
        
        // Negative factors
        if (prompt.length < 20) score -= 2; // Too short
        if (!/[.?!]/.test(prompt)) score -= 1; // No punctuation
        if (prompt === prompt.toUpperCase()) score -= 2; // All caps
        
        return Math.max(1, Math.min(10, score));
    }

    private assessRelevance(prompt: string, response: string): number {
        // Simple relevance assessment (in real implementation, would use NLP)
        const promptWords = prompt.toLowerCase().split(/\W+/);
        const responseWords = response.toLowerCase().split(/\W+/);
        
        const commonWords = promptWords.filter(word => 
            word.length > 3 && responseWords.includes(word)
        );
        
        return Math.min(10, (commonWords.length / promptWords.length) * 10);
    }

    private calculateInstallTrend(downloadCount: number): 'growing' | 'stable' | 'declining' {
        // Simulate trend based on download count (in real implementation, would track over time)
        if (downloadCount > 1000) return 'growing';
        if (downloadCount > 100) return 'stable';
        return 'declining';
    }

    private analyzePluginPermissions(plugin: any): string[] {
        const metadata = plugin.metadata as any;
        const permissions = [];
        
        if (metadata?.category === 'development') permissions.push('file_access');
        if (metadata?.features?.includes('external_api')) permissions.push('network_access');
        if (metadata?.features?.includes('user_data')) permissions.push('user_data_access');
        if (!plugin.isOfficial) permissions.push('third_party');
        
        return permissions.length > 0 ? permissions : ['basic'];
    }

    // Backup methods
    private async backupUserData(): Promise<string> {
        const users = await prisma.user.findMany();
        const backupFile = path.join(this.backupDir, `users_backup_${this.context.timestamp}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(users, null, 2));
        console.log(`📦 User data backed up to: ${backupFile}`);
        return backupFile;
    }

    private async backupTransactionData(): Promise<string> {
        const transactions = await prisma.transaction.findMany();
        const backupFile = path.join(this.backupDir, `transactions_backup_${this.context.timestamp}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(transactions, null, 2));
        console.log(`📦 Transaction data backed up to: ${backupFile}`);
        return backupFile;
    }

    private async backupAIRequestData(): Promise<string> {
        const aiRequests = await prisma.aIRequest.findMany();
        const backupFile = path.join(this.backupDir, `ai_requests_backup_${this.context.timestamp}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(aiRequests, null, 2));
        console.log(`📦 AI request data backed up to: ${backupFile}`);
        return backupFile;
    }

    private async backupPluginData(): Promise<string> {
        const plugins = await prisma.plugin.findMany();
        const backupFile = path.join(this.backupDir, `plugins_backup_${this.context.timestamp}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(plugins, null, 2));
        console.log(`📦 Plugin data backed up to: ${backupFile}`);
        return backupFile;
    }

    private async generateMigrationReport(results: { [key: string]: MigrationResult }): Promise<void> {
        const totalRecords = Object.values(results).reduce((sum, result) => sum + result.recordsProcessed, 0);
        const totalModified = Object.values(results).reduce((sum, result) => sum + result.recordsModified, 0);
        const totalErrors = Object.values(results).reduce((sum, result) => sum + result.errors.length, 0);
        const totalDuration = Object.values(results).reduce((sum, result) => sum + result.duration, 0);

        const report = `# Data Migration Report

**Migration**: ${this.context.fromVersion} → ${this.context.toVersion}
**Timestamp**: ${new Date().toISOString()}
**Mode**: ${this.context.dryRun ? 'DRY RUN' : 'LIVE'}
**Backup Created**: ${this.context.backupData ? 'YES' : 'NO'}

## Summary
- **Total Records Processed**: ${totalRecords.toLocaleString()}
- **Total Records Modified**: ${totalModified.toLocaleString()}
- **Total Errors**: ${totalErrors}
- **Total Duration**: ${(totalDuration / 1000).toFixed(2)}s
- **Success Rate**: ${((totalRecords - totalErrors) / totalRecords * 100).toFixed(2)}%

## Detailed Results

${Object.entries(results).map(([migration, result]) => `
### ${migration}
- Processed: ${result.recordsProcessed.toLocaleString()}
- Modified: ${result.recordsModified.toLocaleString()}
- Errors: ${result.errors.length}
- Duration: ${(result.duration / 1000).toFixed(2)}s
- Success: ${result.success ? '✅' : '❌'}
${result.backupFile ? `- Backup: ${path.basename(result.backupFile)}` : ''}
${result.errors.length > 0 ? `- Error Details:\n${result.errors.map(e => `  - ${e}`).join('\n')}` : ''}
`).join('\n')}

## Next Steps
${this.context.dryRun ? '- Run migration in LIVE mode if results look good' : '- Monitor system for any issues'}
- Verify data integrity with validation scripts
- Update application version references
- Monitor performance for any regressions
        `;

        const reportFile = path.join(this.backupDir, `migration_report_${this.context.timestamp}.md`);
        fs.writeFileSync(reportFile, report);
        console.log(`📄 Migration report saved to: ${reportFile}`);
    }
}

// Main execution function
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Data Migration Tool

Usage: npx tsx database/migrations/data-migration-tools.ts [OPTIONS]

Options:
  --from VERSION      Source version (required)
  --to VERSION        Target version (required)
  --dry-run          Perform dry run without making changes
  --no-backup        Skip data backup
  --help             Show this help message

Examples:
  npx tsx database/migrations/data-migration-tools.ts --from 1.0.0 --to 1.1.0
  npx tsx database/migrations/data-migration-tools.ts --from 1.0.0 --to 1.1.0 --dry-run
  npx tsx database/migrations/data-migration-tools.ts --from 1.0.0 --to 1.1.0 --no-backup
        `);
        process.exit(0);
    }

    const fromIndex = args.indexOf('--from');
    const toIndex = args.indexOf('--to');
    
    if (fromIndex === -1 || toIndex === -1) {
        console.error('❌ Error: --from and --to versions are required');
        process.exit(1);
    }

    const context: MigrationContext = {
        fromVersion: args[fromIndex + 1],
        toVersion: args[toIndex + 1],
        dryRun: args.includes('--dry-run'),
        backupData: !args.includes('--no-backup'),
        timestamp: Date.now().toString()
    };

    try {
        const migrationTool = new DataMigrationTools(context);
        const results = await migrationTool.runAllMigrations();
        
        const hasErrors = Object.values(results).some(result => !result.success);
        process.exit(hasErrors ? 1 : 0);
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main();
}

export { DataMigrationTools, type MigrationContext, type MigrationResult };
