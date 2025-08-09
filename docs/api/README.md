
# AI Employee Platform API Documentation

Complete API documentation for the AI Employee Platform microservices architecture.

## 📚 Documentation Structure

```
docs/api/
├── openapi.yaml                    # Complete OpenAPI 3.0 specification
├── postman/                        # Postman collections and environments
│   ├── AI_Employee_Platform.postman_collection.json
│   └── AI_Employee_Platform_Environment.postman_environment.json
├── examples/                       # API response examples
│   ├── auth-responses.json
│   ├── ai-routing-responses.json
│   └── billing-responses.json
└── README.md                       # This documentation
```

## 🚀 Quick Start

### 1. Using OpenAPI Specification

The complete API specification is available in `openapi.yaml`. You can:

- **View in Swagger UI**: Import the file into [Swagger Editor](https://editor.swagger.io/)
- **Generate client SDKs**: Use tools like `swagger-codegen` or `openapi-generator`
- **Validate requests**: Use the spec for request/response validation

```bash
# Serve API docs locally
npx swagger-ui-serve docs/api/openapi.yaml
```

### 2. Using Postman Collections

Import the Postman collection and environment:

1. Open Postman
2. Import `AI_Employee_Platform.postman_collection.json`
3. Import `AI_Employee_Platform_Environment.postman_environment.json`
4. Set the `baseUrl` variable to your API endpoint
5. Run the "Login User" request to authenticate
6. Explore other endpoints with automatic token management

### 3. API Base URLs

| Environment | Base URL | Description |
|-------------|----------|-------------|
| Local | `http://localhost:8080/v1` | Development server |
| Staging | `https://staging-api.ai-employee-platform.com/v1` | Staging environment |
| Production | `https://api.ai-employee-platform.com/v1` | Production environment |

## 🔐 Authentication

The API uses JWT-based authentication. Include the access token in the Authorization header:

```http
Authorization: Bearer <your-access-token>
```

### Getting Access Tokens

1. **Register a new user**:
   ```http
   POST /auth/register
   Content-Type: application/json
   
   {
     "name": "John Doe",
     "email": "john.doe@example.com", 
     "password": "SecurePassword123!"
   }
   ```

2. **Login with existing credentials**:
   ```http
   POST /auth/login
   Content-Type: application/json
   
   {
     "email": "john.doe@example.com",
     "password": "SecurePassword123!"
   }
   ```

3. **Refresh expired tokens**:
   ```http
   POST /auth/refresh
   Content-Type: application/json
   
   {
     "refreshToken": "<your-refresh-token>"
   }
   ```

## 📋 API Endpoints Overview

### Authentication & Users
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login
- `POST /auth/logout` - Logout user
- `POST /auth/refresh` - Refresh access token
- `GET /auth/profile` - Get user profile
- `GET /users` - List users (Admin)
- `POST /users` - Create user (Admin)
- `PUT /users/:id` - Update user

### AI Routing
- `POST /ai/route` - Route AI request to optimal agent
- `GET /ai/agents` - List available AI agents
- `GET /ai/requests` - Get user's AI request history
- `GET /ai/capabilities` - Get available capabilities

### Billing & Credits
- `GET /billing/credits` - Get credit balance
- `POST /billing/credits` - Add credits (payment)
- `GET /billing/transactions` - Transaction history
- `GET /billing/analytics` - Usage analytics

### Plugin Management
- `GET /plugins` - Browse plugin marketplace
- `GET /plugins/:id` - Get plugin details
- `POST /plugins/:id/install` - Install plugin
- `DELETE /plugins/:id/uninstall` - Uninstall plugin

### Notifications
- `GET /notifications/preferences` - Get notification preferences
- `PUT /notifications/preferences` - Update preferences  
- `GET /notifications/history` - Notification history

## 🔄 API Versioning

The API uses URL path versioning:

- **Current Version**: `v1`
- **URL Format**: `https://api.example.com/v1/endpoint`
- **Version Header**: `API-Version: v1` (optional)

### Version Compatibility

| Version | Status | Support Level | End of Life |
|---------|--------|---------------|-------------|
| v1 | Current | Full Support | TBD |
| v2 | Planned | - | - |

### Deprecation Policy

- **6 months** advance notice for breaking changes
- **12 months** support for deprecated versions
- Clear migration guides provided

## 📊 Rate Limiting

Rate limits are applied per IP address and authenticated user:

| Endpoint Type | Rate Limit | Window |
|---------------|------------|--------|
| Authentication | 50 requests | 15 minutes |
| General API | 100 requests | 15 minutes |
| AI Routing | 20 requests | 1 minute |
| File Upload | 10 requests | 5 minutes |

### Rate Limit Headers

All responses include rate limiting headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95  
X-RateLimit-Reset: 1642694400
X-RateLimit-Window: 900
```

### Handling Rate Limits

When rate limited (HTTP 429), responses include:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "details": {
      "retryAfter": 300,
      "limit": 100,
      "window": 900
    }
  }
}
```

## 📝 Request/Response Format

### Request Format

- **Content-Type**: `application/json`
- **Accept**: `application/json`
- **Character Encoding**: UTF-8
- **Maximum Request Size**: 10MB (file uploads: 100MB)

### Response Format

All API responses follow a consistent structure:

#### Success Response
```json
{
  "data": { /* Response data */ },
  "meta": {
    "timestamp": "2025-01-15T10:30:00Z",
    "requestId": "req-123e4567-e89b-12d3"
  }
}
```

#### Error Response
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      /* Additional error context */
    }
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00Z",
    "requestId": "req-123e4567-e89b-12d3"
  }
}
```

### Common HTTP Status Codes

| Code | Description | Usage |
|------|-------------|-------|
| 200 | OK | Successful GET, PUT |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid request data |
| 401 | Unauthorized | Authentication required |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 422 | Unprocessable Entity | Validation error |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 502 | Bad Gateway | Upstream service error |
| 503 | Service Unavailable | Service maintenance |

## 🔍 Error Codes Reference

### Authentication Errors
- `INVALID_CREDENTIALS` - Wrong email/password
- `TOKEN_EXPIRED` - Access token expired
- `INVALID_TOKEN` - Malformed or invalid token
- `UNAUTHORIZED` - Authentication required
- `INSUFFICIENT_PERMISSIONS` - Access denied

### Validation Errors
- `VALIDATION_ERROR` - Request validation failed
- `MISSING_REQUIRED_FIELD` - Required field missing
- `INVALID_FORMAT` - Invalid field format
- `VALUE_OUT_OF_RANGE` - Value exceeds limits

### Business Logic Errors
- `INSUFFICIENT_CREDITS` - Not enough credits
- `AGENT_UNAVAILABLE` - AI agent offline
- `QUOTA_EXCEEDED` - Usage quota exceeded
- `PLUGIN_ALREADY_INSTALLED` - Plugin already installed

### System Errors
- `INTERNAL_ERROR` - Server error
- `SERVICE_UNAVAILABLE` - Service offline
- `DATABASE_ERROR` - Database connection failed
- `EXTERNAL_SERVICE_ERROR` - Third-party service error

## 🧪 Testing the API

### Manual Testing with curl

```bash
# Health check
curl -X GET "http://localhost:8080/v1/auth/health"

# Register user  
curl -X POST "http://localhost:8080/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "SecurePassword123!"
  }'

# Login and get token
curl -X POST "http://localhost:8080/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com", 
    "password": "SecurePassword123!"
  }'

# Use token to access protected endpoint
curl -X GET "http://localhost:8080/v1/auth/profile" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Automated Testing

The platform includes comprehensive automated API tests:

```bash
# Run all API tests
./scripts/api-test-automation.sh full

# Run specific test suite
./scripts/api-test-automation.sh auth

# Run in development watch mode
./scripts/api-test-automation.sh watch
```

## 📈 Performance Guidelines

### Request Optimization
- Use pagination for large datasets (`?page=1&limit=20`)
- Request only needed fields where supported
- Cache responses when appropriate
- Use conditional requests with `If-Modified-Since`

### Response Times (SLA)
- **Authentication endpoints**: < 500ms
- **Simple queries**: < 1000ms  
- **AI requests**: < 30000ms
- **File uploads**: < 60000ms
- **Bulk operations**: < 120000ms

### Best Practices
1. **Implement exponential backoff** for retries
2. **Handle rate limits gracefully** with proper delays
3. **Use compression** (`Accept-Encoding: gzip`)
4. **Validate inputs** before sending requests
5. **Monitor API usage** and performance

## 🚨 Security Considerations

### Authentication Security
- **Never log or store** access tokens
- **Use HTTPS** in production
- **Implement token refresh** before expiration
- **Logout** to invalidate sessions

### Input Validation
- **Validate all inputs** on client side
- **Sanitize data** before display
- **Use parameterized queries** (handled server-side)
- **Implement CSRF protection** for web apps

### Data Protection
- **Encrypt sensitive data** in transit and at rest
- **Follow GDPR/privacy** requirements
- **Implement audit logging** for sensitive operations
- **Use proper access controls** based on user roles

## 🆘 Support & Troubleshooting

### Common Issues

**Authentication Issues**:
1. Check token expiration and refresh if needed
2. Verify Authorization header format: `Bearer <token>`
3. Ensure user has required permissions

**API Errors**:
1. Check request format and required fields
2. Verify endpoint URL and HTTP method
3. Review rate limiting headers

**Performance Issues**:
1. Check for proper pagination usage
2. Monitor network connectivity
3. Review request payload size

### Getting Help

- **Documentation**: [docs.ai-employee-platform.com](https://docs.ai-employee-platform.com)
- **API Status**: [status.ai-employee-platform.com](https://status.ai-employee-platform.com)
- **Support Email**: support@ai-employee-platform.com
- **GitHub Issues**: [github.com/ai-employee-platform/api-issues](https://github.com/ai-employee-platform/api-issues)

### Report Issues

When reporting API issues, please include:

1. **Request details** (method, URL, headers, body)
2. **Response details** (status code, headers, body)
3. **Timestamp** of the issue
4. **User ID** or session information (if applicable)
5. **Steps to reproduce** the issue

## 🔄 Changelog & Updates

| Version | Date | Changes |
|---------|------|---------|
| v1.0.0 | 2025-01-15 | Initial API release |

### Staying Updated

- **API Updates**: Follow [@AIEmployeePlatform](https://twitter.com/aiemployeeplatform) on Twitter
- **Breaking Changes**: Subscribe to our developer newsletter
- **Deprecation Notices**: Monitor API response headers for deprecation warnings

---

## 📄 License

This API documentation is licensed under [MIT License](https://opensource.org/licenses/MIT).

For questions about API usage or licensing, contact: legal@ai-employee-platform.com
