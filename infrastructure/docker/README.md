# Docker Infrastructure

This directory contains Docker configurations for the AI Employee Platform.

## Structure

```
infrastructure/docker/
├── nginx/                    # API Gateway configuration
│   ├── nginx.conf           # Nginx configuration
│   └── Dockerfile          # Nginx container
├── docker-compose.dev.yml  # Development environment
└── README.md               # This file
```

## Quick Start

### Development Environment

1. **Start development environment:**

   ```bash
   # From project root
   ./scripts/docker-dev.sh start
   ```

2. **Access services:**
   - Admin Dashboard: http://localhost:3000
   - Employee Portal: http://localhost:3100
   - API Gateway: http://localhost:8080
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

3. **View logs:**
   ```bash
   ./scripts/docker-dev.sh logs [service-name]
   ```

### Production Environment

1. **Deploy production:**

   ```bash
   # From project root
   ./scripts/docker-prod.sh deploy
   ```

2. **Monitor services:**
   ```bash
   ./scripts/docker-prod.sh health
   ./scripts/docker-prod.sh status
   ```

## Development Features

- **Hot Reload**: All services support hot reload for development
- **Debug Ports**: Debug ports exposed for all services (900x range)
- **Volume Mounts**: Source code mounted for live editing
- **Health Checks**: All services have health check endpoints
- **Resource Limits**: Memory limits set for optimal performance

## Production Features

- **Multi-stage Builds**: Optimized Docker images
- **Health Checks**: Comprehensive health monitoring
- **Resource Limits**: Production-appropriate resource allocation
- **Security**: Non-root users, security headers
- **Restart Policies**: Auto-restart on failure
- **Networking**: Isolated container network

## Service Ports

### Development

- Admin Dashboard: 3000
- Employee Portal: 3100
- Auth Service: 3001 (Debug: 9001)
- AI Routing Service: 3002 (Debug: 9002)
- Billing Service: 3003 (Debug: 9003)
- User Management Service: 3004 (Debug: 9004)
- Plugin Manager Service: 3005 (Debug: 9005)
- Notification Service: 3006 (Debug: 9006)
- API Gateway (Nginx): 8080
- PostgreSQL: 5432
- Redis: 6379

### Production

- Same as development but without debug ports

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Edit .env with your values
```

## Health Checks

All services include health check endpoints:

- Backend Services: `GET /health`
- Frontend Apps: `GET /` (Next.js)
- Nginx: `GET /health`
- PostgreSQL: `pg_isready`
- Redis: `redis-cli ping`

## Troubleshooting

1. **Services not starting:**

   ```bash
   ./scripts/docker-dev.sh logs
   ./scripts/docker-dev.sh health
   ```

2. **Database connection issues:**

   ```bash
   ./scripts/docker-dev.sh db-shell
   # Check database connection
   ```

3. **Clean rebuild:**

   ```bash
   ./scripts/docker-dev.sh rebuild
   ```

4. **Reset everything:**
   ```bash
   ./scripts/docker-dev.sh clean
   ./scripts/docker-dev.sh setup
   ```

## Scripts

- `./scripts/docker-dev.sh` - Development environment management
- `./scripts/docker-prod.sh` - Production environment management

Run with no arguments to see available commands.
