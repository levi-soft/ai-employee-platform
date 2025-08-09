
const axios = require('axios');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');

/**
 * AI Routing Service Load Test
 * Tests AI request routing and processing under load
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
const WS_BASE_URL = process.env.WS_BASE_URL || 'ws://localhost:8080';
const CONCURRENT_REQUESTS = 500;
const TEST_DURATION_SECONDS = 300;
const AI_REQUEST_TIMEOUT = 60000; // 60 seconds

class AIRoutingLoadTester {
    constructor() {
        this.results = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            timeoutRequests: 0,
            responseTimePercentiles: {},
            throughput: 0,
            errorsByType: {},
            aiProviderStats: {},
            startTime: 0,
            endTime: 0
        };
        
        this.responseTimes = [];
        this.authToken = null;
        
        // AI request scenarios
        this.requestScenarios = [
            {
                type: 'simple_chat',
                prompt: 'Hello, how are you today?',
                maxTokens: 100,
                temperature: 0.7
            },
            {
                type: 'complex_reasoning',
                prompt: 'Explain the concept of quantum computing in simple terms and provide three real-world applications.',
                maxTokens: 500,
                temperature: 0.3
            },
            {
                type: 'code_generation',
                prompt: 'Write a Python function that calculates the fibonacci sequence up to n numbers.',
                maxTokens: 300,
                temperature: 0.1
            },
            {
                type: 'creative_writing',
                prompt: 'Write a short story about a robot discovering emotions.',
                maxTokens: 800,
                temperature: 0.9
            },
            {
                type: 'data_analysis',
                prompt: 'Analyze the following sales data and provide insights: Q1: $100k, Q2: $150k, Q3: $120k, Q4: $180k',
                maxTokens: 400,
                temperature: 0.2
            }
        ];
    }

    async authenticate() {
        try {
            // Register test user for AI routing
            const registerResponse = await axios.post(`${API_BASE_URL}/api/auth/register`, {
                email: `aitest-${Date.now()}@example.com`,
                password: 'AiTest123!',
                firstName: 'AI',
                lastName: 'Tester'
            });

            this.authToken = registerResponse.data.accessToken;
            console.log('✅ Authentication successful for AI load test');
            return true;
        } catch (error) {
            console.error('❌ Authentication failed:', error.response?.data || error.message);
            return false;
        }
    }

    async makeAIRequest(scenario, requestId) {
        const startTime = performance.now();
        
        try {
            const response = await axios.post(
                `${API_BASE_URL}/api/ai/chat/completions`,
                {
                    messages: [
                        {
                            role: 'user',
                            content: scenario.prompt
                        }
                    ],
                    maxTokens: scenario.maxTokens,
                    temperature: scenario.temperature,
                    requestId: `load-test-${requestId}`
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: AI_REQUEST_TIMEOUT
                }
            );
            
            const endTime = performance.now();
            const responseTime = endTime - startTime;
            
            this.recordResponse(responseTime, true, scenario.type, response.data);
            
            return {
                success: true,
                responseTime,
                provider: response.data.provider,
                tokensUsed: response.data.usage?.totalTokens || 0
            };
            
        } catch (error) {
            const endTime = performance.now();
            const responseTime = endTime - startTime;
            
            let errorType = 'UNKNOWN_ERROR';
            if (error.code === 'ECONNABORTED') {
                errorType = 'TIMEOUT';
                this.results.timeoutRequests++;
            } else if (error.response?.status) {
                errorType = `HTTP_${error.response.status}`;
            } else if (error.code) {
                errorType = error.code;
            }
            
            this.recordResponse(responseTime, false, scenario.type, null, errorType);
            
            return {
                success: false,
                responseTime,
                error: error.message,
                errorType
            };
        }
    }

    recordResponse(responseTime, success, requestType, responseData = null, errorType = null) {
        this.results.totalRequests++;
        
        if (success) {
            this.results.successfulRequests++;
            this.responseTimes.push(responseTime);
            
            // Track AI provider statistics
            if (responseData && responseData.provider) {
                const provider = responseData.provider;
                if (!this.results.aiProviderStats[provider]) {
                    this.results.aiProviderStats[provider] = {
                        requests: 0,
                        totalTokens: 0,
                        averageResponseTime: 0,
                        responseTimes: []
                    };
                }
                
                this.results.aiProviderStats[provider].requests++;
                this.results.aiProviderStats[provider].totalTokens += responseData.usage?.totalTokens || 0;
                this.results.aiProviderStats[provider].responseTimes.push(responseTime);
                
                // Calculate running average
                const providerStats = this.results.aiProviderStats[provider];
                providerStats.averageResponseTime = 
                    providerStats.responseTimes.reduce((a, b) => a + b, 0) / providerStats.responseTimes.length;
            }
        } else {
            this.results.failedRequests++;
            if (errorType) {
                this.results.errorsByType[errorType] = (this.results.errorsByType[errorType] || 0) + 1;
            }
        }
    }

    async runConcurrentRequests() {
        console.log(`🚀 Starting AI routing load test with ${CONCURRENT_REQUESTS} concurrent requests...`);
        
        this.results.startTime = performance.now();
        const promises = [];
        
        for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
            const scenario = this.requestScenarios[i % this.requestScenarios.length];
            const delay = (i / 10) * 100; // Stagger requests to avoid overwhelming
            
            promises.push(
                new Promise(resolve => {
                    setTimeout(async () => {
                        const result = await this.makeAIRequest(scenario, i);
                        resolve(result);
                    }, delay);
                })
            );
        }
        
        console.log('⏳ Waiting for all AI requests to complete...');
        const results = await Promise.all(promises);
        
        this.results.endTime = performance.now();
        const totalDuration = (this.results.endTime - this.results.startTime) / 1000;
        this.results.throughput = this.results.totalRequests / totalDuration;
        
        return results;
    }

    calculatePercentiles() {
        if (this.responseTimes.length === 0) return;
        
        const sorted = this.responseTimes.sort((a, b) => a - b);
        const percentiles = [50, 75, 90, 95, 99];
        
        percentiles.forEach(p => {
            const index = Math.ceil((p / 100) * sorted.length) - 1;
            this.results.responseTimePercentiles[`p${p}`] = sorted[index] || 0;
        });
    }

    generateReport() {
        this.calculatePercentiles();
        
        const totalDuration = (this.results.endTime - this.results.startTime) / 1000;
        const successRate = (this.results.successfulRequests / this.results.totalRequests * 100).toFixed(2);
        const timeoutRate = (this.results.timeoutRequests / this.results.totalRequests * 100).toFixed(2);
        
        console.log('\n🎯 AI ROUTING LOAD TEST RESULTS');
        console.log('='.repeat(60));
        console.log(`📊 Total Requests: ${this.results.totalRequests}`);
        console.log(`✅ Successful: ${this.results.successfulRequests}`);
        console.log(`❌ Failed: ${this.results.failedRequests}`);
        console.log(`⏰ Timeouts: ${this.results.timeoutRequests}`);
        console.log(`📈 Success Rate: ${successRate}%`);
        console.log(`⏰ Timeout Rate: ${timeoutRate}%`);
        console.log(`⚡ Throughput: ${this.results.throughput.toFixed(2)} req/sec`);
        console.log(`⏱️  Total Duration: ${totalDuration.toFixed(2)} seconds`);
        
        console.log('\n📊 RESPONSE TIME PERCENTILES (ms)');
        console.log('-'.repeat(40));
        Object.entries(this.results.responseTimePercentiles).forEach(([key, value]) => {
            console.log(`${key}: ${(value / 1000).toFixed(2)}s`);
        });
        
        console.log('\n🤖 AI PROVIDER STATISTICS');
        console.log('-'.repeat(40));
        Object.entries(this.results.aiProviderStats).forEach(([provider, stats]) => {
            console.log(`${provider}:`);
            console.log(`  Requests: ${stats.requests}`);
            console.log(`  Avg Response Time: ${(stats.averageResponseTime / 1000).toFixed(2)}s`);
            console.log(`  Total Tokens: ${stats.totalTokens}`);
        });
        
        if (Object.keys(this.results.errorsByType).length > 0) {
            console.log('\n❌ ERROR BREAKDOWN');
            console.log('-'.repeat(40));
            Object.entries(this.results.errorsByType).forEach(([errorType, count]) => {
                console.log(`${errorType}: ${count}`);
            });
        }

        // Performance criteria validation
        console.log('\n✅ PERFORMANCE CRITERIA');
        console.log('-'.repeat(40));
        console.log(`Success Rate > 90%: ${successRate >= 90 ? '✅' : '❌'}`);
        console.log(`Timeout Rate < 5%: ${timeoutRate < 5 ? '✅' : '❌'}`);
        console.log(`P95 Response Time < 30s: ${(this.results.responseTimePercentiles.p95 || 0) < 30000 ? '✅' : '❌'}`);
        console.log(`Throughput > 10 req/sec: ${this.results.throughput > 10 ? '✅' : '❌'}`);
        
        return this.results;
    }
}

async function runAILoadTest() {
    console.log('🤖 AI ROUTING SERVICE LOAD TEST');
    console.log('Testing AI routing service under load...\n');
    
    const tester = new AIRoutingLoadTester();
    
    try {
        // Authenticate first
        const authSuccess = await tester.authenticate();
        if (!authSuccess) {
            throw new Error('Authentication failed');
        }

        await tester.runConcurrentRequests();
        const results = tester.generateReport();
        
        // Write results to file
        const fs = require('fs');
        const path = require('path');
        const resultsDir = path.join(__dirname, '../results');
        
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsFile = path.join(resultsDir, `ai-routing-load-test-${timestamp}.json`);
        
        fs.writeFileSync(resultsFile, JSON.stringify({
            ...results,
            testConfig: {
                concurrentRequests: CONCURRENT_REQUESTS,
                testDuration: TEST_DURATION_SECONDS,
                aiRequestTimeout: AI_REQUEST_TIMEOUT,
                scenarios: tester.requestScenarios.map(s => s.type),
                apiUrl: API_BASE_URL
            },
            timestamp: new Date().toISOString()
        }, null, 2));
        
        console.log(`\n📄 Results saved to: ${resultsFile}`);
        
    } catch (error) {
        console.error('❌ AI load test failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runAILoadTest();
}

module.exports = { AIRoutingLoadTester };
