
const os = require('os');
const pidusage = require('pidusage');
const { performance, PerformanceObserver } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

/**
 * Comprehensive System Profiler
 * Monitors system resources, performance metrics, and bottlenecks
 */

class SystemProfiler {
    constructor() {
        this.isRunning = false;
        this.profileData = {
            startTime: 0,
            endTime: 0,
            systemInfo: {},
            resourceUsage: [],
            performanceMetrics: [],
            memorySnapshots: [],
            bottlenecks: [],
            recommendations: []
        };
        
        this.monitoringInterval = null;
        this.performanceObserver = null;
        this.sampleInterval = 1000; // 1 second
        this.thresholds = {
            cpuUsage: 80, // %
            memoryUsage: 85, // %
            loadAverage: os.cpus().length * 0.8, // 80% of CPU cores
            responseTime: 2000, // 2 seconds
            throughput: 100 // requests per second
        };
    }

    async startProfiling() {
        if (this.isRunning) {
            console.log('⚠️ Profiler is already running');
            return;
        }

        console.log('🔍 Starting system profiling...');
        this.isRunning = true;
        this.profileData.startTime = Date.now();
        
        // Collect system information
        await this.collectSystemInfo();
        
        // Setup performance observer
        this.setupPerformanceObserver();
        
        // Start resource monitoring
        this.startResourceMonitoring();
        
        console.log('✅ System profiling started');
    }

    async stopProfiling() {
        if (!this.isRunning) {
            console.log('⚠️ Profiler is not running');
            return this.profileData;
        }

        console.log('🛑 Stopping system profiling...');
        this.isRunning = false;
        this.profileData.endTime = Date.now();
        
        // Clear intervals and observers
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
        }
        
        // Analyze data and generate recommendations
        await this.analyzePerformance();
        await this.generateRecommendations();
        
        console.log('✅ System profiling stopped');
        return this.profileData;
    }

    async collectSystemInfo() {
        this.profileData.systemInfo = {
            platform: os.platform(),
            architecture: os.arch(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime(),
            loadAverage: os.loadavg(),
            nodeVersion: process.version,
            timestamp: new Date().toISOString()
        };
    }

    setupPerformanceObserver() {
        try {
            this.performanceObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    this.profileData.performanceMetrics.push({
                        name: entry.name,
                        type: entry.entryType,
                        startTime: entry.startTime,
                        duration: entry.duration,
                        timestamp: Date.now()
                    });
                    
                    // Check for performance issues
                    if (entry.duration > this.thresholds.responseTime) {
                        this.recordBottleneck('HIGH_RESPONSE_TIME', {
                            operation: entry.name,
                            duration: entry.duration,
                            threshold: this.thresholds.responseTime
                        });
                    }
                });
            });
            
            this.performanceObserver.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
        } catch (error) {
            console.warn('Performance Observer not available:', error.message);
        }
    }

    startResourceMonitoring() {
        this.monitoringInterval = setInterval(async () => {
            if (!this.isRunning) return;
            
            const timestamp = Date.now();
            
            // Get system resource usage
            const cpuUsage = await this.getCPUUsage();
            const memoryUsage = this.getMemoryUsage();
            const processStats = await this.getProcessStats();
            
            const resourceData = {
                timestamp,
                cpu: cpuUsage,
                memory: memoryUsage,
                process: processStats,
                loadAverage: os.loadavg()
            };
            
            this.profileData.resourceUsage.push(resourceData);
            
            // Check for bottlenecks
            this.checkResourceBottlenecks(resourceData);
            
            // Take memory snapshot if needed
            if (memoryUsage.percentUsed > this.thresholds.memoryUsage) {
                await this.takeMemorySnapshot();
            }
            
        }, this.sampleInterval);
    }

    async getCPUUsage() {
        return new Promise(resolve => {
            const startMeasure = this.getCPUInfo();
            setTimeout(() => {
                const endMeasure = this.getCPUInfo();
                const idleDiff = endMeasure.idle - startMeasure.idle;
                const totalDiff = endMeasure.total - startMeasure.total;
                const usage = 100 - ~~(100 * idleDiff / totalDiff);
                resolve(usage);
            }, 100);
        });
    }

    getCPUInfo() {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        
        cpus.forEach(cpu => {
            Object.keys(cpu.times).forEach(type => {
                total += cpu.times[type];
            });
            idle += cpu.times.idle;
        });
        
        return { idle, total };
    }

    getMemoryUsage() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        
        return {
            total,
            free,
            used,
            percentUsed: (used / total) * 100,
            available: free
        };
    }

    async getProcessStats() {
        try {
            const stats = await pidusage(process.pid);
            return {
                cpu: stats.cpu,
                memory: stats.memory,
                ppid: stats.ppid,
                pid: stats.pid,
                ctime: stats.ctime,
                elapsed: stats.elapsed,
                timestamp: stats.timestamp
            };
        } catch (error) {
            return null;
        }
    }

    checkResourceBottlenecks(resourceData) {
        // CPU bottleneck
        if (resourceData.cpu > this.thresholds.cpuUsage) {
            this.recordBottleneck('HIGH_CPU_USAGE', {
                usage: resourceData.cpu,
                threshold: this.thresholds.cpuUsage,
                timestamp: resourceData.timestamp
            });
        }
        
        // Memory bottleneck
        if (resourceData.memory.percentUsed > this.thresholds.memoryUsage) {
            this.recordBottleneck('HIGH_MEMORY_USAGE', {
                usage: resourceData.memory.percentUsed,
                threshold: this.thresholds.memoryUsage,
                availableGB: (resourceData.memory.available / 1024 / 1024 / 1024).toFixed(2),
                timestamp: resourceData.timestamp
            });
        }
        
        // Load average bottleneck
        const currentLoad = resourceData.loadAverage[0];
        if (currentLoad > this.thresholds.loadAverage) {
            this.recordBottleneck('HIGH_LOAD_AVERAGE', {
                loadAverage: currentLoad,
                threshold: this.thresholds.loadAverage,
                cpuCores: os.cpus().length,
                timestamp: resourceData.timestamp
            });
        }
    }

    recordBottleneck(type, data) {
        this.profileData.bottlenecks.push({
            type,
            data,
            severity: this.calculateSeverity(type, data),
            timestamp: Date.now()
        });
    }

    calculateSeverity(type, data) {
        switch (type) {
            case 'HIGH_CPU_USAGE':
                if (data.usage > 95) return 'CRITICAL';
                if (data.usage > 90) return 'HIGH';
                return 'MEDIUM';
                
            case 'HIGH_MEMORY_USAGE':
                if (data.usage > 95) return 'CRITICAL';
                if (data.usage > 90) return 'HIGH';
                return 'MEDIUM';
                
            case 'HIGH_RESPONSE_TIME':
                if (data.duration > 5000) return 'CRITICAL';
                if (data.duration > 3000) return 'HIGH';
                return 'MEDIUM';
                
            default:
                return 'MEDIUM';
        }
    }

    async takeMemorySnapshot() {
        try {
            const memoryUsage = process.memoryUsage();
            const heapSpaceStatistics = v8.getHeapSpaceStatistics ? v8.getHeapSpaceStatistics() : null;
            
            const snapshot = {
                timestamp: Date.now(),
                processMemory: memoryUsage,
                heapSpaces: heapSpaceStatistics,
                systemMemory: this.getMemoryUsage()
            };
            
            this.profileData.memorySnapshots.push(snapshot);
        } catch (error) {
            console.warn('Failed to take memory snapshot:', error.message);
        }
    }

    async analyzePerformance() {
        const duration = this.profileData.endTime - this.profileData.startTime;
        const resourceData = this.profileData.resourceUsage;
        
        if (resourceData.length === 0) return;
        
        // Calculate averages
        const avgCPU = resourceData.reduce((sum, data) => sum + data.cpu, 0) / resourceData.length;
        const avgMemory = resourceData.reduce((sum, data) => sum + data.memory.percentUsed, 0) / resourceData.length;
        const avgLoad = resourceData.reduce((sum, data) => sum + data.loadAverage[0], 0) / resourceData.length;
        
        // Find peaks
        const maxCPU = Math.max(...resourceData.map(d => d.cpu));
        const maxMemory = Math.max(...resourceData.map(d => d.memory.percentUsed));
        const maxLoad = Math.max(...resourceData.map(d => d.loadAverage[0]));
        
        this.profileData.analysis = {
            duration,
            averages: {
                cpu: avgCPU.toFixed(2),
                memory: avgMemory.toFixed(2),
                loadAverage: avgLoad.toFixed(2)
            },
            peaks: {
                cpu: maxCPU.toFixed(2),
                memory: maxMemory.toFixed(2),
                loadAverage: maxLoad.toFixed(2)
            },
            bottleneckCount: this.profileData.bottlenecks.length,
            criticalBottlenecks: this.profileData.bottlenecks.filter(b => b.severity === 'CRITICAL').length
        };
    }

    async generateRecommendations() {
        const analysis = this.profileData.analysis;
        const bottlenecks = this.profileData.bottlenecks;
        
        // CPU recommendations
        if (analysis.peaks.cpu > 90) {
            this.profileData.recommendations.push({
                type: 'CPU_OPTIMIZATION',
                priority: 'HIGH',
                description: 'High CPU usage detected. Consider scaling horizontally or optimizing CPU-intensive operations.',
                actions: [
                    'Profile individual functions to identify CPU bottlenecks',
                    'Implement caching for expensive calculations',
                    'Consider using worker threads for CPU-intensive tasks',
                    'Scale horizontally by adding more instances'
                ]
            });
        }
        
        // Memory recommendations
        if (analysis.peaks.memory > 85) {
            this.profileData.recommendations.push({
                type: 'MEMORY_OPTIMIZATION',
                priority: 'HIGH',
                description: 'High memory usage detected. Check for memory leaks and optimize memory usage.',
                actions: [
                    'Analyze memory snapshots for potential leaks',
                    'Implement proper garbage collection strategies',
                    'Reduce memory footprint of data structures',
                    'Consider memory-efficient algorithms',
                    'Add memory monitoring and alerts'
                ]
            });
        }
        
        // Response time recommendations
        const slowOperations = this.profileData.performanceMetrics
            .filter(m => m.duration > this.thresholds.responseTime);
        
        if (slowOperations.length > 0) {
            this.profileData.recommendations.push({
                type: 'RESPONSE_TIME_OPTIMIZATION',
                priority: 'MEDIUM',
                description: `${slowOperations.length} operations exceeded response time threshold.`,
                actions: [
                    'Optimize database queries and add proper indexes',
                    'Implement caching for frequently accessed data',
                    'Use connection pooling for external services',
                    'Consider async processing for long-running operations'
                ]
            });
        }
        
        // Load balancing recommendations
        if (analysis.peaks.loadAverage > this.thresholds.loadAverage) {
            this.profileData.recommendations.push({
                type: 'LOAD_BALANCING',
                priority: 'MEDIUM',
                description: 'High system load detected. Consider load balancing strategies.',
                actions: [
                    'Implement horizontal pod autoscaling (HPA)',
                    'Add load balancing between service instances',
                    'Distribute workload across multiple servers',
                    'Implement circuit breaker patterns'
                ]
            });
        }
    }

    generateReport() {
        const analysis = this.profileData.analysis;
        const duration = (this.profileData.endTime - this.profileData.startTime) / 1000;
        
        console.log('\n📊 SYSTEM PERFORMANCE PROFILE');
        console.log('='.repeat(60));
        console.log(`⏱️  Profile Duration: ${duration.toFixed(2)} seconds`);
        console.log(`💻 CPU Cores: ${this.profileData.systemInfo.cpus}`);
        console.log(`🧠 Total Memory: ${(this.profileData.systemInfo.totalMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
        
        if (analysis) {
            console.log('\n📈 RESOURCE USAGE ANALYSIS');
            console.log('-'.repeat(40));
            console.log(`Average CPU: ${analysis.averages.cpu}%`);
            console.log(`Peak CPU: ${analysis.peaks.cpu}%`);
            console.log(`Average Memory: ${analysis.averages.memory}%`);
            console.log(`Peak Memory: ${analysis.peaks.memory}%`);
            console.log(`Average Load: ${analysis.averages.loadAverage}`);
            console.log(`Peak Load: ${analysis.peaks.loadAverage}`);
        }
        
        if (this.profileData.bottlenecks.length > 0) {
            console.log('\n🚨 BOTTLENECKS DETECTED');
            console.log('-'.repeat(40));
            console.log(`Total Bottlenecks: ${this.profileData.bottlenecks.length}`);
            console.log(`Critical: ${this.profileData.bottlenecks.filter(b => b.severity === 'CRITICAL').length}`);
            console.log(`High: ${this.profileData.bottlenecks.filter(b => b.severity === 'HIGH').length}`);
            console.log(`Medium: ${this.profileData.bottlenecks.filter(b => b.severity === 'MEDIUM').length}`);
        }
        
        if (this.profileData.recommendations.length > 0) {
            console.log('\n💡 PERFORMANCE RECOMMENDATIONS');
            console.log('-'.repeat(40));
            this.profileData.recommendations.forEach((rec, index) => {
                console.log(`${index + 1}. [${rec.priority}] ${rec.type}`);
                console.log(`   ${rec.description}`);
                rec.actions.forEach(action => {
                    console.log(`   - ${action}`);
                });
                console.log('');
            });
        }
        
        return this.profileData;
    }

    async saveReport(outputDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFile = path.join(outputDir, `system-profile-${timestamp}.json`);
        const summaryFile = path.join(outputDir, `system-profile-summary-${timestamp}.txt`);
        
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Save detailed JSON report
        fs.writeFileSync(reportFile, JSON.stringify(this.profileData, null, 2));
        
        // Generate and save text summary
        let summary = this.generateTextSummary();
        fs.writeFileSync(summaryFile, summary);
        
        console.log(`📄 Detailed report saved to: ${reportFile}`);
        console.log(`📄 Summary report saved to: ${summaryFile}`);
        
        return { reportFile, summaryFile };
    }

    generateTextSummary() {
        const analysis = this.profileData.analysis;
        const duration = (this.profileData.endTime - this.profileData.startTime) / 1000;
        
        let summary = `System Performance Profile Report\n`;
        summary += `Generated: ${new Date().toISOString()}\n`;
        summary += `Duration: ${duration.toFixed(2)} seconds\n\n`;
        
        summary += `System Information:\n`;
        summary += `- Platform: ${this.profileData.systemInfo.platform}\n`;
        summary += `- CPU Cores: ${this.profileData.systemInfo.cpus}\n`;
        summary += `- Total Memory: ${(this.profileData.systemInfo.totalMemory / 1024 / 1024 / 1024).toFixed(2)}GB\n\n`;
        
        if (analysis) {
            summary += `Performance Analysis:\n`;
            summary += `- Average CPU Usage: ${analysis.averages.cpu}%\n`;
            summary += `- Peak CPU Usage: ${analysis.peaks.cpu}%\n`;
            summary += `- Average Memory Usage: ${analysis.averages.memory}%\n`;
            summary += `- Peak Memory Usage: ${analysis.peaks.memory}%\n`;
            summary += `- Average Load: ${analysis.averages.loadAverage}\n`;
            summary += `- Peak Load: ${analysis.peaks.loadAverage}\n\n`;
        }
        
        summary += `Bottlenecks: ${this.profileData.bottlenecks.length} detected\n`;
        summary += `- Critical: ${this.profileData.bottlenecks.filter(b => b.severity === 'CRITICAL').length}\n`;
        summary += `- High: ${this.profileData.bottlenecks.filter(b => b.severity === 'HIGH').length}\n`;
        summary += `- Medium: ${this.profileData.bottlenecks.filter(b => b.severity === 'MEDIUM').length}\n\n`;
        
        summary += `Recommendations: ${this.profileData.recommendations.length}\n`;
        this.profileData.recommendations.forEach((rec, index) => {
            summary += `${index + 1}. [${rec.priority}] ${rec.type}\n`;
            summary += `   ${rec.description}\n`;
        });
        
        return summary;
    }
}

module.exports = { SystemProfiler };

// CLI usage
if (require.main === module) {
    const profiler = new SystemProfiler();
    const outputDir = process.argv[2] || './performance-reports';
    const duration = parseInt(process.argv[3]) || 60000; // Default 1 minute
    
    console.log(`🔍 Starting system profiling for ${duration / 1000} seconds...`);
    
    profiler.startProfiling().then(() => {
        setTimeout(async () => {
            const results = await profiler.stopProfiling();
            profiler.generateReport();
            await profiler.saveReport(outputDir);
            
            console.log('\n✅ Profiling completed successfully!');
            process.exit(0);
        }, duration);
    }).catch(error => {
        console.error('❌ Profiling failed:', error);
        process.exit(1);
    });
}
