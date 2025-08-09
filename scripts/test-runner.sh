
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

echo -e "${BLUE}🧪 AI Employee Platform - Test Runner${NC}"
echo "========================================="

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

# Function to run tests with proper error handling
run_test_command() {
    local cmd="$1"
    local description="$2"
    
    echo -e "${BLUE}Running: $description${NC}"
    echo "Command: $cmd"
    echo "----------------------------------------"
    
    if eval "$cmd"; then
        print_status "$description completed successfully"
        return 0
    else
        print_error "$description failed"
        return 1
    fi
}

# Setup test environment
setup_test_env() {
    print_status "Setting up test environment..."
    
    cd "$PROJECT_ROOT"
    
    # Ensure test environment file exists
    if [[ ! -f .env.test ]]; then
        cp .env.test.example .env.test 2>/dev/null || true
    fi
    
    # Set test environment
    export NODE_ENV=test
    export DATABASE_URL="postgresql://test:test@localhost:5433/ai_platform_test"
    export REDIS_URL="redis://localhost:6380"
    
    print_status "Test environment configured"
}

# Run unit tests
run_unit_tests() {
    print_status "Running unit tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run Jest with unit test configuration
    run_test_command \
        "jest --testPathPattern='\\.test\\.(ts|tsx)$' --testPathIgnorePatterns=integration --verbose" \
        "Unit Tests"
}

# Run integration tests
run_integration_tests() {
    print_status "Running integration tests..."
    
    cd "$PROJECT_ROOT"
    
    # Check if test database is available
    if ! timeout 5 bash -c "cat < /dev/null > /dev/tcp/localhost/5433" 2>/dev/null; then
        print_warning "Test database not available, starting test services..."
        docker-compose -f docker-compose.test.yml up -d postgres redis
        
        # Wait for services to be ready
        echo "Waiting for test services..."
        sleep 10
    fi
    
    # Run integration tests
    run_test_command \
        "jest --testPathPattern='integration.*\\.test\\.(ts|tsx)$' --runInBand --verbose" \
        "Integration Tests"
}

# Run service-specific tests
run_service_tests() {
    local service="$1"
    print_status "Running tests for $service..."
    
    cd "$PROJECT_ROOT"
    
    if [[ -d "services/$service" ]]; then
        run_test_command \
            "jest --testPathPattern='services/$service.*\\.test\\.(ts|tsx)$' --verbose" \
            "$service Service Tests"
    elif [[ -d "apps/$service" ]]; then
        run_test_command \
            "jest --testPathPattern='apps/$service.*\\.test\\.(ts|tsx)$' --verbose" \
            "$service App Tests"
    elif [[ -d "packages/$service" ]]; then
        run_test_command \
            "jest --testPathPattern='packages/$service.*\\.test\\.(ts|tsx)$' --verbose" \
            "$service Package Tests"
    else
        print_error "Service/App/Package '$service' not found"
        return 1
    fi
}

# Run tests with coverage
run_coverage_tests() {
    print_status "Running tests with coverage..."
    
    cd "$PROJECT_ROOT"
    
    run_test_command \
        "jest --coverage --coverageDirectory=coverage --coverageReporters=text --coverageReporters=lcov --coverageReporters=html" \
        "Coverage Tests"
        
    print_status "Coverage report generated in coverage/ directory"
}

# Run linting
run_lint() {
    print_status "Running linting checks..."
    
    cd "$PROJECT_ROOT"
    
    run_test_command \
        "yarn lint" \
        "ESLint Check"
}

# Run type checking
run_typecheck() {
    print_status "Running TypeScript type checking..."
    
    cd "$PROJECT_ROOT"
    
    # Check each workspace
    for workspace in services/* apps/* packages/*; do
        if [[ -d "$workspace" && -f "$workspace/tsconfig.json" ]]; then
            workspace_name=$(basename "$workspace")
            cd "$PROJECT_ROOT/$workspace"
            run_test_command \
                "tsc --noEmit" \
                "TypeScript Check - $workspace_name"
        fi
    done
    
    cd "$PROJECT_ROOT"
}

# Run all tests
run_all_tests() {
    print_status "Running complete test suite..."
    
    local failed=0
    
    setup_test_env
    
    # Run different test types
    run_lint || ((failed++))
    run_typecheck || ((failed++))
    run_unit_tests || ((failed++))
    run_integration_tests || ((failed++))
    
    if [[ $failed -eq 0 ]]; then
        print_status "All tests passed! ✨"
        return 0
    else
        print_error "$failed test suite(s) failed"
        return 1
    fi
}

# Watch mode for development
run_watch_mode() {
    print_status "Starting test watch mode..."
    
    cd "$PROJECT_ROOT"
    setup_test_env
    
    echo "Watching for changes... Press Ctrl+C to stop"
    jest --watch --testPathIgnorePatterns=integration
}

# Generate test report
generate_test_report() {
    print_status "Generating test report..."
    
    cd "$PROJECT_ROOT"
    setup_test_env
    
    # Run tests and generate reports
    jest \
        --coverage \
        --coverageDirectory=coverage \
        --coverageReporters=html \
        --coverageReporters=json \
        --coverageReporters=lcov \
        --testResultsProcessor=jest-html-reporter \
        --verbose > test-results.log 2>&1
    
    print_status "Test report generated:"
    echo "  • Coverage: coverage/index.html"
    echo "  • Results: test-results.html"
    echo "  • Log: test-results.log"
}

# Cleanup test environment
cleanup_test_env() {
    print_status "Cleaning up test environment..."
    
    # Stop test services
    docker-compose -f "$PROJECT_ROOT/docker-compose.test.yml" down -v 2>/dev/null || true
    
    # Clean up test files
    rm -rf "$PROJECT_ROOT/coverage" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/test-results.html" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/test-results.log" 2>/dev/null || true
    
    print_status "Test environment cleaned"
}

# Main execution based on command line arguments
case "${1:-all}" in
    "unit")
        setup_test_env
        run_unit_tests
        ;;
    "integration")
        setup_test_env
        run_integration_tests
        ;;
    "service")
        if [[ -z "${2:-}" ]]; then
            echo "Usage: $0 service <service-name>"
            echo "Example: $0 service auth-service"
            exit 1
        fi
        setup_test_env
        run_service_tests "$2"
        ;;
    "coverage")
        setup_test_env
        run_coverage_tests
        ;;
    "lint")
        run_lint
        ;;
    "typecheck")
        run_typecheck
        ;;
    "watch")
        run_watch_mode
        ;;
    "report")
        generate_test_report
        ;;
    "clean")
        cleanup_test_env
        ;;
    "all")
        run_all_tests
        ;;
    *)
        echo "AI Employee Platform Test Runner"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  unit         Run unit tests only"
        echo "  integration  Run integration tests only"
        echo "  service <name>  Run tests for specific service/app/package"
        echo "  coverage     Run tests with coverage report"
        echo "  lint         Run ESLint checks"
        echo "  typecheck    Run TypeScript type checking"
        echo "  watch        Run tests in watch mode"
        echo "  report       Generate comprehensive test report"
        echo "  clean        Clean up test environment and files"
        echo "  all          Run complete test suite (default)"
        echo ""
        echo "Examples:"
        echo "  $0 unit                    # Run all unit tests"
        echo "  $0 service auth-service    # Run auth service tests"
        echo "  $0 coverage               # Run with coverage"
        echo "  $0 watch                  # Development watch mode"
        exit 1
        ;;
esac
