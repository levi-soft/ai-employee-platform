
const fs = require('fs');
const path = require('path');
const v8 = require('v8');

/**
 * Advanced Memory Profiler for Node.js Applications
 * Analyzes memory usage patterns, detects leaks, and generates detailed reports
 */

class MemoryProfiler {
    constructor(options = {}) {
        this.options = {
            sampleInterval: options.sampleInterval || 1000, // 1 second
            heapDumpInterval: options.heapDumpInterval || 60000, // 1 minute
            gcAnalysis: options.gcAnalysis !== false,
            outputDir: options.outputDir || './memory-profiles',
            maxSamples: options.maxSamples || 1000,
            thresholds: {
                memoryGrowth: options.thresholds?.memoryGrowth || 50, // MB
                heapGrowth: options.thresholds?.heapGrowth || 30, // MB
                gcFrequency: options.thresholds?.gcFrequency || 10 // GCs per minute
            }
        };
        
        this.isRunning = false;
        this.samples = [];
        this.gcEvents = [];
        this.heapDumps = [];
        this.intervals = [];
        this.startTime = null;
        this.baseline = null;
        
        // Ensure output directory exists
        if (!fs.existsSync(this.options.outputDir)) {
            fs.mkdirSync(this.options.outputDir, { recursive: true });
        }
        
        // Setup GC monitoring if available
        if (this.options.gcAnalysis && global.gc) {
            this.setupGCMonitoring();
        }
    }

    setupGCMonitoring() {
        const { PerformanceObserver } = require('perf_hooks');
        
        try {
            const obs = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    if (entry.entryType === 'gc') {
                        this.gcEvents.push({
                            timestamp: Date.now(),
                            kind: entry.detail?.kind || 'unknown',
                            flags: entry.detail?.flags || 0,
                            duration: entry.duration,
                            startTime: entry.startTime
                        });
                    }
                });
            });
            
            obs.observe({ entryTypes: ['gc'] });
            console.log('✅ GC monitoring enabled');
        } catch (error) {
            console.warn('⚠️ GC monitoring not available:', error.message);
        }
    }

    async startProfiling() {
        if (this.isRunning) {
            throw new Error('Profiler is already running');
        }

        console.log('🔍 Starting memory profiling...');
        this.isRunning = true;
        this.startTime = Date.now();
        this.samples = [];
        this.gcEvents = [];
        this.heapDumps = [];
        
        // Take baseline measurement
        this.baseline = this.takeSample();
        console.log(`📊 Baseline memory usage: ${(this.baseline.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        
        // Start sampling
        const samplingInterval = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(samplingInterval);
                return;
            }
            
            const sample = this.takeSample();
            this.samples.push(sample);
            
            // Limit sample count to prevent memory issues
            if (this.samples.length > this.options.maxSamples) {
                this.samples.shift();
            }
            
            // Check for immediate issues
            this.checkMemoryThresholds(sample);
            
        }, this.options.sampleInterval);
        
        this.intervals.push(samplingInterval);
        
        // Setup periodic heap dumps
        const heapDumpInterval = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(heapDumpInterval);
                return;
            }
            
            this.takeHeapSnapshot();
        }, this.options.heapDumpInterval);
        
        this.intervals.push(heapDumpInterval);
        
        console.log('✅ Memory profiling started');
        return this.baseline;
    }

    async stopProfiling() {
        if (!this.isRunning) {
            console.log('⚠️ Profiler is not running');
            return null;
        }

        console.log('🛑 Stopping memory profiling...');
        this.isRunning = false;
        
        // Clear all intervals
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        
        // Take final sample
        const finalSample = this.takeSample();
        this.samples.push(finalSample);
        
        // Analyze data
        const analysis = await this.analyzeMemoryUsage();
        
        console.log('✅ Memory profiling stopped');
        return analysis;
    }

    takeSample() {
        const memoryUsage = process.memoryUsage();
        const timestamp = Date.now();
        
        // Get heap space statistics if available
        let heapSpaces = null;
        try {
            if (v8.getHeapSpaceStatistics) {
                heapSpaces = v8.getHeapSpaceStatistics();
            }
        } catch (error) {
            // v8 statistics not available
        }
        
        return {
            timestamp,
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external,
            arrayBuffers: memoryUsage.arrayBuffers || 0,
            heapSpaces,
            uptime: process.uptime()
        };
    }

    checkMemoryThresholds(sample) {
        if (!this.baseline) return;
        
        const heapGrowthMB = (sample.heapUsed - this.baseline.heapUsed) / 1024 / 1024;
        const memoryGrowthMB = (sample.rss - this.baseline.rss) / 1024 / 1024;
        
        if (heapGrowthMB > this.options.thresholds.heapGrowth) {
            console.warn(`⚠️ High heap growth detected: +${heapGrowthMB.toFixed(2)}MB`);
        }
        
        if (memoryGrowthMB > this.options.thresholds.memoryGrowth) {
            console.warn(`⚠️ High memory growth detected: +${memoryGrowthMB.toFixed(2)}MB`);
        }
    }

    takeHeapSnapshot() {
        try {
            const timestamp = Date.now();
            const filename = `heap-${timestamp}.heapsnapshot`;
            const filepath = path.join(this.options.outputDir, filename);
            
            if (v8.writeHeapSnapshot) {
                const snapshotPath = v8.writeHeapSnapshot(filepath);
                
                this.heapDumps.push({
                    timestamp,
                    filename,
                    filepath: snapshotPath,
                    size: fs.statSync(snapshotPath).size
                });
                
                console.log(`📸 Heap snapshot taken: ${filename}`);
            } else {
                console.warn('⚠️ Heap snapshots not available in this Node.js version');
            }
        } catch (error) {
            console.error('❌ Failed to take heap snapshot:', error.message);
        }
    }

    async analyzeMemoryUsage() {
        if (this.samples.length < 2) {
            return { error: 'Insufficient data for analysis' };
        }

        const analysis = {
            duration: Date.now() - this.startTime,
            sampleCount: this.samples.length,
            baseline: this.baseline,
            final: this.samples[this.samples.length - 1],
            trends: {},
            statistics: {},
            leakIndicators: [],
            recommendations: [],
            gcAnalysis: null
        };

        // Calculate trends
        analysis.trends = this.calculateMemoryTrends();
        
        // Calculate statistics
        analysis.statistics = this.calculateMemoryStatistics();
        
        // Analyze GC events
        if (this.gcEvents.length > 0) {
            analysis.gcAnalysis = this.analyzeGCEvents();
        }
        
        // Detect potential leaks
        analysis.leakIndicators = this.detectMemoryLeaks();
        
        // Generate recommendations
        analysis.recommendations = this.generateRecommendations(analysis);
        
        return analysis;
    }

    calculateMemoryTrends() {
        const memoryValues = this.samples.map(s => s.heapUsed);
        const rssValues = this.samples.map(s => s.rss);
        const externalValues = this.samples.map(s => s.external);
        
        return {
            heapTrend: this.calculateTrend(memoryValues),
            rssTrend: this.calculateTrend(rssValues),
            externalTrend: this.calculateTrend(externalValues),
            heapGrowthRate: this.calculateGrowthRate(memoryValues),
            rssGrowthRate: this.calculateGrowthRate(rssValues)
        };
    }

    calculateTrend(values) {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const sumX = (n * (n + 1)) / 2;
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = values.reduce((sum, y, x) => sum + (x + 1) * y, 0);
        const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope;
    }

    calculateGrowthRate(values) {
        if (values.length < 2) return 0;
        
        const initial = values[0];
        const final = values[values.length - 1];
        
        return initial === 0 ? 0 : ((final - initial) / initial) * 100;
    }

    calculateMemoryStatistics() {
        const heapValues = this.samples.map(s => s.heapUsed);
        const rssValues = this.samples.map(s => s.rss);
        
        return {
            heap: this.calculateStats(heapValues),
            rss: this.calculateStats(rssValues),
            external: this.calculateStats(this.samples.map(s => s.external)),
            arrayBuffers: this.calculateStats(this.samples.map(s => s.arrayBuffers))
        };
    }

    calculateStats(values) {
        if (values.length === 0) return {};
        
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        
        return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean: sum / values.length,
            median: sorted[Math.floor(sorted.length / 2)],
            p75: sorted[Math.floor(sorted.length * 0.75)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            stdDev: this.calculateStandardDeviation(values)
        };
    }

    calculateStandardDeviation(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    analyzeGCEvents() {
        if (this.gcEvents.length === 0) return null;
        
        const gcsByKind = {};
        let totalGCTime = 0;
        
        this.gcEvents.forEach(event => {
            const kind = event.kind || 'unknown';
            if (!gcsByKind[kind]) {
                gcsByKind[kind] = { count: 0, totalDuration: 0, averageDuration: 0 };
            }
            
            gcsByKind[kind].count++;
            gcsByKind[kind].totalDuration += event.duration;
            totalGCTime += event.duration;
        });
        
        // Calculate averages
        Object.keys(gcsByKind).forEach(kind => {
            gcsByKind[kind].averageDuration = 
                gcsByKind[kind].totalDuration / gcsByKind[kind].count;
        });
        
        const durationMinutes = (Date.now() - this.startTime) / 1000 / 60;
        
        return {
            totalEvents: this.gcEvents.length,
            totalGCTime,
            averageGCTime: totalGCTime / this.gcEvents.length,
            gcFrequency: this.gcEvents.length / durationMinutes,
            gcsByKind,
            gcTimePercentage: (totalGCTime / (Date.now() - this.startTime)) * 100
        };
    }

    detectMemoryLeaks() {
        const indicators = [];
        const trends = this.calculateMemoryTrends();
        
        // Check for consistent memory growth
        if (trends.heapTrend > 1000) { // More than 1KB per sample
            indicators.push({
                type: 'CONSISTENT_HEAP_GROWTH',
                severity: 'HIGH',
                description: 'Heap memory shows consistent upward trend',
                rate: trends.heapGrowthRate,
                recommendation: 'Investigate object retention and potential memory leaks'
            });
        }
        
        if (trends.rssTrend > 5000) { // More than 5KB per sample
            indicators.push({
                type: 'CONSISTENT_RSS_GROWTH',
                severity: 'HIGH',
                description: 'RSS memory shows consistent upward trend',
                rate: trends.rssGrowthRate,
                recommendation: 'Check for native memory leaks or excessive buffer usage'
            });
        }
        
        // Check for high external memory growth
        if (trends.externalTrend > 1000) {
            indicators.push({
                type: 'EXTERNAL_MEMORY_GROWTH',
                severity: 'MEDIUM',
                description: 'External memory usage growing consistently',
                rate: this.calculateGrowthRate(this.samples.map(s => s.external)),
                recommendation: 'Review usage of native modules and external resources'
            });
        }
        
        // Check GC effectiveness
        if (this.gcEvents.length > 0) {
            const gcAnalysis = this.analyzeGCEvents();
            
            if (gcAnalysis.gcFrequency > this.options.thresholds.gcFrequency) {
                indicators.push({
                    type: 'HIGH_GC_FREQUENCY',
                    severity: 'MEDIUM',
                    description: 'Garbage collection occurring very frequently',
                    frequency: gcAnalysis.gcFrequency,
                    recommendation: 'Optimize object allocation patterns and reduce object churn'
                });
            }
            
            if (gcAnalysis.gcTimePercentage > 5) {
                indicators.push({
                    type: 'HIGH_GC_TIME',
                    severity: 'HIGH',
                    description: 'High percentage of time spent in garbage collection',
                    percentage: gcAnalysis.gcTimePercentage,
                    recommendation: 'Reduce object allocation frequency and size'
                });
            }
        }
        
        return indicators;
    }

    generateRecommendations(analysis) {
        const recommendations = [];
        
        // Memory usage recommendations
        const finalHeapMB = analysis.final.heapUsed / 1024 / 1024;
        const finalRssMB = analysis.final.rss / 1024 / 1024;
        
        if (finalHeapMB > 500) {
            recommendations.push({
                type: 'HIGH_HEAP_USAGE',
                priority: 'HIGH',
                description: `High heap usage detected: ${finalHeapMB.toFixed(2)}MB`,
                actions: [
                    'Profile heap usage to identify large objects',
                    'Implement object pooling for frequently created objects',
                    'Consider using streams for large data processing',
                    'Review data structures for memory efficiency'
                ]
            });
        }
        
        if (finalRssMB > 1000) {
            recommendations.push({
                type: 'HIGH_RSS_USAGE',
                priority: 'HIGH',
                description: `High RSS usage detected: ${finalRssMB.toFixed(2)}MB`,
                actions: [
                    'Check for memory leaks in native modules',
                    'Review buffer usage and cleanup',
                    'Consider memory limits and scaling options',
                    'Monitor for external memory growth'
                ]
            });
        }
        
        // Growth rate recommendations
        if (analysis.trends.heapGrowthRate > 50) {
            recommendations.push({
                type: 'HIGH_GROWTH_RATE',
                priority: 'MEDIUM',
                description: `High memory growth rate: ${analysis.trends.heapGrowthRate.toFixed(2)}%`,
                actions: [
                    'Implement regular monitoring and alerts',
                    'Consider implementing memory limits',
                    'Review application lifecycle for cleanup opportunities',
                    'Add garbage collection optimization'
                ]
            });
        }
        
        // Add leak-specific recommendations
        analysis.leakIndicators.forEach(indicator => {
            if (indicator.recommendation) {
                recommendations.push({
                    type: indicator.type,
                    priority: indicator.severity,
                    description: indicator.description,
                    actions: [indicator.recommendation]
                });
            }
        });
        
        return recommendations;
    }

    async generateReport(outputFile = null) {
        const analysis = await this.analyzeMemoryUsage();
        
        if (!outputFile) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            outputFile = path.join(this.options.outputDir, `memory-profile-${timestamp}.json`);
        }
        
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                profilerOptions: this.options
            },
            analysis,
            samples: this.samples,
            gcEvents: this.gcEvents,
            heapDumps: this.heapDumps.map(dump => ({
                ...dump,
                filepath: path.basename(dump.filepath) // Don't expose full paths
            }))
        };
        
        fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
        
        console.log(`📄 Memory profile report saved to: ${outputFile}`);
        
        // Generate human-readable summary
        const summaryFile = outputFile.replace('.json', '-summary.txt');
        this.generateTextSummary(analysis, summaryFile);
        
        return { reportFile: outputFile, summaryFile, analysis };
    }

    generateTextSummary(analysis, summaryFile) {
        const durationMinutes = (analysis.duration / 1000 / 60).toFixed(2);
        const baselineHeapMB = (analysis.baseline.heapUsed / 1024 / 1024).toFixed(2);
        const finalHeapMB = (analysis.final.heapUsed / 1024 / 1024).toFixed(2);
        const heapGrowthMB = (finalHeapMB - baselineHeapMB).toFixed(2);
        
        let summary = `Memory Profile Summary\n`;
        summary += `=====================\n\n`;
        summary += `Duration: ${durationMinutes} minutes\n`;
        summary += `Samples: ${analysis.sampleCount}\n`;
        summary += `Node.js: ${process.version}\n\n`;
        
        summary += `Memory Usage:\n`;
        summary += `- Baseline Heap: ${baselineHeapMB}MB\n`;
        summary += `- Final Heap: ${finalHeapMB}MB\n`;
        summary += `- Heap Growth: ${heapGrowthMB}MB\n`;
        summary += `- Growth Rate: ${analysis.trends.heapGrowthRate.toFixed(2)}%\n\n`;
        
        if (analysis.gcAnalysis) {
            summary += `Garbage Collection:\n`;
            summary += `- Total GC Events: ${analysis.gcAnalysis.totalEvents}\n`;
            summary += `- GC Frequency: ${analysis.gcAnalysis.gcFrequency.toFixed(2)} per minute\n`;
            summary += `- Time in GC: ${analysis.gcAnalysis.gcTimePercentage.toFixed(2)}%\n\n`;
        }
        
        if (analysis.leakIndicators.length > 0) {
            summary += `Potential Issues:\n`;
            analysis.leakIndicators.forEach(indicator => {
                summary += `- ${indicator.type}: ${indicator.description}\n`;
            });
            summary += `\n`;
        }
        
        if (analysis.recommendations.length > 0) {
            summary += `Recommendations:\n`;
            analysis.recommendations.forEach((rec, index) => {
                summary += `${index + 1}. [${rec.priority}] ${rec.description}\n`;
                rec.actions.forEach(action => {
                    summary += `   - ${action}\n`;
                });
            });
        }
        
        fs.writeFileSync(summaryFile, summary);
        console.log(`📄 Memory profile summary saved to: ${summaryFile}`);
    }
}

module.exports = { MemoryProfiler };

// CLI usage
if (require.main === module) {
    const profiler = new MemoryProfiler({
        outputDir: process.argv[2] || './memory-profiles',
        sampleInterval: parseInt(process.argv[3]) || 1000,
        heapDumpInterval: parseInt(process.argv[4]) || 60000
    });
    
    const duration = parseInt(process.argv[5]) || 60000; // Default 1 minute
    
    console.log(`🔍 Starting memory profiling for ${duration / 1000} seconds...`);
    
    profiler.startProfiling().then(() => {
        setTimeout(async () => {
            try {
                const results = await profiler.stopProfiling();
                await profiler.generateReport();
                
                console.log('\n✅ Memory profiling completed successfully!');
                console.log('📊 Check the generated reports for detailed analysis.');
                
                process.exit(0);
            } catch (error) {
                console.error('❌ Error during profiling:', error);
                process.exit(1);
            }
        }, duration);
    }).catch(error => {
        console.error('❌ Failed to start profiling:', error);
        process.exit(1);
    });
}
