# AI Employee Platform - Database

This directory contains all database-related configurations, migrations, and utilities for the AI Employee Platform.

## Structure

```
database/
├── config/                 # Database configuration files
│   ├── database.ts         # Prisma client setup
│   └── redis.ts           # Redis connection setup
├── migrations/            # SQL migration files
├── seeds/                 # Database seed scripts
│   └── seed.ts           # Main seed script
├── scripts/              # Database utility scripts
│   └── setup.ts          # Database setup and reset scripts
├── utils/                # Database utilities
│   └── migration-helpers.ts # Migration helper functions
├── docker-compose.yml    # Local development databases
├── schema.prisma         # Prisma database schema
├── .env                  # Environment variables
└── package.json         # Database package configuration
```

## Quick Start

### 1. Start Local Databases

```bash
# Start PostgreSQL and Redis containers
yarn dev

# Or manually:
docker-compose up -d
```

### 2. Setup Database

```bash
# Generate Prisma client
yarn generate

# Run migrations and seed data
yarn setup
```

### 3. Database Operations

```bash
# Run migrations only
yarn migrate

# Seed database only
yarn seed

# Open Prisma Studio
yarn studio

# Reset database completely
yarn reset

# Check database health
yarn health
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# PostgreSQL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_employee_platform?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"
REDIS_SESSION_SECRET="your-secret-key"

# Environment
NODE_ENV="development"
```

## Database Schema

### Core Tables

- **users**: User accounts and profiles
- **credit_accounts**: Credit balances and spending tracking
- **ai_agents**: Available AI models and their configurations
- **transactions**: Credit transactions (top-ups, usage, refunds)
- **ai_requests**: AI model usage requests and responses
- **plugins**: Available plugins in the marketplace
- **user_plugins**: User-installed plugins and configurations
- **budget_limits**: User spending limits and controls

### Relationships

- Users have one CreditAccount
- Users can have many Transactions and AIRequests
- AIAgents can have many Transactions and AIRequests
- Users can install many Plugins through UserPlugins
- Users can set multiple BudgetLimits

## Redis Usage

Redis is used for:

- **Session Storage**: User authentication sessions
- **Caching**: Frequently accessed data
- **Rate Limiting**: API rate limiting counters
- **Real-time Features**: WebSocket connections and notifications

## Performance Optimizations

### Indexes

All critical queries have appropriate indexes:

- Email lookups on users
- Transaction queries by user/type/date
- AI request queries by user/agent/status
- Plugin searches by category/official status

### Connection Pooling

Prisma handles connection pooling automatically. For high-load scenarios, consider:

- Increasing `connection_limit` in DATABASE_URL
- Using PgBouncer for additional pooling
- Implementing read replicas for read-heavy queries

### Monitoring

- Use `yarn studio` for visual database exploration
- Monitor slow queries in PostgreSQL logs
- Use Redis Commander (accessible at http://localhost:8081)

## Security

### Data Protection

- All passwords are hashed with bcrypt (cost factor 12)
- Sensitive configuration stored in environment variables
- Database connections use SSL in production

### Access Control

- Role-based access control (RBAC) implemented
- User permissions checked at application level
- Database-level foreign key constraints enforce data integrity

## Testing

### Test Database

For testing, use a separate database:

```bash
# Create test database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_employee_platform_test" yarn migrate
```

### Fixtures

Test fixtures are available in `/tests/fixtures/` directory with sample data for automated testing.

## Backup & Recovery

### Automated Backups

```bash
# Create backup
pg_dump -h localhost -U postgres ai_employee_platform > backup.sql

# Restore backup
psql -h localhost -U postgres ai_employee_platform < backup.sql
```

### Data Archiving

Old data can be archived using the utilities in `utils/migration-helpers.ts`:

- Transaction data older than 2 years
- AI request logs older than 1 year
- Inactive user data after 1 year of inactivity

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if PostgreSQL/Redis containers are running
2. **Migration Errors**: Ensure database schema is in sync with Prisma schema
3. **Seeding Errors**: Check if all required environment variables are set

### Debug Commands

```bash
# Check database connection
yarn health

# View migration status
npx prisma migrate status

# Reset and start fresh
yarn reset
```

## Production Deployment

### Environment Setup

1. Use managed PostgreSQL service (AWS RDS, Google Cloud SQL, etc.)
2. Use managed Redis service (AWS ElastiCache, Redis Cloud, etc.)
3. Configure proper SSL certificates
4. Set up automated backups
5. Configure monitoring and alerting

### Migration Strategy

1. Always backup before migrations
2. Use `prisma migrate deploy` in production
3. Test migrations in staging first
4. Plan for zero-downtime deployments
