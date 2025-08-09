
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

/**
 * Data Cleanup Utility for AI Employee Platform
 * Provides safe data cleanup operations with backup and recovery options
 */

const prisma = new PrismaClient();

interface CleanupConfig {
    mode: 'soft' | 'hard' | 'archive';
    dryRun: boolean;
    createBackup: boolean;
    retentionDays?: number;
    targetTables?: string[];
    excludeTestAccount?: boolean;
    cleanupCriteria?: {
        inactiveUsers?: boolean;
        oldTransactions?: boolean;
        failedRequests?: boolean;
        unusedPlugins?: boolean;
        orphanedRecords?: boolean;
    };
}

interface CleanupResult {
    tableName: string;
    recordsFound: number;
    recordsProcessed: number;
    action: 'deleted' | 'archived' | 'marked_inactive';
    success: boolean;
    error?: string;
}

interface CleanupReport {
    startTime: string;
    endTime: string;
    config: CleanupConfig;
    results: CleanupResult[];
    totalRecordsProcessed: number;
    backupFiles: string[];
    recommendations: string[];
}

class DataCleanupTool {
    private config: CleanupConfig;
    private backupDir: string;
    private timestamp: string;
    private results: CleanupResult[] = [];
    private backupFiles: string[] = [];

    constructor(config: CleanupConfig) {
        this.config = {
            mode: 'soft',
            dryRun: true,
            createBackup: true,
            retentionDays: 90,
            excludeTestAccount: true,
            cleanupCriteria: {
                inactiveUsers: false,
                oldTransactions: false,
                failedRequests: false,
                unusedPlugins: false,
                orphanedRecords: true
            },
            ...config
        };

        this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.backupDir = path.join(process.cwd(), 'database', 'backups', `cleanup-${this.timestamp}`);
        
        if (this.config.createBackup && !fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    async runCleanup(): Promise<CleanupReport> {
        const startTime = new Date().toISOString();
        
        console.log(`🧹 Starting data cleanup...`);
        console.log(`Mode: ${this.config.mode}`);
        console.log(`Dry Run: ${this.config.dryRun ? 'YES' : 'NO'}`);
        console.log(`Backup: ${this.config.createBackup ? 'YES' : 'NO'}`);
        console.log('');

        try {
            // Create backups first if requested
            if (this.config.createBackup && !this.config.dryRun) {
                await this.createBackups();
            }

            // Run cleanup operations based on criteria
            if (this.config.cleanupCriteria?.orphanedRecords) {
                await this.cleanupOrphanedRecords();
            }

            if (this.config.cleanupCriteria?.inactiveUsers) {
                await this.cleanupInactiveUsers();
            }

            if (this.config.cleanupCriteria?.oldTransactions) {
                await this.cleanupOldTransactions();
            }

            if (this.config.cleanupCriteria?.failedRequests) {
                await this.cleanupFailedRequests();
            }

            if (this.config.cleanupCriteria?.unusedPlugins) {
                await this.cleanupUnusedPlugins();
            }

            // Additional cleanup operations
            await this.cleanupDuplicateRecords();
            await this.cleanupIncompleteRecords();

            const endTime = new Date().toISOString();
            const totalRecordsProcessed = this.results.reduce((sum, result) => sum + result.recordsProcessed, 0);

            const report: CleanupReport = {
                startTime,
                endTime,
                config: this.config,
                results: this.results,
                totalRecordsProcessed,
                backupFiles: this.backupFiles,
                recommendations: await this.generateRecommendations()
            };

            await this.saveCleanupReport(report);
            this.printSummary(report);

            return report;

        } catch (error) {
            console.error('❌ Cleanup process failed:', error);
            throw error;
        } finally {
            await prisma.$disconnect();
        }
    }

    private async createBackups(): Promise<void> {
        console.log('📦 Creating database backups...');
        
        const tables = ['User', 'CreditAccount', 'Transaction', 'AIRequest', 'Plugin', 'UserPlugin', 'BudgetLimit'];
        
        for (const table of tables) {
            try {
                const data = await this.getTableData(table);
                const backupFile = path.join(this.backupDir, `${table.toLowerCase()}_backup.json`);
                fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
                this.backupFiles.push(backupFile);
                console.log(`  ✅ Backed up ${table}: ${data.length} records`);
            } catch (error) {
                console.error(`  ❌ Failed to backup ${table}:`, error);
            }
        }
    }

    private async getTableData(tableName: string): Promise<any[]> {
        switch (tableName) {
            case 'User':
                return await prisma.user.findMany();
            case 'CreditAccount':
                return await prisma.creditAccount.findMany();
            case 'Transaction':
                return await prisma.transaction.findMany();
            case 'AIRequest':
                return await prisma.aIRequest.findMany();
            case 'Plugin':
                return await prisma.plugin.findMany();
            case 'UserPlugin':
                return await prisma.userPlugin.findMany();
            case 'BudgetLimit':
                return await prisma.budgetLimit.findMany();
            default:
                return [];
        }
    }

    private async cleanupOrphanedRecords(): Promise<void> {
        console.log('🔗 Cleaning up orphaned records...');

        // Cleanup orphaned transactions
        await this.cleanupOrphanedTransactions();
        
        // Cleanup orphaned AI requests
        await this.cleanupOrphanedAIRequests();
        
        // Cleanup orphaned credit accounts
        await this.cleanupOrphanedCreditAccounts();
        
        // Cleanup orphaned user plugins
        await this.cleanupOrphanedUserPlugins();
        
        // Cleanup orphaned budget limits
        await this.cleanupOrphanedBudgetLimits();
    }

    private async cleanupOrphanedTransactions(): Promise<void> {
        const orphanedTransactions = await prisma.transaction.findMany({
            where: {
                user: null
            }
        });

        if (orphanedTransactions.length > 0) {
            console.log(`  Found ${orphanedTransactions.length} orphaned transactions`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.transaction.deleteMany({
                    where: {
                        id: {
                            in: orphanedTransactions.map(t => t.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = orphanedTransactions.length;
            }

            this.results.push({
                tableName: 'Transaction',
                recordsFound: orphanedTransactions.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupOrphanedAIRequests(): Promise<void> {
        const orphanedRequests = await prisma.aIRequest.findMany({
            where: {
                OR: [
                    { user: null },
                    { agent: null }
                ]
            }
        });

        if (orphanedRequests.length > 0) {
            console.log(`  Found ${orphanedRequests.length} orphaned AI requests`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.aIRequest.deleteMany({
                    where: {
                        id: {
                            in: orphanedRequests.map(r => r.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = orphanedRequests.length;
            }

            this.results.push({
                tableName: 'AIRequest',
                recordsFound: orphanedRequests.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupOrphanedCreditAccounts(): Promise<void> {
        const orphanedAccounts = await prisma.creditAccount.findMany({
            where: {
                user: null
            }
        });

        if (orphanedAccounts.length > 0) {
            console.log(`  Found ${orphanedAccounts.length} orphaned credit accounts`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.creditAccount.deleteMany({
                    where: {
                        id: {
                            in: orphanedAccounts.map(a => a.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = orphanedAccounts.length;
            }

            this.results.push({
                tableName: 'CreditAccount',
                recordsFound: orphanedAccounts.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupOrphanedUserPlugins(): Promise<void> {
        const orphanedUserPlugins = await prisma.userPlugin.findMany({
            where: {
                OR: [
                    { user: null },
                    { plugin: null }
                ]
            }
        });

        if (orphanedUserPlugins.length > 0) {
            console.log(`  Found ${orphanedUserPlugins.length} orphaned user-plugin relationships`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.userPlugin.deleteMany({
                    where: {
                        id: {
                            in: orphanedUserPlugins.map(up => up.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = orphanedUserPlugins.length;
            }

            this.results.push({
                tableName: 'UserPlugin',
                recordsFound: orphanedUserPlugins.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupOrphanedBudgetLimits(): Promise<void> {
        const orphanedBudgets = await prisma.budgetLimit.findMany({
            where: {
                user: null
            }
        });

        if (orphanedBudgets.length > 0) {
            console.log(`  Found ${orphanedBudgets.length} orphaned budget limits`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.budgetLimit.deleteMany({
                    where: {
                        id: {
                            in: orphanedBudgets.map(b => b.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = orphanedBudgets.length;
            }

            this.results.push({
                tableName: 'BudgetLimit',
                recordsFound: orphanedBudgets.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupInactiveUsers(): Promise<void> {
        console.log('👤 Cleaning up inactive users...');
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - (this.config.retentionDays || 90));

        let whereClause: any = {
            isActive: false,
            updatedAt: {
                lt: cutoffDate
            }
        };

        // Exclude test account if specified
        if (this.config.excludeTestAccount) {
            whereClause.email = {
                not: 'john@doe.com'
            };
        }

        const inactiveUsers = await prisma.user.findMany({
            where: whereClause,
            include: {
                creditAccount: true,
                transactions: true,
                aiRequests: true,
                userPlugins: true,
                budgetLimits: true
            }
        });

        if (inactiveUsers.length > 0) {
            console.log(`  Found ${inactiveUsers.length} inactive users older than ${this.config.retentionDays} days`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                for (const user of inactiveUsers) {
                    try {
                        // Delete related records first
                        await prisma.budgetLimit.deleteMany({ where: { userId: user.id } });
                        await prisma.userPlugin.deleteMany({ where: { userId: user.id } });
                        await prisma.aIRequest.deleteMany({ where: { userId: user.id } });
                        await prisma.transaction.deleteMany({ where: { userId: user.id } });
                        if (user.creditAccount) {
                            await prisma.creditAccount.delete({ where: { id: user.creditAccount.id } });
                        }
                        
                        // Finally delete the user
                        await prisma.user.delete({ where: { id: user.id } });
                        processedCount++;
                    } catch (error) {
                        console.error(`  ❌ Failed to delete user ${user.email}:`, error);
                    }
                }
            } else {
                processedCount = inactiveUsers.length;
            }

            this.results.push({
                tableName: 'User (inactive)',
                recordsFound: inactiveUsers.length,
                recordsProcessed: processedCount,
                action: this.config.mode === 'archive' ? 'archived' : 'deleted',
                success: true
            });
        }
    }

    private async cleanupOldTransactions(): Promise<void> {
        console.log('💳 Cleaning up old transactions...');
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - (this.config.retentionDays || 90));

        const oldTransactions = await prisma.transaction.findMany({
            where: {
                createdAt: {
                    lt: cutoffDate
                },
                status: {
                    in: ['COMPLETED', 'FAILED']
                }
            }
        });

        if (oldTransactions.length > 0) {
            console.log(`  Found ${oldTransactions.length} old transactions older than ${this.config.retentionDays} days`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                if (this.config.mode === 'archive') {
                    // Archive transactions (add archived flag to metadata)
                    for (const transaction of oldTransactions) {
                        await prisma.transaction.update({
                            where: { id: transaction.id },
                            data: {
                                metadata: {
                                    ...(transaction.metadata as any || {}),
                                    archived: true,
                                    archivedAt: new Date().toISOString()
                                }
                            }
                        });
                        processedCount++;
                    }
                } else {
                    // Delete transactions
                    const result = await prisma.transaction.deleteMany({
                        where: {
                            id: {
                                in: oldTransactions.map(t => t.id)
                            }
                        }
                    });
                    processedCount = result.count;
                }
            } else {
                processedCount = oldTransactions.length;
            }

            this.results.push({
                tableName: 'Transaction (old)',
                recordsFound: oldTransactions.length,
                recordsProcessed: processedCount,
                action: this.config.mode === 'archive' ? 'archived' : 'deleted',
                success: true
            });
        }
    }

    private async cleanupFailedRequests(): Promise<void> {
        console.log('🧠 Cleaning up failed AI requests...');
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep failed requests for 7 days

        const failedRequests = await prisma.aIRequest.findMany({
            where: {
                createdAt: {
                    lt: cutoffDate
                },
                OR: [
                    { response: null },
                    { tokensUsed: 0 },
                    { cost: 0 }
                ]
            }
        });

        if (failedRequests.length > 0) {
            console.log(`  Found ${failedRequests.length} failed AI requests older than 7 days`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.aIRequest.deleteMany({
                    where: {
                        id: {
                            in: failedRequests.map(r => r.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = failedRequests.length;
            }

            this.results.push({
                tableName: 'AIRequest (failed)',
                recordsFound: failedRequests.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async cleanupUnusedPlugins(): Promise<void> {
        console.log('🔌 Cleaning up unused plugins...');
        
        const unusedPlugins = await prisma.plugin.findMany({
            where: {
                AND: [
                    { isActive: false },
                    { downloadCount: { lt: 10 } },
                    {
                        userPlugins: {
                            none: {}
                        }
                    }
                ]
            }
        });

        if (unusedPlugins.length > 0) {
            console.log(`  Found ${unusedPlugins.length} unused plugins`);
            
            let processedCount = 0;
            if (!this.config.dryRun && this.config.mode === 'hard') {
                const result = await prisma.plugin.deleteMany({
                    where: {
                        id: {
                            in: unusedPlugins.map(p => p.id)
                        }
                    }
                });
                processedCount = result.count;
            } else if (!this.config.dryRun) {
                // Soft delete - just mark as archived
                for (const plugin of unusedPlugins) {
                    await prisma.plugin.update({
                        where: { id: plugin.id },
                        data: {
                            metadata: {
                                ...(plugin.metadata as any || {}),
                                archived: true,
                                archivedAt: new Date().toISOString()
                            }
                        }
                    });
                    processedCount++;
                }
            } else {
                processedCount = unusedPlugins.length;
            }

            this.results.push({
                tableName: 'Plugin (unused)',
                recordsFound: unusedPlugins.length,
                recordsProcessed: processedCount,
                action: this.config.mode === 'hard' ? 'deleted' : 'archived',
                success: true
            });
        }
    }

    private async cleanupDuplicateRecords(): Promise<void> {
        console.log('🔍 Checking for duplicate records...');
        
        // Find duplicate users by email
        const duplicateEmails = await prisma.user.groupBy({
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

        if (duplicateEmails.length > 0) {
            console.log(`  Found ${duplicateEmails.length} duplicate email addresses`);
            
            let processedCount = 0;
            for (const duplicate of duplicateEmails) {
                const users = await prisma.user.findMany({
                    where: { email: duplicate.email },
                    orderBy: { createdAt: 'asc' }
                });
                
                // Keep the first user, mark others for cleanup
                const usersToDelete = users.slice(1);
                
                if (!this.config.dryRun) {
                    for (const user of usersToDelete) {
                        try {
                            // Delete related records first
                            await prisma.budgetLimit.deleteMany({ where: { userId: user.id } });
                            await prisma.userPlugin.deleteMany({ where: { userId: user.id } });
                            await prisma.aIRequest.deleteMany({ where: { userId: user.id } });
                            await prisma.transaction.deleteMany({ where: { userId: user.id } });
                            
                            const creditAccount = await prisma.creditAccount.findUnique({ where: { userId: user.id } });
                            if (creditAccount) {
                                await prisma.creditAccount.delete({ where: { id: creditAccount.id } });
                            }
                            
                            await prisma.user.delete({ where: { id: user.id } });
                            processedCount++;
                        } catch (error) {
                            console.error(`  ❌ Failed to delete duplicate user ${user.email}:`, error);
                        }
                    }
                } else {
                    processedCount += usersToDelete.length;
                }
            }

            if (processedCount > 0) {
                this.results.push({
                    tableName: 'User (duplicates)',
                    recordsFound: processedCount,
                    recordsProcessed: processedCount,
                    action: 'deleted',
                    success: true
                });
            }
        }
    }

    private async cleanupIncompleteRecords(): Promise<void> {
        console.log('📋 Cleaning up incomplete records...');
        
        // Find users without credit accounts
        const usersWithoutCredits = await prisma.user.findMany({
            where: {
                creditAccount: null
            }
        });

        if (usersWithoutCredits.length > 0) {
            console.log(`  Found ${usersWithoutCredits.length} users without credit accounts`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                // Create credit accounts for these users instead of deleting them
                for (const user of usersWithoutCredits) {
                    try {
                        await prisma.creditAccount.create({
                            data: {
                                userId: user.id,
                                totalCredits: user.role === 'ADMIN' ? 5000 : 500,
                                usedCredits: 0,
                                bonusCredits: 0,
                                metadata: {
                                    source: 'cleanup_tool',
                                    reason: 'missing_credit_account'
                                }
                            }
                        });
                        processedCount++;
                    } catch (error) {
                        console.error(`  ❌ Failed to create credit account for user ${user.email}:`, error);
                    }
                }

                this.results.push({
                    tableName: 'CreditAccount (missing)',
                    recordsFound: usersWithoutCredits.length,
                    recordsProcessed: processedCount,
                    action: 'deleted',
                    success: true
                });
            }
        }

        // Find transactions with zero amounts
        const zeroAmountTransactions = await prisma.transaction.findMany({
            where: {
                amount: 0
            }
        });

        if (zeroAmountTransactions.length > 0) {
            console.log(`  Found ${zeroAmountTransactions.length} transactions with zero amount`);
            
            let processedCount = 0;
            if (!this.config.dryRun) {
                const result = await prisma.transaction.deleteMany({
                    where: {
                        id: {
                            in: zeroAmountTransactions.map(t => t.id)
                        }
                    }
                });
                processedCount = result.count;
            } else {
                processedCount = zeroAmountTransactions.length;
            }

            this.results.push({
                tableName: 'Transaction (zero amount)',
                recordsFound: zeroAmountTransactions.length,
                recordsProcessed: processedCount,
                action: 'deleted',
                success: true
            });
        }
    }

    private async generateRecommendations(): Promise<string[]> {
        const recommendations: string[] = [];
        
        // Analyze results and generate recommendations
        const totalProcessed = this.results.reduce((sum, result) => sum + result.recordsProcessed, 0);
        
        if (totalProcessed > 100) {
            recommendations.push('Consider running data cleanup more frequently to prevent large accumulations of unnecessary data');
        }
        
        const orphanedResults = this.results.filter(r => r.tableName.includes('orphaned'));
        if (orphanedResults.length > 0) {
            recommendations.push('Review application code to prevent creation of orphaned records');
        }
        
        const duplicateResults = this.results.filter(r => r.tableName.includes('duplicate'));
        if (duplicateResults.length > 0) {
            recommendations.push('Implement unique constraints to prevent duplicate data creation');
        }
        
        if (this.config.dryRun) {
            recommendations.push('Run cleanup without dry-run mode to apply the changes');
        } else {
            recommendations.push('Monitor application performance after cleanup to ensure no issues');
        }
        
        recommendations.push('Schedule regular data cleanup operations (monthly or quarterly)');
        recommendations.push('Consider implementing automated data archiving for old records');
        
        return recommendations;
    }

    private async saveCleanupReport(report: CleanupReport): Promise<void> {
        const reportPath = path.join(
            this.config.createBackup ? this.backupDir : process.cwd(),
            'cleanup-report.json'
        );
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        // Generate human-readable summary
        const summaryPath = reportPath.replace('.json', '-summary.txt');
        let summary = `Data Cleanup Report\n`;
        summary += `===================\n\n`;
        summary += `Started: ${report.startTime}\n`;
        summary += `Completed: ${report.endTime}\n`;
        summary += `Mode: ${report.config.mode}\n`;
        summary += `Dry Run: ${report.config.dryRun ? 'YES' : 'NO'}\n`;
        summary += `Total Records Processed: ${report.totalRecordsProcessed}\n\n`;
        
        summary += `Results by Table:\n`;
        summary += `-----------------\n`;
        report.results.forEach(result => {
            summary += `${result.tableName}: ${result.recordsProcessed}/${result.recordsFound} ${result.action}\n`;
        });
        
        if (report.recommendations.length > 0) {
            summary += `\nRecommendations:\n`;
            summary += `----------------\n`;
            report.recommendations.forEach((rec, index) => {
                summary += `${index + 1}. ${rec}\n`;
            });
        }
        
        if (report.backupFiles.length > 0) {
            summary += `\nBackup Files Created:\n`;
            summary += `---------------------\n`;
            report.backupFiles.forEach(file => {
                summary += `- ${path.basename(file)}\n`;
            });
        }
        
        fs.writeFileSync(summaryPath, summary);
        
        console.log(`\n📄 Cleanup report saved to: ${reportPath}`);
        console.log(`📄 Summary saved to: ${summaryPath}`);
    }

    private printSummary(report: CleanupReport): void {
        console.log('\n🎯 CLEANUP SUMMARY');
        console.log('='.repeat(50));
        console.log(`Mode: ${report.config.mode} (${report.config.dryRun ? 'DRY RUN' : 'LIVE'})`);
        console.log(`Total Records Processed: ${report.totalRecordsProcessed}`);
        console.log(`Operations Completed: ${report.results.length}`);
        
        if (report.results.length > 0) {
            console.log('\nResults by Table:');
            report.results.forEach(result => {
                const status = result.success ? '✅' : '❌';
                console.log(`  ${status} ${result.tableName}: ${result.recordsProcessed}/${result.recordsFound} ${result.action}`);
            });
        }
        
        if (report.backupFiles.length > 0) {
            console.log(`\nBackup Files: ${report.backupFiles.length} created`);
        }
        
        if (report.recommendations.length > 0) {
            console.log('\nRecommendations:');
            report.recommendations.forEach((rec, index) => {
                console.log(`  ${index + 1}. ${rec}`);
            });
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Data Cleanup Tool for AI Employee Platform

Usage: npx tsx scripts/data-cleanup.ts [OPTIONS]

Options:
  --mode TYPE           Cleanup mode: soft, hard, archive (default: soft)
  --dry-run            Perform dry run without making changes (default: true)
  --no-backup          Skip backup creation
  --retention-days N   Retention period in days (default: 90)
  --no-test-account    Don't exclude test account from cleanup
  --inactive-users     Clean up inactive users
  --old-transactions   Clean up old transactions
  --failed-requests    Clean up failed AI requests
  --unused-plugins     Clean up unused plugins
  --orphaned-records   Clean up orphaned records (default: true)
  --help              Show this help message

Modes:
  soft                Mark records as inactive/archived (safer)
  hard                Permanently delete records
  archive             Move records to archive with metadata

Examples:
  npx tsx scripts/data-cleanup.ts --dry-run
  npx tsx scripts/data-cleanup.ts --mode hard --old-transactions --retention-days 30
  npx tsx scripts/data-cleanup.ts --mode soft --inactive-users --no-backup
  npx tsx scripts/data-cleanup.ts --orphaned-records --failed-requests
        `);
        process.exit(0);
    }

    // Parse configuration
    const config: CleanupConfig = {
        mode: 'soft',
        dryRun: true,
        createBackup: true,
        retentionDays: 90,
        excludeTestAccount: true,
        cleanupCriteria: {
            orphanedRecords: true,
            inactiveUsers: false,
            oldTransactions: false,
            failedRequests: false,
            unusedPlugins: false
        }
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
            case '--mode':
                config.mode = nextArg as any;
                i++;
                break;
            case '--dry-run':
                config.dryRun = true;
                break;
            case '--live':
                config.dryRun = false;
                break;
            case '--no-backup':
                config.createBackup = false;
                break;
            case '--retention-days':
                config.retentionDays = parseInt(nextArg) || 90;
                i++;
                break;
            case '--no-test-account':
                config.excludeTestAccount = false;
                break;
            case '--inactive-users':
                config.cleanupCriteria!.inactiveUsers = true;
                break;
            case '--old-transactions':
                config.cleanupCriteria!.oldTransactions = true;
                break;
            case '--failed-requests':
                config.cleanupCriteria!.failedRequests = true;
                break;
            case '--unused-plugins':
                config.cleanupCriteria!.unusedPlugins = true;
                break;
            case '--orphaned-records':
                config.cleanupCriteria!.orphanedRecords = true;
                break;
        }
    }

    try {
        const cleanupTool = new DataCleanupTool(config);
        const report = await cleanupTool.runCleanup();
        
        const hasErrors = report.results.some(result => !result.success);
        process.exit(hasErrors ? 1 : 0);
        
    } catch (error) {
        console.error('❌ Data cleanup failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { DataCleanupTool, type CleanupConfig, type CleanupResult, type CleanupReport };
