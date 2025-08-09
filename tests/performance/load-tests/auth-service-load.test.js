
const axios = require('axios');
const { performance } = require('perf_hooks');

/**
 * Authentication Service Load Test
 * Tests concurrent user authentication under load
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
const TARGET_CONCURRENT_USERS = 1000;
const TEST_DURATION_SECONDS = 300; // 5 minutes
const RAMP_UP_SECONDS = 60;

class AuthLoadTester {
    constructor() {
        this.results = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            responseTimePercentiles: {},
            throughput: 0,
            errorsByType: {},
            startTime: 0,
            endTime: 0
        };
        
        this.responseTimes = [];
        this.activeUsers = 0;
        this.testUsers = [];
        
        // Generate test users
        for (let i = 0; i < TARGET_CONCURRENT_USERS; i++) {
            this.testUsers.push({
                email: `loadtest${i}@example.com`,
                password: `LoadTest123!${i}`,
                firstName: `LoadUser${i}`,
                lastName: `Test${i}`
            });
        }
    }

    async registerTestUser(user) {
        try {
            const startTime = performance.now();
            const response = await axios.post(`${API_BASE_URL}/api/auth/register`, user);
            const endTime = performance.now();
            
            this.recordResponse(endTime - startTime, response.status === 201);
            return { success: true, token: response.data.accessToken };
        } catch (error) {
            this.recordResponse(0, false, error.response?.status || 'NETWORK_ERROR');
            return { success: false, error: error.message };
        }
    }

    async loginTestUser(user) {
        try {
            const startTime = performance.now();
            const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
                email: user.email,
                password: user.password
            });
            const endTime = performance.now();
            
            this.recordResponse(endTime - startTime, response.status === 200);
            return { success: true, token: response.data.accessToken };
        } catch (error) {
            this.recordResponse(0, false, error.response?.status || 'NETWORK_ERROR');
            return { success: false, error: error.message };
        }
    }

    async performAuthFlow(user) {
        const registerResult = await this.registerTestUser(user);
        if (!registerResult.success) {
            return { success: false, stage: 'registration', error: registerResult.error };
        }

        await this.delay(100); // Small delay between register and login

        const loginResult = await this.loginTestUser(user);
        if (!loginResult.success) {
            return { success: false, stage: 'login', error: loginResult.error };
        }

        return { success: true };
    }

    recordResponse(responseTime, success, errorType = null) {
        this.results.totalRequests++;
        
        if (success) {
            this.results.successfulRequests++;
            this.responseTimes.push(responseTime);
        } else {
            this.results.failedRequests++;
            if (errorType) {
                this.results.errorsByType[errorType] = (this.results.errorsByType[errorType] || 0) + 1;
            }
        }
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

    async runConcurrentUsers() {
        console.log(`🚀 Starting load test with ${TARGET_CONCURRENT_USERS} concurrent users...`);
        
        this.results.startTime = performance.now();
        const promises = [];
        
        // Ramp up users gradually
        const usersPerSecond = TARGET_CONCURRENT_USERS / RAMP_UP_SECONDS;
        
        for (let i = 0; i < TARGET_CONCURRENT_USERS; i++) {
            const delay = (i / usersPerSecond) * 1000; // Spread users over ramp-up period
            
            promises.push(
                new Promise(resolve => {
                    setTimeout(async () => {
                        this.activeUsers++;
                        const user = this.testUsers[i];
                        
                        try {
                            const result = await this.performAuthFlow(user);
                            resolve(result);
                        } catch (error) {
                            resolve({ success: false, error: error.message });
                        } finally {
                            this.activeUsers--;
                        }
                    }, delay);
                })
            );
        }
        
        // Wait for all users to complete
        const results = await Promise.all(promises);
        this.results.endTime = performance.now();
        
        const totalDuration = (this.results.endTime - this.results.startTime) / 1000; // seconds
        this.results.throughput = this.results.totalRequests / totalDuration;
        
        return results;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    generateReport() {
        this.calculatePercentiles();
        
        const totalDuration = (this.results.endTime - this.results.startTime) / 1000;
        const successRate = (this.results.successfulRequests / this.results.totalRequests * 100).toFixed(2);
        
        console.log('\n🎯 LOAD TEST RESULTS');
        console.log('='.repeat(50));
        console.log(`📊 Total Requests: ${this.results.totalRequests}`);
        console.log(`✅ Successful: ${this.results.successfulRequests}`);
        console.log(`❌ Failed: ${this.results.failedRequests}`);
        console.log(`📈 Success Rate: ${successRate}%`);
        console.log(`⚡ Throughput: ${this.results.throughput.toFixed(2)} req/sec`);
        console.log(`⏱️  Total Duration: ${totalDuration.toFixed(2)} seconds`);
        console.log('\n📊 RESPONSE TIME PERCENTILES (ms)');
        console.log('-'.repeat(30));
        Object.entries(this.results.responseTimePercentiles).forEach(([key, value]) => {
            console.log(`${key}: ${value.toFixed(2)}ms`);
        });
        
        if (Object.keys(this.results.errorsByType).length > 0) {
            console.log('\n❌ ERROR BREAKDOWN');
            console.log('-'.repeat(30));
            Object.entries(this.results.errorsByType).forEach(([errorType, count]) => {
                console.log(`${errorType}: ${count}`);
            });
        }

        // Performance criteria validation
        console.log('\n✅ PERFORMANCE CRITERIA');
        console.log('-'.repeat(30));
        console.log(`Target Concurrent Users: ${TARGET_CONCURRENT_USERS} ${this.results.totalRequests >= TARGET_CONCURRENT_USERS ? '✅' : '❌'}`);
        console.log(`Success Rate > 95%: ${successRate >= 95 ? '✅' : '❌'}`);
        console.log(`P95 Response Time < 2s: ${(this.results.responseTimePercentiles.p95 || 0) < 2000 ? '✅' : '❌'}`);
        console.log(`Throughput > 100 req/sec: ${this.results.throughput > 100 ? '✅' : '❌'}`);
        
        return this.results;
    }
}

// Run the load test
async function runLoadTest() {
    console.log('🔥 AUTH SERVICE LOAD TEST');
    console.log('Testing authentication service under load...\n');
    
    const tester = new AuthLoadTester();
    
    try {
        await tester.runConcurrentUsers();
        const results = tester.generateReport();
        
        // Write results to file
        const fs = require('fs');
        const path = require('path');
        const resultsDir = path.join(__dirname, '../results');
        
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsFile = path.join(resultsDir, `auth-load-test-${timestamp}.json`);
        
        fs.writeFileSync(resultsFile, JSON.stringify({
            ...results,
            testConfig: {
                targetUsers: TARGET_CONCURRENT_USERS,
                testDuration: TEST_DURATION_SECONDS,
                rampUpTime: RAMP_UP_SECONDS,
                apiUrl: API_BASE_URL
            },
            timestamp: new Date().toISOString()
        }, null, 2));
        
        console.log(`\n📄 Results saved to: ${resultsFile}`);
        
    } catch (error) {
        console.error('❌ Load test failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runLoadTest();
}

module.exports = { AuthLoadTester };
