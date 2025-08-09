
#!/bin/bash

# AI Employee Platform - Integration Test Environment Setup
# Manages test database, Redis, and environment configuration for integration tests

set -e

# Configuration
PROJECT_ROOT="/home/ubuntu/ai-employee-platform"
TEST_ENV_FILE="${PROJECT_ROOT}/.env.test"
TEST_DB_NAME="ai_platform_test"
TEST_REDIS_DB="1"  # Use Redis database 1 for tests

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."
    
    local missing_deps=()
    
    if ! command -v docker &> /dev/null; then
        missing_deps+=("docker")
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        missing_deps+=("docker-compose")
    fi
    
    if ! command -v node &> /dev/null; then
        missing_deps+=("node")
    fi
    
    if ! command -v yarn &> /dev/null; then
        missing_deps+=("yarn")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_error "Please install the missing dependencies and try again."
        exit 1
    fi
    
    log_success "All dependencies are available"
}

# Create test environment file
create_test_env() {
    log_info "Creating test environment configuration..."
    
    cat > "${TEST_ENV_FILE}" << EOF
# Test Environment Configuration
NODE_ENV=test
PORT=3001

# Database Configuration
DATABASE_URL="postgresql://postgres:testpassword@localhost:5432/${TEST_DB_NAME}"
DIRECT_URL="postgresql://postgres:testpassword@localhost:5432/${TEST_DB_NAME}"

# Redis Configuration  
REDIS_URL="redis://localhost:6379/${TEST_REDIS_DB}"
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_DB="${TEST_REDIS_DB}"

# JWT Configuration
JWT_SECRET="test-jwt-secret-key-super-long-and-secure"
JWT_REFRESH_SECRET="test-jwt-refresh-secret-key-super-long-and-secure"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Session Configuration
SESSION_SECRET="test-session-secret-key-super-long-and-secure"
SESSION_TIMEOUT="24h"

# Security Configuration
BCRYPT_ROUNDS="10"
RATE_LIMIT_WINDOW_MS="900000"
RATE_LIMIT_MAX_REQUESTS="100"

# AI Service Configuration (Test/Mock)
OPENAI_API_KEY="test-openai-key"
ANTHROPIC_API_KEY="test-anthropic-key"
GOOGLE_AI_API_KEY="test-google-key"

# Email Configuration (Test)
EMAIL_FROM="test@ai-platform.local"
EMAIL_HOST="localhost"
EMAIL_PORT="1025"
EMAIL_USER="test"
EMAIL_PASS="test"

# File Upload Configuration
MAX_FILE_SIZE="10485760"
UPLOAD_DIR="/tmp/test-uploads"

# API Configuration
API_BASE_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"

# Logging Configuration
LOG_LEVEL="debug"
LOG_FORMAT="json"
LOG_FILE="${PROJECT_ROOT}/logs/test.log"

# Test Configuration
TEST_TIMEOUT="30000"
TEST_DB_RESET="true"
TEST_REDIS_FLUSH="true"
EOF
    
    log_success "Test environment file created at ${TEST_ENV_FILE}"
}

# Start test services
start_test_services() {
    log_info "Starting test services..."
    
    cd "${PROJECT_ROOT}"
    
    # Start PostgreSQL and Redis for testing
    docker-compose -f docker-compose.test.yml up -d postgres-test redis-test
    
    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 10
    
    # Check PostgreSQL
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec ai-employee-platform-postgres-test-1 pg_isready -U postgres &> /dev/null; then
            log_success "PostgreSQL is ready"
            break
        fi
        
        log_info "Waiting for PostgreSQL... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_error "PostgreSQL failed to start within the expected time"
        exit 1
    fi
    
    # Check Redis
    attempt=1
    while [ $attempt -le $max_attempts ]; do
        if docker exec ai-employee-platform-redis-test-1 redis-cli ping | grep -q PONG; then
            log_success "Redis is ready"
            break
        fi
        
        log_info "Waiting for Redis... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_error "Redis failed to start within the expected time"
        exit 1
    fi
}

# Setup test database
setup_test_database() {
    log_info "Setting up test database..."
    
    # Create test database if it doesn't exist
    docker exec ai-employee-platform-postgres-test-1 psql -U postgres -c "CREATE DATABASE ${TEST_DB_NAME};" 2>/dev/null || true
    
    cd "${PROJECT_ROOT}/database"
    
    # Install database dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing database dependencies..."
        yarn install
    fi
    
    # Run Prisma migrations
    log_info "Running database migrations..."
    DATABASE_URL="postgresql://postgres:testpassword@localhost:5432/${TEST_DB_NAME}" yarn prisma migrate dev --name init
    
    # Generate Prisma client
    log_info "Generating Prisma client..."
    DATABASE_URL="postgresql://postgres:testpassword@localhost:5432/${TEST_DB_NAME}" yarn prisma generate
    
    log_success "Test database setup completed"
}

# Install test dependencies
install_test_dependencies() {
    log_info "Installing test dependencies..."
    
    cd "${PROJECT_ROOT}"
    
    # Install root dependencies
    yarn install
    
    # Install service dependencies that need testing
    log_info "Installing auth service dependencies..."
    cd "${PROJECT_ROOT}/services/auth-service"
    yarn install
    
    cd "${PROJECT_ROOT}/packages/shared-utils"
    yarn install
    
    cd "${PROJECT_ROOT}/packages/shared-types"
    yarn install
    
    log_success "Test dependencies installed"
}

# Run integration tests
run_integration_tests() {
    log_info "Running integration tests..."
    
    cd "${PROJECT_ROOT}"
    
    # Set test environment
    export NODE_ENV=test
    export $(cat "${TEST_ENV_FILE}" | grep -v '^#' | xargs)
    
    # Run tests with coverage
    yarn test:integration
    
    log_success "Integration tests completed"
}

# Cleanup test environment
cleanup_test_environment() {
    log_info "Cleaning up test environment..."
    
    cd "${PROJECT_ROOT}"
    
    # Stop test services
    docker-compose -f docker-compose.test.yml down -v
    
    # Clean test uploads
    if [ -d "/tmp/test-uploads" ]; then
        rm -rf "/tmp/test-uploads"
    fi
    
    # Clean test logs
    if [ -f "${PROJECT_ROOT}/logs/test.log" ]; then
        rm -f "${PROJECT_ROOT}/logs/test.log"
    fi
    
    log_success "Test environment cleaned up"
}

# Validate test environment
validate_test_environment() {
    log_info "Validating test environment..."
    
    local validation_errors=()
    
    # Check test environment file
    if [ ! -f "${TEST_ENV_FILE}" ]; then
        validation_errors+=("Test environment file not found")
    fi
    
    # Check database connection
    if ! docker exec ai-employee-platform-postgres-test-1 psql -U postgres -d "${TEST_DB_NAME}" -c "SELECT 1;" &> /dev/null; then
        validation_errors+=("Test database connection failed")
    fi
    
    # Check Redis connection
    if ! docker exec ai-employee-platform-redis-test-1 redis-cli -n "${TEST_REDIS_DB}" ping | grep -q PONG; then
        validation_errors+=("Test Redis connection failed")
    fi
    
    # Check required directories
    local required_dirs=("${PROJECT_ROOT}/tests/integration" "${PROJECT_ROOT}/tests/fixtures")
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            validation_errors+=("Required directory not found: $dir")
        fi
    done
    
    if [ ${#validation_errors[@]} -eq 0 ]; then
        log_success "Test environment validation passed"
        return 0
    else
        log_error "Test environment validation failed:"
        for error in "${validation_errors[@]}"; do
            log_error "  - $error"
        done
        return 1
    fi
}

# Reset test data
reset_test_data() {
    log_info "Resetting test data..."
    
    # Flush Redis test database
    docker exec ai-employee-platform-redis-test-1 redis-cli -n "${TEST_REDIS_DB}" FLUSHDB
    
    # Reset PostgreSQL test database
    cd "${PROJECT_ROOT}/database"
    DATABASE_URL="postgresql://postgres:testpassword@localhost:5432/${TEST_DB_NAME}" yarn prisma migrate reset --force
    
    log_success "Test data reset completed"
}

# Show test environment status
show_status() {
    log_info "Test Environment Status:"
    
    echo "  Database: $(docker exec ai-employee-platform-postgres-test-1 psql -U postgres -d "${TEST_DB_NAME}" -c "SELECT 1;" &> /dev/null && echo "✅ Connected" || echo "❌ Not Connected")"
    echo "  Redis: $(docker exec ai-employee-platform-redis-test-1 redis-cli -n "${TEST_REDIS_DB}" ping 2>/dev/null | grep -q PONG && echo "✅ Connected" || echo "❌ Not Connected")"
    echo "  Environment File: $([ -f "${TEST_ENV_FILE}" ] && echo "✅ Present" || echo "❌ Missing")"
    echo "  Test Services: $(docker-compose -f docker-compose.test.yml ps --services --filter "status=running" | wc -l | xargs echo) running"
}

# Show usage
show_usage() {
    cat << EOF
Usage: $0 [COMMAND]

Commands:
  setup       - Setup complete test environment
  start       - Start test services
  stop        - Stop test services  
  test        - Run integration tests
  reset       - Reset test data
  cleanup     - Clean up test environment
  validate    - Validate test environment
  status      - Show test environment status
  env         - Create test environment file
  help        - Show this help message

Examples:
  $0 setup     # Complete test environment setup
  $0 test      # Run integration tests
  $0 reset     # Reset test data for clean slate
  $0 cleanup   # Clean up everything
EOF
}

# Main script logic
main() {
    cd "${PROJECT_ROOT}"
    
    case "${1:-help}" in
        "setup")
            check_dependencies
            create_test_env
            start_test_services
            setup_test_database
            install_test_dependencies
            validate_test_environment
            log_success "Test environment setup completed successfully!"
            show_status
            ;;
        "start")
            start_test_services
            log_success "Test services started"
            ;;
        "stop")
            docker-compose -f docker-compose.test.yml down
            log_success "Test services stopped"
            ;;
        "test")
            validate_test_environment && run_integration_tests
            ;;
        "reset")
            reset_test_data
            ;;
        "cleanup")
            cleanup_test_environment
            ;;
        "validate")
            validate_test_environment
            ;;
        "status")
            show_status
            ;;
        "env")
            create_test_env
            ;;
        "help"|*)
            show_usage
            ;;
    esac
}

# Run main function
main "$@"
