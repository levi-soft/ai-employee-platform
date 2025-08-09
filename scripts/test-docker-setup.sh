
#!/bin/bash

# AI Employee Platform - Docker Setup Test Script
# This script validates the Docker configuration without starting containers

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
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

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -n "Testing $test_name... "
    if eval "$test_command" >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Check if Docker is available
check_docker() {
    log_info "Checking Docker installation..."
    
    if command -v docker >/dev/null 2>&1; then
        log_success "Docker is installed: $(docker --version)"
        return 0
    else
        log_error "Docker is not installed"
        return 1
    fi
}

# Check if Docker Compose is available
check_docker_compose() {
    log_info "Checking Docker Compose..."
    
    if docker compose version >/dev/null 2>&1; then
        log_success "Docker Compose is available: $(docker compose version)"
        return 0
    elif command -v docker-compose >/dev/null 2>&1; then
        log_success "Docker Compose is available: $(docker-compose --version)"
        return 0
    else
        log_error "Docker Compose is not available"
        return 1
    fi
}

# Validate Docker Compose files
validate_compose_files() {
    log_info "Validating Docker Compose files..."
    
    # Main production compose file
    if docker compose -f docker-compose.yml config --quiet; then
        log_success "Main docker-compose.yml is valid"
    else
        log_error "Main docker-compose.yml has errors"
        return 1
    fi
    
    # Development compose file
    if docker compose -f infrastructure/docker/docker-compose.dev.yml config --quiet; then
        log_success "Development docker-compose.dev.yml is valid"
    else
        log_error "Development docker-compose.dev.yml has errors"
        return 1
    fi
}

# Check Dockerfile existence and syntax
check_dockerfiles() {
    log_info "Checking Dockerfiles..."
    
    local dockerfile_paths=(
        "services/auth-service/Dockerfile"
        "services/auth-service/Dockerfile.dev"
        "services/ai-routing-service/Dockerfile"
        "services/ai-routing-service/Dockerfile.dev"
        "services/billing-service/Dockerfile"
        "services/billing-service/Dockerfile.dev"
        "services/user-management-service/Dockerfile"
        "services/user-management-service/Dockerfile.dev"
        "services/plugin-manager-service/Dockerfile"
        "services/plugin-manager-service/Dockerfile.dev"
        "services/notification-service/Dockerfile"
        "services/notification-service/Dockerfile.dev"
        "apps/admin-dashboard/Dockerfile"
        "apps/admin-dashboard/Dockerfile.dev"
        "apps/employee-portal/Dockerfile"
        "apps/employee-portal/Dockerfile.dev"
        "infrastructure/docker/nginx/Dockerfile"
    )
    
    for dockerfile in "${dockerfile_paths[@]}"; do
        if [ -f "$dockerfile" ]; then
            if docker build -f "$dockerfile" --dry-run . >/dev/null 2>&1; then
                log_success "✓ $dockerfile syntax is valid"
            else
                log_warning "⚠ $dockerfile has potential syntax issues"
            fi
        else
            log_error "✗ $dockerfile not found"
            return 1
        fi
    done
}

# Check required configuration files
check_config_files() {
    log_info "Checking configuration files..."
    
    local config_files=(
        ".env.example"
        "infrastructure/docker/nginx/nginx.conf"
        "scripts/docker-dev.sh"
        "scripts/docker-prod.sh"
    )
    
    for config_file in "${config_files[@]}"; do
        run_test "$config_file existence" "[ -f '$config_file' ]"
    done
    
    # Check if scripts are executable
    run_test "docker-dev.sh executable" "[ -x 'scripts/docker-dev.sh' ]"
    run_test "docker-prod.sh executable" "[ -x 'scripts/docker-prod.sh' ]"
}

# Check .dockerignore files
check_dockerignore() {
    log_info "Checking .dockerignore files..."
    
    local dockerignore_paths=(
        ".dockerignore"
        "apps/admin-dashboard/.dockerignore"
        "apps/employee-portal/.dockerignore"
        "services/auth-service/.dockerignore"
        "services/ai-routing-service/.dockerignore"
        "services/billing-service/.dockerignore"
        "services/user-management-service/.dockerignore"
        "services/plugin-manager-service/.dockerignore"
        "services/notification-service/.dockerignore"
    )
    
    for dockerignore in "${dockerignore_paths[@]}"; do
        run_test "$dockerignore existence" "[ -f '$dockerignore' ]"
    done
}

# Test network connectivity requirements
test_network_config() {
    log_info "Testing network configuration..."
    
    # Check if required ports are available (not in use)
    local ports=(3000 3001 3002 3003 3004 3005 3006 3100 5432 6379 8080)
    
    for port in "${ports[@]}"; do
        if ! netstat -tuln 2>/dev/null | grep ":$port " >/dev/null; then
            log_success "Port $port is available"
        else
            log_warning "Port $port is already in use"
        fi
    done
}

# Validate environment file template
validate_env_template() {
    log_info "Validating environment template..."
    
    if [ -f ".env.example" ]; then
        # Check for required environment variables
        local required_vars=(
            "DATABASE_URL"
            "REDIS_URL"
            "JWT_SECRET"
            "NODE_ENV"
        )
        
        for var in "${required_vars[@]}"; do
            if grep -q "^$var=" ".env.example"; then
                log_success "✓ $var found in .env.example"
            else
                log_error "✗ $var missing from .env.example"
            fi
        done
    else
        log_error ".env.example not found"
    fi
}

# Run build test (dry run)
test_build_dry_run() {
    log_info "Testing Docker build (dry run)..."
    
    # Test one service build (auth-service) as representative
    if [ -f "services/auth-service/Dockerfile" ]; then
        if docker build -f services/auth-service/Dockerfile --dry-run services/auth-service >/dev/null 2>&1; then
            log_success "Docker build syntax test passed"
        else
            log_warning "Docker build syntax test failed"
        fi
    fi
}

# Main test execution
main() {
    log_info "Starting Docker Setup Validation..."
    echo "========================================"
    
    # Skip Docker checks if Docker is not available
    if check_docker && check_docker_compose; then
        validate_compose_files
        test_build_dry_run
    else
        log_warning "Docker not available - skipping Docker-specific tests"
    fi
    
    # Run tests that don't require Docker
    check_dockerfiles
    check_config_files
    check_dockerignore
    test_network_config
    validate_env_template
    
    echo "========================================"
    log_info "Test Summary:"
    echo "  Tests Passed: $TESTS_PASSED"
    echo "  Tests Failed: $TESTS_FAILED"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log_success "All tests passed! Docker setup appears to be correct."
        return 0
    else
        log_error "$TESTS_FAILED test(s) failed. Please fix the issues before proceeding."
        return 1
    fi
}

# Run the main function
main "$@"
