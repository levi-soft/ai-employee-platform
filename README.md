# 🤖 AI Employee Platform

A comprehensive microservices platform for managing AI agents, user interactions, and billing in enterprise environments.

## 🌟 Features

- **Multi-Provider AI Integration**: OpenAI, Anthropic, Google AI
- **Credit-Based Billing**: Transparent usage tracking and billing
- **Plugin System**: Extensible functionality with custom plugins
- **Role-Based Access**: Admin and employee role management
- **Real-Time Notifications**: WebSocket-based live updates
- **Production Ready**: Full Docker containerization and monitoring

## 🏗️ Architecture

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Admin Dashboard │   │ Employee Portal │   │   Mobile App    │
│    (Next.js)    │   │    (Next.js)    │   │ (React Native)  │
└─────────────────┘   └─────────────────┘   └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  Nginx Gateway  │
                    │ Load Balancer   │
                    └─────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │Auth Service │    │AI Routing   │    │Billing      │
   │   :9001     │    │Service :9002│    │Service :9003│
   └─────────────┘    └─────────────┘    └─────────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │     Redis       │
                    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18.x+
- Docker & Docker Compose
- PostgreSQL 15.x
- Redis 7.x

### Installation

```bash
# Clone repository
git clone <repository-url>
cd ai-employee-platform

# Install dependencies
yarn install

# Setup environment
./scripts/env-setup.sh

# Start development environment
./scripts/docker-dev.sh start

# Access services
open http://localhost:3000  # Admin Dashboard
open http://localhost:3001  # Employee Portal
open http://localhost:8080/docs  # API Documentation
```

## 📚 Documentation

- **[Architecture Guide](docs/architecture/README.md)** - System design and components
- **[API Documentation](docs/api/openapi.yaml)** - Complete API reference
- **[Development Guide](docs/development/README.md)** - Setup and development workflow
- **[API Integration](docs/development/api-integration.md)** - Client integration examples

## 🧪 Testing

```bash
# Run all tests
yarn test

# Run with coverage
yarn test:coverage

# Run specific service tests
yarn test:auth

# Integration tests
yarn test:integration
```

## 📊 Services

| Service             | Port | Description                     |
| ------------------- | ---- | ------------------------------- |
| **Auth Service**    | 9001 | Authentication & authorization  |
| **AI Routing**      | 9002 | AI agent routing & management   |
| **Billing**         | 9003 | Credit & transaction management |
| **User Management** | 9004 | User operations & profiles      |
| **Plugin Manager**  | 9005 | Plugin lifecycle management     |
| **Notification**    | 9006 | Real-time notifications         |

## 🔧 Development

### Project Structure

```
ai-employee-platform/
├── apps/                    # Frontend applications
│   ├── admin-dashboard/     # Admin interface
│   └── employee-portal/     # Employee interface
├── services/                # Backend microservices
├── packages/                # Shared packages
├── infrastructure/          # Infrastructure configs
├── database/               # Schema & migrations
└── docs/                   # Documentation
```

### Key Commands

```bash
yarn dev              # Start development servers
yarn build            # Build all packages
yarn test             # Run tests
yarn lint             # Lint code
yarn format           # Format code
```

## 🔐 Security

- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Rate limiting and DDoS protection
- Input validation and sanitization
- SSL/TLS termination at gateway
- Security headers and CORS configuration

## 📈 Monitoring

- **Logging**: ELK stack (Elasticsearch, Logstash, Kibana)
- **Metrics**: Custom metrics with Prometheus export
- **Health Checks**: Comprehensive service health monitoring
- **Error Tracking**: Structured error logging and alerting

## 🤝 Contributing

Please read our [Contributing Guidelines](docs/development/contributing.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Documentation**: [docs/](docs/)
- **API Reference**: [Swagger UI](docs/api/swagger-ui.html)
- **Issues**: GitHub Issues
- **Email**: support@aiplatform.com
