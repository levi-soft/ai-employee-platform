# AI Employee Platform - Development Guide

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 18.x or higher
- **Yarn**: 4.x (Yarn Berry)
- **Docker**: 24.x or higher
- **PostgreSQL**: 15.x
- **Redis**: 7.x

### Initial Setup

1. **Clone the Repository**

```bash
git clone <repository-url>
cd ai-employee-platform
```

2. **Install Dependencies**

```bash
yarn install
```

3. **Environment Configuration**

```bash
# Copy and configure environment files
cp .env.example .env
./scripts/env-setup.sh
```

4. **Start Development Services**

```bash
# Start database and Redis
docker-compose up -d postgres redis

# Run database migrations
cd database && yarn prisma migrate dev
```

5. **Start Development Servers**

```bash
# Start all services in development mode
./scripts/docker-dev.sh start

# Or start individual services
cd services/auth-service && yarn dev
cd apps/admin-dashboard && yarn dev
```

## 🏗️ Development Workflow

### Monorepo Structure

```
ai-employee-platform/
├── apps/                    # Frontend applications
│   ├── admin-dashboard/     # Next.js admin interface
│   ├── employee-portal/     # Next.js employee interface
│   └── mobile-app/          # React Native app
├── services/                # Backend microservices
│   ├── auth-service/        # Authentication & authorization
│   ├── ai-routing-service/  # AI agent routing
│   ├── billing-service/     # Billing & transactions
│   ├── user-management-service/
│   ├── plugin-manager-service/
│   └── notification-service/
├── packages/                # Shared packages
│   ├── shared-types/        # TypeScript definitions
│   ├── shared-utils/        # Common utilities
│   ├── ui-components/       # React components
│   └── api-client/          # HTTP client
├── infrastructure/          # Infrastructure configs
├── database/               # Database schema & migrations
├── tests/                  # Test utilities & fixtures
└── docs/                   # Documentation
```

### Development Commands

#### Root Level Commands:

```bash
# Development
yarn dev              # Start all services in development
yarn build            # Build all packages and services
yarn test             # Run all tests
yarn test:coverage    # Run tests with coverage
yarn lint             # Lint all code
yarn format           # Format all code

# Package management
yarn add <package>    # Add dependency to root
yarn workspace <workspace> add <package>  # Add to specific workspace
```

#### Service-Specific Commands:

```bash
cd services/auth-service

yarn dev              # Start service with hot reload
yarn build            # Build service for production
yarn test             # Run service tests
yarn test:watch       # Run tests in watch mode
yarn lint             # Lint service code
```

#### Frontend App Commands:

```bash
cd apps/admin-dashboard

yarn dev              # Start Next.js development server
yarn build            # Build for production
yarn start            # Start production server
yarn test             # Run component tests
yarn storybook        # Start Storybook (if configured)
```

### Development Best Practices

#### Code Organization:

```typescript
// Service structure example
services/auth-service/src/
├── controllers/      # Request handlers
├── services/        # Business logic
├── models/          # Data access layer
├── middleware/      # Express middleware
├── routes/          # Route definitions
├── types/           # Service-specific types
├── utils/           # Service utilities
├── config/          # Configuration
└── index.ts         # Entry point
```

#### Import Conventions:

```typescript
// Use workspace aliases for shared packages
import { User, Role } from '@ai-platform/shared-types'
import { logger, validateEmail } from '@ai-platform/shared-utils'
import { Button, Card } from '@ai-platform/ui-components'
import { authApi } from '@ai-platform/api-client'

// Use relative imports within the same service
import { AuthController } from './controllers/auth.controller'
import { JWTService } from '../services/jwt.service'
```

## 🧪 Testing Guide

### Testing Stack:

- **Unit Tests**: Jest + TypeScript
- **Integration Tests**: Jest + Supertest
- **Frontend Tests**: React Testing Library + Jest
- **E2E Tests**: Playwright (planned)

### Running Tests:

```bash
# All tests
yarn test

# Watch mode
yarn test:watch

# Coverage report
yarn test:coverage

# Specific service tests
yarn test:auth

# Integration tests only
yarn test:integration
```

### Test File Conventions:

```
src/
├── services/
│   ├── jwt.service.ts
│   └── jwt.service.test.ts      # Unit test
├── controllers/
│   ├── auth.controller.ts
│   └── auth.controller.test.ts  # Integration test
└── tests/
    ├── fixtures/                # Test data
    ├── integration/             # Integration tests
    └── utils/                   # Test utilities
```

### Writing Tests:

#### Unit Test Example:

```typescript
import { JWTService } from '../services/jwt.service'

describe('JWTService', () => {
  let jwtService: JWTService

  beforeEach(() => {
    jwtService = new JWTService()
  })

  it('should generate valid tokens', async () => {
    const tokens = await jwtService.generateTokens('user-id', 'EMPLOYEE')

    expect(tokens.accessToken).toBeDefined()
    expect(tokens.refreshToken).toBeDefined()
  })
})
```

#### Integration Test Example:

```typescript
import request from 'supertest'
import { createTestServer } from '../../../tests/utils/test-server'
import { databaseFixture } from '../../../tests/fixtures/database.fixture'

describe('Auth API', () => {
  let testServer

  beforeAll(async () => {
    await databaseFixture.setup()
    testServer = await createTestServer(app)
  })

  afterAll(async () => {
    await databaseFixture.cleanup()
    await testServer.stop()
  })

  it('POST /api/auth/login should authenticate user', async () => {
    const response = await testServer.request().post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'password123',
    })

    expect(response.status).toBe(200)
    expect(response.body.data.tokens.accessToken).toBeDefined()
  })
})
```

## 🐛 Debugging Guide

### VS Code Configuration:

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Auth Service",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/services/auth-service/src/index.ts",
      "outFiles": ["${workspaceFolder}/services/auth-service/dist/**/*.js"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### Debug Commands:

```bash
# Debug specific service
cd services/auth-service
yarn dev:debug

# Debug with breakpoints
node --inspect-brk dist/index.js

# View logs
yarn logs:auth      # Service logs
yarn logs:all       # All service logs
```

### Common Debugging Scenarios:

#### Database Connection Issues:

```bash
# Check database status
docker-compose ps postgres

# View database logs
docker-compose logs postgres

# Connect to database
docker-compose exec postgres psql -U postgres -d ai_platform
```

#### Redis Connection Issues:

```bash
# Check Redis status
docker-compose ps redis

# Connect to Redis CLI
docker-compose exec redis redis-cli

# View Redis logs
docker-compose logs redis
```

#### Service Communication Issues:

```bash
# Check service health
curl http://localhost:9001/health   # Auth service
curl http://localhost:9002/health   # AI routing service

# Check API Gateway routing
curl http://localhost:8080/api/auth/health
```

## 🔧 Development Tools

### Essential VS Code Extensions:

- TypeScript and JavaScript Language Features
- Prisma
- Docker
- REST Client
- GitLens
- Prettier
- ESLint

### Useful Development Scripts:

#### Database Management:

```bash
# Reset database
cd database && yarn prisma migrate reset

# View database in browser
yarn prisma studio

# Generate Prisma client
yarn prisma generate

# Seed database with test data
yarn prisma db seed
```

#### Service Management:

```bash
# Check all service health
./scripts/health-check.sh

# View service logs
./scripts/docker-dev.sh logs auth-service

# Restart specific service
./scripts/docker-dev.sh restart billing-service

# Shell into service container
./scripts/docker-dev.sh shell auth-service
```

#### Code Quality:

```bash
# Fix linting issues
yarn lint:fix

# Format code
yarn format

# Type check
yarn typecheck

# Build verification
yarn build
```

## 📦 Package Development

### Creating New Shared Package:

```bash
# Create package structure
mkdir -p packages/new-package/src
cd packages/new-package

# Initialize package.json
cat > package.json << EOF
{
  "name": "@ai-platform/new-package",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
EOF

# Create TypeScript config
cat > tsconfig.json << EOF
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*"]
}
EOF
```

### Using Shared Packages:

```bash
# Add dependency in service
cd services/auth-service
yarn add @ai-platform/new-package

# Import in code
import { someFunction } from '@ai-platform/new-package';
```

## 🚀 Deployment Guide

### Development Deployment:

```bash
# Start all services
./scripts/docker-dev.sh start

# Stop all services
./scripts/docker-dev.sh stop

# View service status
./scripts/docker-dev.sh status
```

### Production Build:

```bash
# Build all services for production
yarn build

# Create production Docker images
./scripts/docker-prod.sh build

# Deploy to staging
./scripts/docker-prod.sh deploy staging

# Deploy to production
./scripts/docker-prod.sh deploy production
```

## 🔍 Troubleshooting

### Common Issues:

#### "Module not found" errors:

1. Verify workspace dependencies: `yarn install`
2. Check TypeScript paths in `tsconfig.json`
3. Rebuild shared packages: `yarn build`

#### Database connection errors:

1. Ensure PostgreSQL is running: `docker-compose ps`
2. Check connection string in `.env`
3. Verify database exists and migrations are applied

#### Port conflicts:

1. Check for running processes: `lsof -i :9001`
2. Stop conflicting services
3. Update port configurations if needed

#### Hot reload not working:

1. Check file watchers: `yarn dev`
2. Verify volume mounts in `docker-compose.dev.yml`
3. Restart development services

### Getting Help:

- Check service logs for error details
- Review API documentation in `/docs/api/`
- Refer to architecture documentation
- Use debug mode for detailed error information

## 📚 Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Docker Documentation](https://docs.docker.com/)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)
