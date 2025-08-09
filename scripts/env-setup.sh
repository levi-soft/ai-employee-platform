
#!/bin/bash

# AI Employee Platform - Environment Setup Script
# This script helps setup environment configuration for all services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="/home/ubuntu/ai-employee-platform"
SERVICES_DIR="$PROJECT_ROOT/services"
REQUIRED_SERVICES=("auth-service" "ai-routing-service" "billing-service" "user-management-service" "plugin-manager-service" "notification-service")

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to generate random string
generate_random_string() {
    local length=${1:-32}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to validate required tools
validate_tools() {
    log_info "Validating required tools..."
    
    local missing_tools=()
    
    if ! command_exists openssl; then
        missing_tools+=("openssl")
    fi
    
    if ! command_exists python3; then
        missing_tools+=("python3")
    fi
    
    if ! command_exists node; then
        missing_tools+=("node")
    fi
    
    if ! command_exists npm; then
        missing_tools+=("npm")
    fi
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_info "Please install the missing tools and run this script again."
        exit 1
    fi
    
    log_success "All required tools are available"
}

# Function to create root .env file
setup_root_env() {
    log_info "Setting up root environment file..."
    
    local env_file="$PROJECT_ROOT/.env"
    local env_example="$PROJECT_ROOT/.env.example"
    
    if [ -f "$env_file" ]; then
        log_warning "Root .env file already exists. Creating backup..."
        cp "$env_file" "$env_file.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Copy from example
    cp "$env_example" "$env_file"
    
    # Generate secure secrets (using alphanumeric only to avoid sed issues)
    local jwt_secret=$(openssl rand -hex 32)
    local session_secret=$(openssl rand -hex 32)
    
    # Use python to safely replace the secrets (more reliable than sed)
    python3 -c "
import re
import sys

with open('$env_file', 'r') as f:
    content = f.read()

content = re.sub(r'your_jwt_secret_key_change_this_in_production', '$jwt_secret', content)
content = re.sub(r'your_session_secret_change_this_in_production', '$session_secret', content)

with open('$env_file', 'w') as f:
    f.write(content)
"
    
    log_success "Root .env file created with secure secrets"
}

# Function to setup service environment files
setup_service_envs() {
    log_info "Setting up service environment files..."
    
    for service in "${REQUIRED_SERVICES[@]}"; do
        local service_dir="$SERVICES_DIR/$service"
        local service_env="$service_dir/.env"
        local service_env_example="$service_dir/.env.example"
        
        if [ ! -d "$service_dir" ]; then
            log_warning "Service directory not found: $service_dir"
            continue
        fi
        
        if [ ! -f "$service_env_example" ]; then
            log_warning "Environment example file not found for $service"
            continue
        fi
        
        log_info "Setting up environment for $service..."
        
        if [ -f "$service_env" ]; then
            log_warning ".env file already exists for $service. Creating backup..."
            cp "$service_env" "$service_env.backup.$(date +%Y%m%d_%H%M%S)"
        fi
        
        # Copy from example
        cp "$service_env_example" "$service_env"
        
        # Generate service-specific secrets
        case $service in
            "auth-service")
                local jwt_secret=$(openssl rand -hex 32)
                local jwt_refresh_secret=$(openssl rand -hex 32)
                local session_secret=$(openssl rand -hex 32)
                
                python3 -c "
import re

with open('$service_env', 'r') as f:
    content = f.read()

content = re.sub(r'your_jwt_secret_key_change_this_in_production', '$jwt_secret', content)
content = re.sub(r'your_jwt_refresh_secret_change_this_in_production', '$jwt_refresh_secret', content)
content = re.sub(r'your_session_secret_change_this_in_production', '$session_secret', content)

with open('$service_env', 'w') as f:
    f.write(content)
"
                ;;
        esac
        
        log_success "Environment file created for $service"
    done
}

# Function to validate environment files
validate_env_files() {
    log_info "Validating environment configuration..."
    
    local validation_failed=false
    
    # Validate root .env
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        log_error "Root .env file not found"
        validation_failed=true
    else
        # Check for placeholder values
        if grep -q "your_.*_change_this_in_production" "$PROJECT_ROOT/.env"; then
            log_warning "Found placeholder values in root .env file"
        fi
    fi
    
    # Validate service .env files
    for service in "${REQUIRED_SERVICES[@]}"; do
        local service_env="$SERVICES_DIR/$service/.env"
        
        if [ ! -f "$service_env" ]; then
            log_error "Environment file not found for $service"
            validation_failed=true
            continue
        fi
        
        # Service-specific validation
        case $service in
            "auth-service")
                if ! grep -q "JWT_SECRET=" "$service_env" || ! grep -q "SESSION_SECRET=" "$service_env"; then
                    log_error "Missing required secrets in $service environment"
                    validation_failed=true
                fi
                ;;
            "ai-routing-service")
                if ! grep -q "DEFAULT_MODEL=" "$service_env"; then
                    log_warning "No default AI model configured for $service"
                fi
                ;;
            "billing-service")
                if ! grep -q "DEFAULT_CURRENCY=" "$service_env"; then
                    log_warning "No default currency configured for $service"
                fi
                ;;
        esac
    done
    
    if [ "$validation_failed" = true ]; then
        log_error "Environment validation failed"
        return 1
    fi
    
    log_success "Environment validation passed"
}

# Function to create environment documentation
create_env_docs() {
    log_info "Creating environment documentation..."
    
    local docs_dir="$PROJECT_ROOT/docs"
    local env_doc="$docs_dir/environment.md"
    
    mkdir -p "$docs_dir"
    
    cat > "$env_doc" << 'EOF'
# Environment Configuration Guide

## Overview

The AI Employee Platform uses environment variables for configuration across all services. This guide explains how to set up and manage environment variables for development, staging, and production environments.

## Environment Files Structure

```
ai-employee-platform/
├── .env                                    # Root environment file
├── .env.example                           # Root environment template
└── services/
    ├── auth-service/.env.example          # Auth service template
    ├── ai-routing-service/.env.example    # AI routing service template
    ├── billing-service/.env.example       # Billing service template
    ├── user-management-service/.env.example # User management template
    ├── plugin-manager-service/.env.example  # Plugin manager template
    └── notification-service/.env.example    # Notification service template
```

## Quick Setup

1. Run the environment setup script:
   ```bash
   cd /home/ubuntu/ai-employee-platform
   chmod +x scripts/env-setup.sh
   ./scripts/env-setup.sh
   ```

2. Edit the generated `.env` files with your actual values:
   ```bash
   # Edit root configuration
   nano .env
   
   # Edit service configurations
   nano services/auth-service/.env
   nano services/ai-routing-service/.env
   # ... etc
   ```

## Environment Types

### Development
- Uses local database and Redis instances
- Debug logging enabled
- Hot reload enabled
- Local file storage

### Staging
- Uses staging database
- Production-like configuration
- Rate limiting enabled
- External service integrations

### Production
- Uses production database
- Security hardening enabled
- Performance optimizations
- Full monitoring enabled

## Required Environment Variables

### Core Services

#### Database & Cache
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string

#### Security
- `JWT_SECRET` - Secret for signing JWT tokens
- `JWT_REFRESH_SECRET` - Secret for refresh tokens
- `SESSION_SECRET` - Session encryption secret
- `BCRYPT_ROUNDS` - Password hashing rounds (12 recommended)

#### External Services
- `OPENAI_API_KEY` - OpenAI API key for GPT models
- `CLAUDE_API_KEY` - Anthropic Claude API key
- `GEMINI_API_KEY` - Google Gemini API key
- `STRIPE_SECRET_KEY` - Stripe payment processing
- `SMTP_*` - Email service configuration

## Service-Specific Configuration

### Auth Service
Handles authentication, authorization, and user sessions.

**Key Variables:**
- `MAX_LOGIN_ATTEMPTS` - Maximum failed login attempts
- `LOCKOUT_TIME` - Account lockout duration
- `REQUIRE_EMAIL_VERIFICATION` - Enable email verification
- `REQUIRE_MFA` - Enable multi-factor authentication

### AI Routing Service
Manages AI provider routing and load balancing.

**Key Variables:**
- `DEFAULT_MODEL` - Default AI model to use
- `FALLBACK_MODEL` - Fallback model if primary fails
- `COST_OPTIMIZATION_ENABLED` - Enable cost optimization
- `LOAD_BALANCING_STRATEGY` - Load balancing strategy

### Billing Service
Handles payments, credits, and billing operations.

**Key Variables:**
- `DEFAULT_CURRENCY` - Default currency (USD)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook verification
- `AUTO_TOPUP_ENABLED` - Enable automatic credit top-up
- `BUDGET_WARNING_THRESHOLD` - Budget warning threshold

### User Management Service
Manages user profiles and permissions.

**Key Variables:**
- `MAX_FILE_SIZE` - Maximum avatar file size
- `PROFILE_COMPLETION_REQUIRED` - Require complete profiles
- `DATA_RETENTION_DAYS` - User data retention period

### Plugin Manager Service
Manages plugin installation and execution.

**Key Variables:**
- `SANDBOX_ENABLED` - Enable sandboxed execution
- `MAX_PLUGIN_SIZE` - Maximum plugin file size
- `PLUGIN_VERIFICATION_REQUIRED` - Require plugin verification

### Notification Service
Handles all types of notifications.

**Key Variables:**
- `WEBSOCKET_ENABLED` - Enable real-time notifications
- `EMAIL_ENABLED` - Enable email notifications
- `SMS_ENABLED` - Enable SMS notifications

## Security Best Practices

1. **Never commit .env files to version control**
2. **Use strong, unique secrets for each environment**
3. **Rotate secrets regularly**
4. **Use environment-specific values**
5. **Validate all environment variables on startup**

## Validation

The environment setup script includes validation to check:
- Required variables are present
- Secrets are not using placeholder values
- Service-specific requirements are met

Run validation manually:
```bash
./scripts/env-validation.sh
```

## Troubleshooting

### Common Issues

1. **Service won't start**
   - Check if all required environment variables are set
   - Verify database connectivity
   - Check log files for specific errors

2. **Authentication failures**
   - Verify JWT secrets are set correctly
   - Check if secrets match across services
   - Ensure session secrets are configured

3. **AI routing failures**
   - Verify API keys are set correctly
   - Check provider rate limits
   - Verify model availability

### Environment Variable Debugging

```bash
# Check environment variables for a service
cd services/auth-service
node -e "require('dotenv').config(); console.log(process.env)"

# Test database connectivity
cd services/auth-service
node -e "require('dotenv').config(); const db = require('./src/config/database'); db.testConnection()"
```

## Production Deployment

For production deployments:

1. Use a secrets management system (AWS Secrets Manager, HashiCorp Vault)
2. Set environment variables through your deployment platform
3. Enable all security features
4. Use production-grade external services
5. Configure proper monitoring and alerting

## Support

If you encounter issues with environment configuration:
1. Check this documentation
2. Validate your environment files
3. Review service logs
4. Consult the troubleshooting section
EOF

    log_success "Environment documentation created at $env_doc"
}

# Function to display summary
show_summary() {
    log_info "Environment setup completed successfully!"
    echo
    echo "Next Steps:"
    echo "1. Review and customize the generated .env files"
    echo "2. Add your API keys and service credentials"
    echo "3. Test the configuration with: ./scripts/env-validation.sh"
    echo "4. Start the services with: docker-compose up -d"
    echo
    echo "Documentation: docs/environment.md"
    echo "Validation script: scripts/env-validation.sh"
}

# Main execution
main() {
    log_info "Starting AI Employee Platform environment setup..."
    echo
    
    validate_tools
    setup_root_env
    setup_service_envs
    validate_env_files
    create_env_docs
    
    echo
    show_summary
}

# Run main function
main "$@"
