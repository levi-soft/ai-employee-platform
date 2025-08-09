
#!/bin/bash

# API Testing Automation Script
# Comprehensive testing automation for AI Employee Platform API
# Created: 2025-08-08

set -euo pipefail

# =======================
# CONFIGURATION
# =======================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TESTS_DIR="${PROJECT_ROOT}/tests/api"
REPORTS_DIR="${PROJECT_ROOT}/test-reports"

# Create directories if they don't exist
mkdir -p "$REPORTS_DIR"

# Test configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
API_VERSION="${API_VERSION:-v1}"
NODE_ENV="${NODE_ENV:-test}"
TEST_TIMEOUT="${TEST_TIMEOUT:-30000}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =======================
# UTILITY FUNCTIONS
# =======================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case "$level" in
        "INFO")
            echo -e "${BLUE}[$timestamp] [INFO]${NC} $message"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[$timestamp] [SUCCESS]${NC} $message"
            ;;
        "WARN")
            echo -e "${YELLOW}[$timestamp] [WARN]${NC} $message"
            ;;
        "ERROR")
            echo -e "${RED}[$timestamp] [ERROR]${NC} $message"
            ;;
        *)
            echo "[$timestamp] [$level] $message"
            ;;
    esac
}

# Check if service is running
check_service_health() {
    local service_url="$1"
    local max_attempts=30
    local attempt=1
    
    log "INFO" "Checking service health at $service_url"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$service_url" > /dev/null 2>&1; then
            log "SUCCESS" "Service is healthy and responding"
            return 0
        fi
        
        log "WARN" "Service not ready (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    log "ERROR" "Service failed to become healthy after $max_attempts attempts"
    return 1
}

# Setup test environment
setup_test_environment() {
    log "INFO" "Setting up test environment"
    
    # Set environment variables
    export NODE_ENV="$NODE_ENV"
    export API_BASE_URL="$API_BASE_URL"
    export API_VERSION="$API_VERSION"
    export TEST_TIMEOUT="$TEST_TIMEOUT"
    
    # Install dependencies if needed
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        log "INFO" "Installing dependencies"
        cd "$PROJECT_ROOT"
        yarn install
    fi
    
    # Compile TypeScript if needed
    if [ -f "$PROJECT_ROOT/tsconfig.json" ]; then
        log "INFO" "Compiling TypeScript"
        cd "$PROJECT_ROOT"
        npx tsc --noEmit
    fi
    
    log "SUCCESS" "Test environment setup completed"
}

# Run specific test suite
run_test_suite() {
    local test_file="$1"
    local suite_name=$(basename "$test_file" .test.ts)
    
    log "INFO" "Running test suite: $suite_name"
    
    cd "$PROJECT_ROOT"
    
    # Run the test with detailed output
    if npx mocha "$test_file" \
        --timeout "$TEST_TIMEOUT" \
        --reporter spec \
        --require ts-node/register; then
        log "SUCCESS" "Test suite '$suite_name' passed"
        return 0
    else
        log "ERROR" "Test suite '$suite_name' failed"
        return 1
    fi
}

# Run all API tests
run_all_tests() {
    log "INFO" "Running all API tests"
    
    local failed_suites=()
    local total_suites=0
    
    # Find all test files
    for test_file in "$TESTS_DIR"/*.test.ts; do
        if [ -f "$test_file" ]; then
            ((total_suites++))
            if ! run_test_suite "$test_file"; then
                failed_suites+=("$(basename "$test_file")")
            fi
        fi
    done
    
    # Summary
    local passed_suites=$((total_suites - ${#failed_suites[@]}))
    
    echo
    echo "================================"
    echo "API TEST EXECUTION SUMMARY"
    echo "================================"
    echo "Total Suites: $total_suites"
    echo "Passed: $passed_suites"
    echo "Failed: ${#failed_suites[@]}"
    
    if [ ${#failed_suites[@]} -gt 0 ]; then
        echo
        echo "Failed Suites:"
        for suite in "${failed_suites[@]}"; do
            echo "  - $suite"
        done
        echo "================================"
        return 1
    else
        echo "================================"
        log "SUCCESS" "All API tests passed!"
        return 0
    fi
}

# Generate API documentation
generate_api_docs() {
    log "INFO" "Generating API documentation"
    
    local docs_output="${PROJECT_ROOT}/docs/generated/api"
    mkdir -p "$docs_output"
    
    # Generate Swagger UI
    if command -v swagger-codegen > /dev/null 2>&1; then
        swagger-codegen generate \
            -i "${PROJECT_ROOT}/docs/api/openapi.yaml" \
            -l html2 \
            -o "$docs_output"
        log "SUCCESS" "Swagger documentation generated"
    else
        log "WARN" "swagger-codegen not found, skipping HTML generation"
    fi
    
    # Copy OpenAPI spec
    cp "${PROJECT_ROOT}/docs/api/openapi.yaml" "$docs_output/"
    log "SUCCESS" "OpenAPI specification copied"
}

# Run performance tests
run_performance_tests() {
    log "INFO" "Running API performance tests"
    
    local endpoints=(
        "$API_BASE_URL/$API_VERSION/auth/health"
        "$API_BASE_URL/$API_VERSION/auth/login"
        "$API_BASE_URL/$API_VERSION/ai/agents"
    )
    
    for endpoint in "${endpoints[@]}"; do
        log "INFO" "Testing endpoint: $endpoint"
        
        # Simple curl-based performance test
        local response_time
        response_time=$(curl -o /dev/null -s -w '%{time_total}' "$endpoint" || echo "0")
        
        if (( $(echo "$response_time > 5.0" | bc -l) )); then
            log "WARN" "Endpoint $endpoint is slow: ${response_time}s"
        else
            log "SUCCESS" "Endpoint $endpoint responds in ${response_time}s"
        fi
    done
}

# Validate API responses
validate_api_responses() {
    log "INFO" "Validating API response formats"
    
    # Test health endpoint
    local health_response
    health_response=$(curl -s "$API_BASE_URL/$API_VERSION/auth/health")
    
    if echo "$health_response" | jq -e '.status' > /dev/null 2>&1; then
        log "SUCCESS" "Health endpoint returns valid JSON"
    else
        log "ERROR" "Health endpoint does not return valid JSON"
        return 1
    fi
    
    # Test OpenAPI spec validation
    if command -v swagger-cli > /dev/null 2>&1; then
        if swagger-cli validate "${PROJECT_ROOT}/docs/api/openapi.yaml"; then
            log "SUCCESS" "OpenAPI specification is valid"
        else
            log "ERROR" "OpenAPI specification validation failed"
            return 1
        fi
    else
        log "WARN" "swagger-cli not found, skipping OpenAPI validation"
    fi
}

# Generate test report
generate_test_report() {
    log "INFO" "Generating comprehensive test report"
    
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local report_file="${REPORTS_DIR}/api-test-report-${timestamp}.json"
    
    # Run tests with JSON reporter
    cd "$PROJECT_ROOT"
    
    local test_output
    if test_output=$(npx mocha "$TESTS_DIR"/*.test.ts \
        --timeout "$TEST_TIMEOUT" \
        --reporter json \
        --require ts-node/register 2>/dev/null); then
        echo "$test_output" > "$report_file"
        log "SUCCESS" "Test report generated: $report_file"
    else
        log "WARN" "Test execution completed with errors"
        echo "$test_output" > "$report_file"
    fi
    
    # Create latest report symlink
    ln -sf "$report_file" "${REPORTS_DIR}/latest-api-test-report.json"
}

# =======================
# MAIN FUNCTIONS
# =======================

# Full test suite execution
run_full_test_suite() {
    log "INFO" "Starting comprehensive API test suite"
    
    # Setup environment
    setup_test_environment
    
    # Check service health
    if ! check_service_health "$API_BASE_URL/$API_VERSION/auth/health"; then
        log "ERROR" "Service health check failed. Is the API server running?"
        return 1
    fi
    
    # Validate API responses
    validate_api_responses
    
    # Run all tests
    run_all_tests
    
    # Run performance tests
    run_performance_tests
    
    # Generate documentation
    generate_api_docs
    
    # Generate report
    generate_test_report
    
    log "SUCCESS" "Full test suite execution completed"
}

# Watch mode for development
run_watch_mode() {
    log "INFO" "Starting API tests in watch mode"
    
    setup_test_environment
    
    cd "$PROJECT_ROOT"
    npx mocha "$TESTS_DIR"/*.test.ts \
        --timeout "$TEST_TIMEOUT" \
        --watch \
        --require ts-node/register
}

# Show usage information
show_usage() {
    cat << EOF
AI Employee Platform API Testing Automation

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  full                  Run complete test suite with reporting
  auth                  Run authentication tests only  
  performance          Run performance tests only
  validate             Validate API responses and OpenAPI spec
  docs                 Generate API documentation only
  watch                Run tests in watch mode (development)
  report               Generate test report only
  help                 Show this help message

Options:
  --url <url>          API base URL (default: http://localhost:8080)
  --version <v>        API version (default: v1) 
  --timeout <ms>       Test timeout in milliseconds (default: 30000)
  --env <env>          Test environment (default: test)

Examples:
  $0 full                              # Run all tests
  $0 auth --url http://localhost:3001  # Run auth tests against different URL
  $0 performance --timeout 10000       # Run performance tests with custom timeout
  $0 watch                            # Development mode with file watching

Environment Variables:
  API_BASE_URL         Base URL for API testing
  API_VERSION          API version to test
  NODE_ENV             Test environment
  TEST_TIMEOUT         Test timeout in milliseconds

EOF
}

# =======================
# MAIN SCRIPT LOGIC
# =======================

main() {
    local command="${1:-full}"
    shift || true
    
    # Parse command line options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --url)
                API_BASE_URL="$2"
                shift 2
                ;;
            --version)
                API_VERSION="$2"
                shift 2
                ;;
            --timeout)
                TEST_TIMEOUT="$2"
                shift 2
                ;;
            --env)
                NODE_ENV="$2"
                shift 2
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    log "INFO" "API Testing Configuration:"
    log "INFO" "  Base URL: $API_BASE_URL"
    log "INFO" "  Version: $API_VERSION"
    log "INFO" "  Environment: $NODE_ENV"
    log "INFO" "  Timeout: $TEST_TIMEOUT ms"
    
    case "$command" in
        "full")
            run_full_test_suite
            ;;
        "auth")
            setup_test_environment
            check_service_health "$API_BASE_URL/$API_VERSION/auth/health"
            run_test_suite "$TESTS_DIR/auth-api.test.ts"
            ;;
        "performance")
            setup_test_environment
            check_service_health "$API_BASE_URL/$API_VERSION/auth/health"
            run_performance_tests
            ;;
        "validate")
            setup_test_environment
            validate_api_responses
            ;;
        "docs")
            generate_api_docs
            ;;
        "watch")
            run_watch_mode
            ;;
        "report")
            setup_test_environment
            generate_test_report
            ;;
        "help")
            show_usage
            ;;
        *)
            log "ERROR" "Invalid command: $command"
            show_usage
            exit 1
            ;;
    esac
}

# Execute main function with all arguments
main "$@"
