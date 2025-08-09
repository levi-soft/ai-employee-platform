# AI Employee Platform - API Gateway

## Overview

This directory contains the production-ready Nginx API Gateway configuration for the AI Employee Platform. The gateway provides SSL termination, load balancing, rate limiting, and request routing to all microservices.

## Features

### 🔒 Security

- **SSL/TLS Termination**: Automatic SSL certificate generation and HTTPS redirect
- **Rate Limiting**: 100 requests per minute per user (as per requirements)
- **Security Headers**: HSTS, XSS protection, content type nosniff, frame options
- **CORS Support**: Configurable cross-origin resource sharing
- **DDoS Protection**: Connection limiting and request size restrictions

### ⚡ Performance

- **Load Balancing**: Least-connection algorithm with health checks
- **Compression**: Gzip compression for text-based content
- **Keep-Alive**: Connection pooling to upstream services
- **Caching**: Strategic caching headers and proxy buffering

### 📊 Monitoring

- **Structured Logging**: JSON-formatted access logs with performance metrics
- **Health Checks**: Comprehensive health monitoring for all services
- **Metrics Endpoint**: Gateway metrics for monitoring integration
- **Error Handling**: Graceful error responses with proper HTTP status codes

### 🛠 Service Integration

- **Authentication Service**: `/api/auth/*` - JWT authentication and user management
- **AI Routing Service**: `/api/ai/*` - AI request routing with extended timeouts
- **Billing Service**: `/api/billing/*` - Credit and billing management
- **User Management**: `/api/users/*` - User profiles and management
- **Plugin Manager**: `/api/plugins/*` - Plugin lifecycle management
- **Notification Service**: `/api/notifications/*` - Real-time notifications with WebSocket support
- **Admin Dashboard**: `/admin/*` - Administrative interface
- **Employee Portal**: `/portal/*` - Employee self-service interface

## Quick Start

### 1. Setup

```bash
# Run the gateway setup script
./scripts/gateway-setup.sh setup

# Or setup with force (auto-adds to hosts file)
./scripts/gateway-setup.sh setup --force
```

### 2. Start Services

```bash
# Start the API Gateway
./scripts/gateway-setup.sh start

# Or use Docker Compose directly
docker-compose up -d api-gateway
```

### 3. Test

```bash
# Run connectivity tests
./scripts/gateway-setup.sh test

# Check status
./scripts/gateway-setup.sh status
```

## Configuration Files

### nginx.conf

Main Nginx configuration with:

- Production-optimized settings
- SSL configuration
- Rate limiting rules
- Service upstream definitions
- Route configurations

### Dockerfile

Multi-stage Docker build with:

- SSL certificate generation
- Security hardening
- Health check configuration
- Runtime optimizations

### Scripts

- `generate-ssl.sh`: SSL certificate generation
- `docker-entrypoint.sh`: Container initialization
- `../scripts/gateway-setup.sh`: Management script

## SSL Certificates

The gateway automatically generates self-signed SSL certificates for development:

- **Domain**: `ai-employee-platform.local`
- **SAN**: `localhost`, `*.ai-employee-platform.local`
- **Validity**: 365 days

### Production SSL

For production environments:

1. Replace self-signed certificates with CA-signed certificates
2. Update certificate paths in nginx.conf
3. Configure automatic renewal (Let's Encrypt recommended)

## Rate Limiting

Default rate limits (per IP address):

- **General API**: 100 requests/minute
- **Authentication**: 50 requests/minute
- **AI Services**: 20 requests/minute
- **Strict Services**: 10 requests/minute

### Customization

Edit rate limit zones in nginx.conf:

```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=100r/m;
```

## Monitoring & Logs

### Log Files

- **Access Log**: `/var/log/nginx/gateway_access.log`
- **Error Log**: `/var/log/nginx/gateway_error.log`

### Log Format

Structured JSON logs include:

- Request timing and performance metrics
- Upstream service information
- Client information
- Response codes and sizes

### Health Checks

- **Gateway Health**: `https://localhost/health`
- **Service Health**: Individual service health checks
- **Metrics**: `https://localhost/metrics` (internal only)

## Development

### Local Development

1. Add to `/etc/hosts`: `127.0.0.1 ai-employee-platform.local`
2. Use `docker-compose.override.yml` for development settings
3. Access via: `https://ai-employee-platform.local`

### Configuration Changes

1. Edit `nginx.conf`
2. Test configuration: `./scripts/gateway-setup.sh test`
3. Restart gateway: `./scripts/gateway-setup.sh restart`

## Troubleshooting

### Common Issues

**SSL Certificate Errors**:

```bash
# Regenerate certificates
./scripts/gateway-setup.sh ssl-setup --force
```

**Service Connectivity**:

```bash
# Check service status
./scripts/gateway-setup.sh status

# View logs
./scripts/gateway-setup.sh logs --follow
```

**Rate Limiting**:

```bash
# Check if rate limiting is working
curl -v https://localhost/health
# Should return 429 after multiple rapid requests
```

### Port Conflicts

Default ports used:

- `80`: HTTP (redirects to HTTPS)
- `443`: HTTPS with SSL
- `8080`: HTTP alternative

Change ports in `docker-compose.yml` if conflicts occur.

## Security Considerations

### Production Deployment

1. **Replace default certificates** with CA-signed certificates
2. **Update secrets**: Change default JWT secrets and passwords
3. **Network security**: Use proper firewall rules
4. **Monitoring**: Implement log monitoring and alerting
5. **Updates**: Keep Nginx and dependencies updated

### Security Headers

All responses include:

- `Strict-Transport-Security`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection`
- `Content-Security-Policy`
- `Referrer-Policy`

## Performance Tuning

### For High Traffic

1. Increase worker connections in nginx.conf
2. Adjust rate limiting based on requirements
3. Configure upstream connection pooling
4. Implement caching strategies
5. Monitor and scale backend services

### Resource Limits

Default Docker limits:

- Memory: 512MB limit, 256MB reservation
- CPU: No specific limits (uses available resources)

Adjust in `docker-compose.yml` based on requirements.
