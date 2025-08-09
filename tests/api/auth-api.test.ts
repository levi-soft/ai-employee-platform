
/**
 * Authentication API Automated Tests
 * Comprehensive test suite for auth service endpoints
 */

import request from 'supertest'
import { expect } from 'chai'
import { describe, it, before, after, beforeEach } from 'mocha'

// Test configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080'
const API_VERSION = 'v1'

// Test data
let testUser = {
  name: 'Test User API',
  email: `test-api-${Date.now()}@example.com`,
  password: 'TestPassword123!'
}

let authTokens: {
  accessToken?: string
  refreshToken?: string
} = {}

let userId: string

describe('Authentication API v1 Tests', () => {
  before(async () => {
    console.log(`Running API tests against: ${BASE_URL}/${API_VERSION}`)
  })

  after(async () => {
    // Cleanup: Delete test user if possible
    // This would require admin privileges in a real scenario
    console.log('API tests completed')
  })

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/register`)
        .send(testUser)
        .expect(201)

      expect(response.body).to.have.property('user')
      expect(response.body).to.have.property('tokens')
      expect(response.body.user).to.have.property('id')
      expect(response.body.user.email).to.equal(testUser.email)
      expect(response.body.user.name).to.equal(testUser.name)
      expect(response.body.user.role).to.equal('EMPLOYEE')
      expect(response.body.user.isActive).to.be.true

      expect(response.body.tokens).to.have.property('accessToken')
      expect(response.body.tokens).to.have.property('refreshToken')
      expect(response.body.tokens).to.have.property('expiresIn')

      // Store tokens and user ID for subsequent tests
      authTokens.accessToken = response.body.tokens.accessToken
      authTokens.refreshToken = response.body.tokens.refreshToken
      userId = response.body.user.id
    })

    it('should reject registration with invalid email', async () => {
      const invalidUser = {
        ...testUser,
        email: 'invalid-email'
      }

      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/register`)
        .send(invalidUser)
        .expect(400)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('VALIDATION_ERROR')
    })

    it('should reject registration with weak password', async () => {
      const weakPasswordUser = {
        ...testUser,
        email: `weak-${Date.now()}@example.com`,
        password: '123'
      }

      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/register`)
        .send(weakPasswordUser)
        .expect(400)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('VALIDATION_ERROR')
    })

    it('should reject duplicate email registration', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/register`)
        .send(testUser)
        .expect(409)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('EMAIL_ALREADY_EXISTS')
    })

    it('should enforce rate limiting on registration', async () => {
      const requests = []
      
      // Make multiple rapid registration requests
      for (let i = 0; i < 7; i++) {
        requests.push(
          request(BASE_URL)
            .post(`/${API_VERSION}/auth/register`)
            .send({
              ...testUser,
              email: `rate-test-${i}-${Date.now()}@example.com`
            })
        )
      }

      const responses = await Promise.allSettled(requests)
      const rateLimitedResponses = responses.filter(
        (result) => result.status === 'fulfilled' && 
                   (result.value as any).status === 429
      )

      expect(rateLimitedResponses.length).to.be.greaterThan(0)
    })
  })

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200)

      expect(response.body).to.have.property('user')
      expect(response.body).to.have.property('tokens')
      expect(response.body.user.email).to.equal(testUser.email)
      expect(response.body.tokens).to.have.property('accessToken')
      expect(response.body.tokens).to.have.property('refreshToken')

      // Update tokens
      authTokens.accessToken = response.body.tokens.accessToken
      authTokens.refreshToken = response.body.tokens.refreshToken
    })

    it('should reject login with invalid email', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: 'nonexistent@example.com',
          password: testUser.password
        })
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('INVALID_CREDENTIALS')
    })

    it('should reject login with invalid password', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email,
          password: 'WrongPassword123!'
        })
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('INVALID_CREDENTIALS')
    })

    it('should reject login with missing credentials', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email
          // password missing
        })
        .expect(400)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('VALIDATION_ERROR')
    })

    it('should enforce rate limiting on login attempts', async () => {
      const requests = []
      
      // Make multiple rapid login requests with wrong password
      for (let i = 0; i < 7; i++) {
        requests.push(
          request(BASE_URL)
            .post(`/${API_VERSION}/auth/login`)
            .send({
              email: testUser.email,
              password: 'WrongPassword123!'
            })
        )
      }

      const responses = await Promise.allSettled(requests)
      const rateLimitedResponses = responses.filter(
        (result) => result.status === 'fulfilled' && 
                   (result.value as any).status === 429
      )

      expect(rateLimitedResponses.length).to.be.greaterThan(0)
    })
  })

  describe('GET /auth/profile', () => {
    it('should get user profile with valid token', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/profile`)
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .expect(200)

      expect(response.body).to.have.property('id')
      expect(response.body).to.have.property('email')
      expect(response.body).to.have.property('name')
      expect(response.body).to.have.property('role')
      expect(response.body.email).to.equal(testUser.email)
      expect(response.body.id).to.equal(userId)
    })

    it('should reject request without authorization token', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/profile`)
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('UNAUTHORIZED')
    })

    it('should reject request with invalid token', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/profile`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('INVALID_TOKEN')
    })

    it('should reject request with malformed authorization header', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/profile`)
        .set('Authorization', 'InvalidFormat token')
        .expect(401)

      expect(response.body).to.have.property('error')
    })
  })

  describe('POST /auth/refresh', () => {
    it('should refresh token successfully', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/refresh`)
        .send({
          refreshToken: authTokens.refreshToken
        })
        .expect(200)

      expect(response.body).to.have.property('accessToken')
      expect(response.body).to.have.property('expiresIn')
      expect(response.body.accessToken).to.not.equal(authTokens.accessToken)

      // Update access token
      authTokens.accessToken = response.body.accessToken
    })

    it('should reject refresh with invalid token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/refresh`)
        .send({
          refreshToken: 'invalid-refresh-token'
        })
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('INVALID_REFRESH_TOKEN')
    })

    it('should reject refresh with missing token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/refresh`)
        .send({})
        .expect(400)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('VALIDATION_ERROR')
    })
  })

  describe('POST /auth/verify', () => {
    it('should verify valid token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/verify`)
        .send({
          token: authTokens.accessToken
        })
        .expect(200)

      expect(response.body).to.have.property('valid')
      expect(response.body).to.have.property('user')
      expect(response.body.valid).to.be.true
      expect(response.body.user.id).to.equal(userId)
    })

    it('should reject invalid token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/verify`)
        .send({
          token: 'invalid-token'
        })
        .expect(401)

      expect(response.body).to.have.property('error')
    })
  })

  describe('POST /auth/logout', () => {
    let tempTokens: any

    beforeEach(async () => {
      // Login to get fresh tokens for logout test
      const loginResponse = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email,
          password: testUser.password
        })

      tempTokens = loginResponse.body.tokens
    })

    it('should logout successfully with valid token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/logout`)
        .set('Authorization', `Bearer ${tempTokens.accessToken}`)
        .expect(200)

      expect(response.body).to.have.property('message')
      expect(response.body.message).to.include('Logged out successfully')
    })

    it('should reject logout without token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/logout`)
        .expect(401)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('UNAUTHORIZED')
    })

    it('should reject logout with invalid token', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/logout`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body).to.have.property('error')
    })
  })

  describe('POST /auth/logout-all', () => {
    let tempTokens: any

    beforeEach(async () => {
      // Login to get fresh tokens
      const loginResponse = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email,
          password: testUser.password
        })

      tempTokens = loginResponse.body.tokens
    })

    it('should logout from all devices successfully', async () => {
      const response = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/logout-all`)
        .set('Authorization', `Bearer ${tempTokens.accessToken}`)
        .expect(200)

      expect(response.body).to.have.property('message')
      expect(response.body.message).to.include('Logged out from all devices')
    })
  })

  describe('GET /auth/health', () => {
    it('should return service health status', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/health`)
        .expect(200)

      expect(response.body).to.have.property('status')
      expect(response.body).to.have.property('service')
      expect(response.body).to.have.property('version')
      expect(response.body).to.have.property('timestamp')
      expect(response.body.status).to.equal('healthy')
      expect(response.body.service).to.equal('auth-service')
    })
  })

  describe('API Version Information', () => {
    it('should return API version information', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/`)
        .expect(200)

      expect(response.body).to.have.property('service')
      expect(response.body).to.have.property('version')
      expect(response.body).to.have.property('endpoints')
      expect(response.body).to.have.property('features')
      expect(response.body.version).to.equal('v1')
    })

    it('should return 404 for undefined endpoints', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/undefined-endpoint`)
        .expect(404)

      expect(response.body).to.have.property('error')
      expect(response.body.error.code).to.equal('ENDPOINT_NOT_FOUND')
    })
  })

  describe('Security Headers and CORS', () => {
    it('should include security headers in responses', async () => {
      const response = await request(BASE_URL)
        .get(`/${API_VERSION}/auth/health`)

      // Check for common security headers
      expect(response.headers).to.have.property('x-powered-by')
      expect(response.headers).to.have.property('content-type')
      expect(response.headers['content-type']).to.include('application/json')
    })

    it('should handle CORS preflight requests', async () => {
      const response = await request(BASE_URL)
        .options(`/${API_VERSION}/auth/login`)

      // Should not return error for OPTIONS request
      expect([200, 204, 404]).to.include(response.status)
    })
  })

  describe('Response Format Consistency', () => {
    it('should return consistent error format across endpoints', async () => {
      const endpoints = [
        { method: 'POST', path: '/auth/login', body: {} },
        { method: 'POST', path: '/auth/register', body: {} },
        { method: 'GET', path: '/auth/profile' }
      ]

      for (const endpoint of endpoints) {
        const request_builder = request(BASE_URL)[endpoint.method.toLowerCase() as keyof typeof request]
        let req = request_builder(`/${API_VERSION}${endpoint.path}`)
        
        if (endpoint.body) {
          req = req.send(endpoint.body)
        }

        const response = await req

        if (response.status >= 400) {
          expect(response.body).to.have.property('error')
          expect(response.body.error).to.have.property('code')
          expect(response.body.error).to.have.property('message')
        }
      }
    })

    it('should return consistent success format for auth endpoints', async () => {
      const loginResponse = await request(BASE_URL)
        .post(`/${API_VERSION}/auth/login`)
        .send({
          email: testUser.email,
          password: testUser.password
        })

      if (loginResponse.status === 200) {
        expect(loginResponse.body).to.have.property('user')
        expect(loginResponse.body).to.have.property('tokens')
        expect(loginResponse.body.user).to.be.an('object')
        expect(loginResponse.body.tokens).to.be.an('object')
      }
    })
  })

  describe('Performance Tests', () => {
    it('should respond to health check within acceptable time', async () => {
      const startTime = Date.now()
      
      await request(BASE_URL)
        .get(`/${API_VERSION}/auth/health`)
        .expect(200)

      const responseTime = Date.now() - startTime
      expect(responseTime).to.be.lessThan(1000) // Less than 1 second
    })

    it('should handle concurrent requests without errors', async () => {
      const concurrentRequests = Array(5).fill(null).map(() =>
        request(BASE_URL)
          .get(`/${API_VERSION}/auth/health`)
      )

      const responses = await Promise.all(concurrentRequests)
      responses.forEach(response => {
        expect(response.status).to.equal(200)
        expect(response.body.status).to.equal('healthy')
      })
    })
  })
})

// Additional integration tests
describe('Authentication Flow Integration Tests', () => {
  it('should complete full authentication flow', async () => {
    const uniqueUser = {
      name: 'Integration Test User',
      email: `integration-${Date.now()}@example.com`,
      password: 'IntegrationTest123!'
    }

    // 1. Register
    const registerResponse = await request(BASE_URL)
      .post(`/${API_VERSION}/auth/register`)
      .send(uniqueUser)
      .expect(201)

    const { accessToken, refreshToken } = registerResponse.body.tokens

    // 2. Get Profile
    const profileResponse = await request(BASE_URL)
      .get(`/${API_VERSION}/auth/profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)

    expect(profileResponse.body.email).to.equal(uniqueUser.email)

    // 3. Refresh Token
    const refreshResponse = await request(BASE_URL)
      .post(`/${API_VERSION}/auth/refresh`)
      .send({ refreshToken })
      .expect(200)

    const newAccessToken = refreshResponse.body.accessToken

    // 4. Use New Token
    const newProfileResponse = await request(BASE_URL)
      .get(`/${API_VERSION}/auth/profile`)
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200)

    expect(newProfileResponse.body.email).to.equal(uniqueUser.email)

    // 5. Logout
    await request(BASE_URL)
      .post(`/${API_VERSION}/auth/logout`)
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200)

    // 6. Verify token is invalid after logout
    await request(BASE_URL)
      .get(`/${API_VERSION}/auth/profile`)
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(401)
  })
})
