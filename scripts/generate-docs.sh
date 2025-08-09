
#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}🔧 AI Employee Platform - Documentation Generator${NC}"
echo "=================================================="

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Generate TypeScript documentation
generate_ts_docs() {
    print_status "Generating TypeScript documentation..."
    
    if command_exists typedoc; then
        cd "$PROJECT_ROOT"
        
        # Generate docs for shared packages
        typedoc \
            --out docs/generated/typescript \
            --readme docs/development/README.md \
            --name "AI Employee Platform - TypeScript API" \
            --theme default \
            --excludePrivate \
            --excludeProtected \
            --excludeExternals \
            --includeVersion \
            packages/shared-types/src/index.ts \
            packages/shared-utils/src/index.ts \
            packages/ui-components/src/index.ts \
            packages/api-client/src/index.ts
            
        print_status "TypeScript documentation generated in docs/generated/typescript/"
    else
        print_warning "TypeDoc not found. Skipping TypeScript documentation generation."
        echo "Install with: npm install -g typedoc"
    fi
}

# Generate API documentation
generate_api_docs() {
    print_status "Generating API documentation..."
    
    # Copy OpenAPI spec to public location
    mkdir -p "$PROJECT_ROOT/docs/generated/api"
    cp "$PROJECT_ROOT/docs/api/openapi.yaml" "$PROJECT_ROOT/docs/generated/api/"
    cp "$PROJECT_ROOT/docs/api/swagger-ui.html" "$PROJECT_ROOT/docs/generated/api/index.html"
    
    # Generate Redoc documentation
    if command_exists redoc-cli; then
        redoc-cli build \
            "$PROJECT_ROOT/docs/api/openapi.yaml" \
            --output "$PROJECT_ROOT/docs/generated/api/redoc.html" \
            --title "AI Employee Platform API Documentation" \
            --theme.colors.primary.main "#667eea"
            
        print_status "Redoc documentation generated at docs/generated/api/redoc.html"
    else
        print_warning "redoc-cli not found. Install with: npm install -g redoc-cli"
    fi
    
    print_status "Swagger UI available at docs/generated/api/index.html"
}

# Generate architecture diagrams
generate_diagrams() {
    print_status "Generating architecture diagrams..."
    
    if command_exists mmdc; then
        cd "$PROJECT_ROOT/docs/architecture"
        
        # Generate system architecture diagram
        cat > system-architecture.mmd << EOF
graph TB
    subgraph "Client Layer"
        A[Admin Dashboard<br/>Next.js]
        B[Employee Portal<br/>Next.js]
        C[Mobile App<br/>React Native]
    end
    
    subgraph "API Gateway"
        D[Nginx Gateway<br/>Load Balancer]
    end
    
    subgraph "Microservices"
        E[Auth Service<br/>:9001]
        F[User Management<br/>:9004]
        G[AI Routing<br/>:9002]
        H[Billing<br/>:9003]
        I[Plugin Manager<br/>:9005]
        J[Notification<br/>:9006]
    end
    
    subgraph "Data Layer"
        K[(PostgreSQL<br/>Database)]
        L[(Redis<br/>Cache)]
    end
    
    subgraph "External APIs"
        M[OpenAI API]
        N[Anthropic API]
        O[Google AI API]
        P[Stripe API]
    end
    
    subgraph "Infrastructure"
        Q[Docker Containers]
        R[ELK Stack]
        S[Monitoring]
    end
    
    A --> D
    B --> D
    C --> D
    
    D --> E
    D --> F
    D --> G
    D --> H
    D --> I
    D --> J
    
    E --> K
    E --> L
    F --> K
    G --> K
    H --> K
    I --> K
    J --> L
    
    G --> M
    G --> N
    G --> O
    H --> P
    
    E --> Q
    F --> Q
    G --> Q
    H --> Q
    I --> Q
    J --> Q
    
    Q --> R
    Q --> S
    
    classDef client fill:#e1f5fe
    classDef gateway fill:#f3e5f5
    classDef service fill:#e8f5e8
    classDef data fill:#fff3e0
    classDef external fill:#fce4ec
    classDef infra fill:#f1f8e9
    
    class A,B,C client
    class D gateway
    class E,F,G,H,I,J service
    class K,L data
    class M,N,O,P external
    class Q,R,S infra
EOF
        
        mmdc -i system-architecture.mmd -o system-architecture.svg -t dark -b transparent
        print_status "System architecture diagram generated"
        
        # Generate database schema diagram
        cat > database-schema.mmd << EOF
erDiagram
    User {
        string id PK
        string email UK
        string name
        string password
        Role role
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    
    CreditAccount {
        string id PK
        string userId FK
        decimal balance
        decimal totalEarned
        decimal totalSpent
        datetime createdAt
        datetime updatedAt
    }
    
    AIAgent {
        string id PK
        string name
        string provider
        string model
        decimal costPerToken
        string[] capabilities
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    
    AIRequest {
        string id PK
        string userId FK
        string agentId FK
        text prompt
        text response
        integer tokensUsed
        decimal cost
        datetime createdAt
    }
    
    Transaction {
        string id PK
        string userId FK
        string requestId FK
        TransactionType type
        decimal amount
        string description
        TransactionStatus status
        datetime createdAt
    }
    
    Plugin {
        string id PK
        string name
        string version
        string description
        json config
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    
    UserPlugin {
        string id PK
        string userId FK
        string pluginId FK
        json settings
        boolean isActive
        datetime installedAt
    }
    
    BudgetLimit {
        string id PK
        string userId FK
        decimal dailyLimit
        decimal monthlyLimit
        decimal currentDailySpent
        decimal currentMonthlySpent
        datetime createdAt
        datetime updatedAt
    }
    
    User ||--|| CreditAccount : has
    User ||--o{ AIRequest : makes
    User ||--o{ Transaction : owns
    User ||--|| BudgetLimit : has
    User ||--o{ UserPlugin : installs
    
    AIAgent ||--o{ AIRequest : processes
    AIRequest ||--o| Transaction : generates
    
    Plugin ||--o{ UserPlugin : installed_as
EOF
        
        mmdc -i database-schema.mmd -o database-schema.svg -t dark -b transparent
        print_status "Database schema diagram generated"
        
        rm -f system-architecture.mmd database-schema.mmd
    else
        print_warning "mermaid-cli not found. Install with: npm install -g @mermaid-js/mermaid-cli"
    fi
}

# Generate project README
generate_readme() {
    print_status "Updating project README..."
    
    cat > "$PROJECT_ROOT/README.md" << 'EOF'
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

| Service | Port | Description |
|---------|------|-------------|
| **Auth Service** | 9001 | Authentication & authorization |
| **AI Routing** | 9002 | AI agent routing & management |
| **Billing** | 9003 | Credit & transaction management |
| **User Management** | 9004 | User operations & profiles |
| **Plugin Manager** | 9005 | Plugin lifecycle management |
| **Notification** | 9006 | Real-time notifications |

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
EOF

    print_status "Project README updated"
}

# Generate changelog
generate_changelog() {
    print_status "Generating CHANGELOG..."
    
    cat > "$PROJECT_ROOT/CHANGELOG.md" << 'EOF'
# Changelog

All notable changes to the AI Employee Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup and monorepo structure
- Authentication service with JWT and refresh tokens
- AI routing service with multi-provider support
- Billing service with credit-based system
- User management service
- Plugin manager service with sandboxing
- Notification service with WebSocket support
- Admin dashboard with Next.js
- Employee portal interface
- Comprehensive API documentation
- Docker containerization for all services
- ELK stack for logging and monitoring
- Nginx API gateway with SSL and rate limiting
- Testing framework setup with Jest
- Development workflow optimization

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- JWT-based authentication implementation
- Rate limiting and DDoS protection
- Input validation and sanitization
- SSL/TLS configuration

## [1.0.0] - 2025-08-08

### Added
- Initial release of AI Employee Platform
- Complete microservices architecture
- Multi-provider AI integration
- Credit-based billing system
- Role-based access control
- Plugin system framework
- Real-time notification system
- Comprehensive documentation
- Production-ready deployment configuration
EOF

    print_status "CHANGELOG.md generated"
}

# Create documentation index
create_docs_index() {
    print_status "Creating documentation index..."
    
    mkdir -p "$PROJECT_ROOT/docs/generated"
    
    cat > "$PROJECT_ROOT/docs/generated/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Employee Platform - Documentation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 {
            color: #667eea;
            text-align: center;
            margin-bottom: 2rem;
            font-size: 2.5rem;
        }
        .section {
            margin-bottom: 2rem;
            padding: 1.5rem;
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            background: #f8f9fa;
        }
        .section h2 {
            color: #495057;
            margin-top: 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .section h2::before {
            content: '📚';
            font-size: 1.2em;
        }
        .links {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        .link {
            display: block;
            padding: 1rem;
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            text-decoration: none;
            color: #495057;
            transition: all 0.3s ease;
        }
        .link:hover {
            background: #e9ecef;
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .link-title {
            font-weight: 600;
            color: #667eea;
            margin-bottom: 0.5rem;
        }
        .link-desc {
            font-size: 0.9rem;
            color: #6c757d;
        }
        .status {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
            background: #d4edda;
            color: #155724;
            margin-left: 0.5rem;
        }
        .footer {
            text-align: center;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e1e5e9;
            color: #6c757d;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 AI Employee Platform Documentation</h1>
        
        <div class="section">
            <h2>API Documentation</h2>
            <div class="links">
                <a href="./api/index.html" class="link">
                    <div class="link-title">Swagger UI <span class="status">Interactive</span></div>
                    <div class="link-desc">Interactive API documentation with try-it-out functionality</div>
                </a>
                <a href="./api/redoc.html" class="link">
                    <div class="link-title">ReDoc <span class="status">Clean</span></div>
                    <div class="link-desc">Clean, responsive API documentation</div>
                </a>
                <a href="../api/openapi.yaml" class="link">
                    <div class="link-title">OpenAPI Spec <span class="status">Raw</span></div>
                    <div class="link-desc">Raw OpenAPI 3.0 specification file</div>
                </a>
            </div>
        </div>

        <div class="section">
            <h2>Architecture & Design</h2>
            <div class="links">
                <a href="../architecture/README.md" class="link">
                    <div class="link-title">System Architecture</div>
                    <div class="link-desc">High-level system design, service architecture, and data flow</div>
                </a>
                <a href="../architecture/system-architecture.svg" class="link">
                    <div class="link-title">Architecture Diagram</div>
                    <div class="link-desc">Visual representation of the system architecture</div>
                </a>
                <a href="../architecture/database-schema.svg" class="link">
                    <div class="link-title">Database Schema</div>
                    <div class="link-desc">Entity relationship diagram for the database</div>
                </a>
            </div>
        </div>

        <div class="section">
            <h2>Development Guide</h2>
            <div class="links">
                <a href="../development/README.md" class="link">
                    <div class="link-title">Development Setup</div>
                    <div class="link-desc">Complete guide to set up development environment</div>
                </a>
                <a href="../development/api-integration.md" class="link">
                    <div class="link-title">API Integration</div>
                    <div class="link-desc">Examples and patterns for integrating with platform APIs</div>
                </a>
                <a href="../development/contributing.md" class="link">
                    <div class="link-title">Contributing Guidelines</div>
                    <div class="link-desc">How to contribute to the project</div>
                </a>
            </div>
        </div>

        <div class="section">
            <h2>Code Documentation</h2>
            <div class="links">
                <a href="./typescript/index.html" class="link">
                    <div class="link-title">TypeScript API <span class="status">Generated</span></div>
                    <div class="link-desc">Auto-generated documentation for shared packages</div>
                </a>
                <a href="../../../README.md" class="link">
                    <div class="link-title">Project README</div>
                    <div class="link-desc">Project overview and quick start guide</div>
                </a>
                <a href="../../../CHANGELOG.md" class="link">
                    <div class="link-title">Changelog</div>
                    <div class="link-desc">Version history and release notes</div>
                </a>
            </div>
        </div>

        <div class="footer">
            <p>Documentation generated on <strong id="date"></strong></p>
            <p>AI Employee Platform © 2025</p>
        </div>
    </div>

    <script>
        document.getElementById('date').textContent = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    </script>
</body>
</html>
EOF

    print_status "Documentation index created at docs/generated/index.html"
}

# Main execution
main() {
    echo "Starting documentation generation..."
    
    # Create output directories
    mkdir -p "$PROJECT_ROOT/docs/generated/api"
    mkdir -p "$PROJECT_ROOT/docs/generated/typescript"
    
    # Generate different types of documentation
    generate_api_docs
    generate_ts_docs
    generate_diagrams
    generate_readme
    generate_changelog
    create_docs_index
    
    echo ""
    echo -e "${GREEN}🎉 Documentation generation completed!${NC}"
    echo ""
    echo "Generated documentation:"
    echo "  📖 API Documentation: docs/generated/api/"
    echo "  🏗️  Architecture Diagrams: docs/architecture/"
    echo "  💻 TypeScript API: docs/generated/typescript/"
    echo "  📚 Main Index: docs/generated/index.html"
    echo ""
    echo "To view documentation:"
    echo "  • Open docs/generated/index.html in your browser"
    echo "  • Or serve with: python -m http.server 8000"
    echo ""
}

# Command line argument handling
case "${1:-}" in
    "api")
        generate_api_docs
        ;;
    "ts"|"typescript")
        generate_ts_docs
        ;;
    "diagrams")
        generate_diagrams
        ;;
    "readme")
        generate_readme
        ;;
    "changelog")
        generate_changelog
        ;;
    "index")
        create_docs_index
        ;;
    "all"|"")
        main
        ;;
    *)
        echo "Usage: $0 [api|typescript|diagrams|readme|changelog|index|all]"
        echo ""
        echo "Commands:"
        echo "  api        Generate API documentation only"
        echo "  typescript Generate TypeScript documentation only"
        echo "  diagrams   Generate architecture diagrams only"
        echo "  readme     Update project README only"
        echo "  changelog  Generate changelog only"
        echo "  index      Create documentation index only"
        echo "  all        Generate all documentation (default)"
        exit 1
        ;;
esac
