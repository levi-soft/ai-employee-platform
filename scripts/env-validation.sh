
#!/bin/bash

# AI Employee Platform - Environment Validation Script
# This script validates environment configuration for all services

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

# Validation results
VALIDATION_PASSED=true
WARNINGS=()
ERRORS=()

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    WARNINGS+=("$1")
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ERRORS+=("$1")
    VALIDATION_PASSED=false
}

# Function to check if variable exists and is not empty
check_required_var() {
    local file="$1"
    local var_name="$2"
    local description="$3"
    
    if ! grep -q "^${var_name}=" "$file"; then
        log_error "$file: Missing required variable $var_name ($description)"
        return 1
    fi
    
    local var_value=$(grep "^${var_name}=" "$file" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    if [ -z "$var_value" ]; then
        log_error "$file: Variable $var_name is empty ($description)"
        return 1
    fi
    
    # Check for placeholder values
    if [[ "$var_value" =~ ^your_.* ]] || [[ "$var_value" =~ .*change_this_in_production.* ]]; then
        log_warning "$file: Variable $var_name contains placeholder value ($description)"
        return 2
    fi
    
    return 0
}

# Function to check optional variable
check_optional_var() {
    local file="$1"
    local var_name="$2"
    local description="$3"
    
    if ! grep -q "^${var_name}=" "$file"; then
        log_warning "$file: Optional variable $var_name not set ($description)"
        return 1
    fi
    
    local var_value=$(grep "^${var_name}=" "$file" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    if [ -z "$var_value" ]; then
        log_warning "$file: Optional variable $var_name is empty ($description)"
        return 1
    fi
    
    return 0
}

# Function to validate root environment
validate_root_env() {
    log_info "Validating root environment file..."
    
    local env_file="$PROJECT_ROOT/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Root .env file not found. Run ./scripts/env-setup.sh first."
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DATABASE_URL" "Database connection string"
    check_required_var "$env_file" "REDIS_URL" "Redis connection string"
    check_required_var "$env_file" "JWT_SECRET" "JWT signing secret"
    check_required_var "$env_file" "SESSION_SECRET" "Session encryption secret"
    check_required_var "$env_file" "NODE_ENV" "Node.js environment"
    
    # Optional but recommended
    check_optional_var "$env_file" "OPENAI_API_KEY" "OpenAI API access"
    check_optional_var "$env_file" "STRIPE_SECRET_KEY" "Payment processing"
    check_optional_var "$env_file" "SMTP_HOST" "Email notifications"
    
    log_success "Root environment validation completed"
}

# Function to validate auth service environment
validate_auth_service() {
    log_info "Validating auth service environment..."
    
    local service="auth-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "JWT_SECRET" "JWT signing secret"
    check_required_var "$env_file" "JWT_REFRESH_SECRET" "JWT refresh secret"
    check_required_var "$env_file" "SESSION_SECRET" "Session secret"
    check_required_var "$env_file" "BCRYPT_ROUNDS" "Password hashing rounds"
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    
    # Validate bcrypt rounds
    local bcrypt_rounds=$(grep "^BCRYPT_ROUNDS=" "$env_file" | cut -d'=' -f2)
    if [ "$bcrypt_rounds" -lt 10 ]; then
        log_warning "$service: BCRYPT_ROUNDS should be at least 10 for security"
    fi
    
    log_success "Auth service validation completed"
}

# Function to validate AI routing service environment
validate_ai_routing_service() {
    log_info "Validating AI routing service environment..."
    
    local service="ai-routing-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DEFAULT_MODEL" "Default AI model"
    check_required_var "$env_file" "FALLBACK_MODEL" "Fallback AI model"
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    
    # Optional API keys (warn if missing)
    check_optional_var "$env_file" "OPENAI_API_KEY" "OpenAI integration"
    check_optional_var "$env_file" "CLAUDE_API_KEY" "Claude integration"
    check_optional_var "$env_file" "GEMINI_API_KEY" "Gemini integration"
    
    log_success "AI routing service validation completed"
}

# Function to validate billing service environment
validate_billing_service() {
    log_info "Validating billing service environment..."
    
    local service="billing-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DEFAULT_CURRENCY" "Default currency"
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    
    # Stripe configuration (warn if missing)
    check_optional_var "$env_file" "STRIPE_SECRET_KEY" "Stripe payment processing"
    check_optional_var "$env_file" "STRIPE_WEBHOOK_SECRET" "Stripe webhook verification"
    
    log_success "Billing service validation completed"
}

# Function to validate user management service environment
validate_user_management_service() {
    log_info "Validating user management service environment..."
    
    local service="user-management-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    check_required_var "$env_file" "MAX_FILE_SIZE" "File upload limit"
    check_required_var "$env_file" "UPLOAD_DIR" "Upload directory"
    
    log_success "User management service validation completed"
}

# Function to validate plugin manager service environment
validate_plugin_manager_service() {
    log_info "Validating plugin manager service environment..."
    
    local service="plugin-manager-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    check_required_var "$env_file" "PLUGIN_STORAGE_DIR" "Plugin storage directory"
    check_required_var "$env_file" "MAX_PLUGIN_SIZE" "Maximum plugin size"
    
    log_success "Plugin manager service validation completed"
}

# Function to validate notification service environment
validate_notification_service() {
    log_info "Validating notification service environment..."
    
    local service="notification-service"
    local env_file="$SERVICES_DIR/$service/.env"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found for $service"
        return 1
    fi
    
    # Required variables
    check_required_var "$env_file" "DATABASE_URL" "Database connection"
    check_required_var "$env_file" "REDIS_URL" "Redis connection"
    check_required_var "$env_file" "WEBSOCKET_PORT" "WebSocket port"
    
    # Optional notification channels
    check_optional_var "$env_file" "SMTP_HOST" "Email notifications"
    check_optional_var "$env_file" "TWILIO_ACCOUNT_SID" "SMS notifications"
    
    log_success "Notification service validation completed"
}

# Function to validate environment connectivity
validate_connectivity() {
    log_info "Validating service connectivity..."
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_warning "Docker is not running. Cannot test database connectivity."
        return 0
    fi
    
    # Check if PostgreSQL is accessible
    if docker-compose ps | grep -q "postgres.*Up"; then
        log_success "PostgreSQL container is running"
    else
        log_warning "PostgreSQL container is not running. Start with: docker-compose up -d postgres"
    fi
    
    # Check if Redis is accessible
    if docker-compose ps | grep -q "redis.*Up"; then
        log_success "Redis container is running"
    else
        log_warning "Redis container is not running. Start with: docker-compose up -d redis"
    fi
}

# Function to generate validation report
generate_report() {
    echo
    log_info "Environment Validation Report"
    echo "==============================="
    
    if [ "$VALIDATION_PASSED" = true ]; then
        log_success "Overall validation: PASSED"
    else
        log_error "Overall validation: FAILED"
    fi
    
    echo
    echo "Summary:"
    echo "- Errors: ${#ERRORS[@]}"
    echo "- Warnings: ${#WARNINGS[@]}"
    
    if [ ${#ERRORS[@]} -gt 0 ]; then
        echo
        echo "Errors to fix:"
        for error in "${ERRORS[@]}"; do
            echo "  • $error"
        done
    fi
    
    if [ ${#WARNINGS[@]} -gt 0 ]; then
        echo
        echo "Warnings to consider:"
        for warning in "${WARNINGS[@]}"; do
            echo "  • $warning"
        done
    fi
    
    echo
    if [ "$VALIDATION_PASSED" = true ]; then
        echo "✅ Your environment is ready! You can start the services."
        echo "   Run: docker-compose up -d"
    else
        echo "❌ Please fix the errors above before starting the services."
        echo "   Run: ./scripts/env-setup.sh to regenerate environment files"
    fi
}

# Main execution
main() {
    log_info "Starting environment validation..."
    echo
    
    # Change to project directory
    cd "$PROJECT_ROOT"
    
    # Validate each component
    validate_root_env
    validate_auth_service
    validate_ai_routing_service
    validate_billing_service
    validate_user_management_service
    validate_plugin_manager_service
    validate_notification_service
    validate_connectivity
    
    # Generate report
    generate_report
    
    # Exit with appropriate code
    if [ "$VALIDATION_PASSED" = true ]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"
