
#!/bin/bash

# Comprehensive Load Testing Script for AI Employee Platform
# Orchestrates all load tests and generates consolidated reports

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DIR="$PROJECT_ROOT/tests/performance"
RESULTS_DIR="$PROJECT_ROOT/test-reports/load-tests"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test configuration
API_BASE_URL=${API_BASE_URL:-"http://localhost:8080"}
CONCURRENT_USERS=${CONCURRENT_USERS:-1000}
TEST_DURATION=${TEST_DURATION:-300}
WARM_UP_TIME=${WARM_UP_TIME:-30}

# Create results directory
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}🚀 AI Employee Platform Load Testing Suite${NC}"
echo -e "${BLUE}===========================================${NC}"
echo -e "${GREEN}API URL: $API_BASE_URL${NC}"
echo -e "${GREEN}Concurrent Users: $CONCURRENT_USERS${NC}"
echo -e "${GREEN}Test Duration: $TEST_DURATION seconds${NC}"
echo ""

# Function to check service health
check_service_health() {
    echo -e "${YELLOW}🏥 Checking service health...${NC}"
    
    local services=(
        "auth:/api/auth/health"
        "ai-routing:/api/ai/health"
        "user-management:/api/users/health"
        "billing:/api/billing/health"
        "plugin-manager:/api/plugins/health"
        "notification:/api/notifications/health"
    )
    
    local healthy_services=0
    local total_services=${#services[@]}
    
    for service_info in "${services[@]}"; do
        IFS=':' read -ra parts <<< "$service_info"
        local service_name="${parts[0]}"
        local health_endpoint="${parts[1]}"
        
        echo -n "  Checking $service_name... "
        
        if curl -s -f "$API_BASE_URL$health_endpoint" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Healthy${NC}"
            healthy_services=$((healthy_services + 1))
        else
            echo -e "${RED}❌ Unhealthy${NC}"
        fi
    done
    
    echo ""
    echo -e "${GREEN}$healthy_services/$total_services services are healthy${NC}"
    
    if [ "$healthy_services" -lt "$total_services" ]; then
        echo -e "${YELLOW}⚠️  Some services are unhealthy. Continuing with available services...${NC}"
    fi
    
    return 0
}

# Function to warm up services
warm_up_services() {
    echo -e "${YELLOW}🔥 Warming up services for ${WARM_UP_TIME} seconds...${NC}"
    
    # Simple warm-up requests to each service
    local warm_up_end=$(($(date +%s) + WARM_UP_TIME))
    
    while [ $(date +%s) -lt $warm_up_end ]; do
        # Auth service warm-up
        curl -s "$API_BASE_URL/api/auth/health" > /dev/null 2>&1 &
        
        # AI routing warm-up (if available)
        curl -s "$API_BASE_URL/api/ai/health" > /dev/null 2>&1 &
        
        # User management warm-up
        curl -s "$API_BASE_URL/api/users/health" > /dev/null 2>&1 &
        
        sleep 2
    done
    
    wait
    echo -e "${GREEN}✅ Services warmed up${NC}"
    echo ""
}

# Function to run individual load test
run_load_test() {
    local test_name=$1
    local test_file=$2
    local additional_args="${3:-}"
    
    echo -e "${BLUE}🔬 Running $test_name...${NC}"
    echo "Test file: $test_file"
    
    if [ ! -f "$test_file" ]; then
        echo -e "${RED}❌ Test file not found: $test_file${NC}"
        return 1
    fi
    
    # Set environment variables for the test
    export API_BASE_URL="$API_BASE_URL"
    export CONCURRENT_USERS="$CONCURRENT_USERS"
    export TEST_DURATION="$TEST_DURATION"
    
    # Run the test
    local test_start=$(date +%s)
    
    if command -v node >/dev/null 2>&1; then
        if eval "cd '$TEST_DIR' && node '$test_file' $additional_args"; then
            local test_end=$(date +%s)
            local test_duration=$((test_end - test_start))
            echo -e "${GREEN}✅ $test_name completed in ${test_duration}s${NC}"
            return 0
        else
            echo -e "${RED}❌ $test_name failed${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ Node.js not found. Cannot run $test_name${NC}"
        return 1
    fi
}

# Function to run system profiling during tests
run_system_profiling() {
    local duration=$1
    
    echo -e "${YELLOW}📊 Starting system profiling for ${duration}s...${NC}"
    
    local profiler_file="$TEST_DIR/profiling/system-profiler.js"
    
    if [ -f "$profiler_file" ] && command -v node >/dev/null 2>&1; then
        # Start profiler in background
        cd "$TEST_DIR" && node "$profiler_file" "$RESULTS_DIR" "$((duration * 1000))" &
        local profiler_pid=$!
        
        echo "System profiler started with PID $profiler_pid"
        return 0
    else
        echo -e "${YELLOW}⚠️  System profiler not available${NC}"
        return 1
    fi
}

# Function to install test dependencies
install_test_dependencies() {
    echo -e "${YELLOW}📦 Checking test dependencies...${NC}"
    
    cd "$PROJECT_ROOT"
    
    # Check if package.json exists
    if [ -f "package.json" ]; then
        # Install dependencies if needed
        if ! npm list axios >/dev/null 2>&1; then
            echo "Installing axios..."
            npm install axios --save-dev
        fi
        
        if ! npm list ws >/dev/null 2>&1; then
            echo "Installing ws..."
            npm install ws --save-dev
        fi
        
        if ! npm list pidusage >/dev/null 2>&1; then
            echo "Installing pidusage..."
            npm install pidusage --save-dev
        fi
    else
        echo -e "${YELLOW}⚠️  No package.json found in project root${NC}"
    fi
    
    echo -e "${GREEN}✅ Dependencies checked${NC}"
}

# Function to generate consolidated report
generate_consolidated_report() {
    local report_file="$RESULTS_DIR/load-test-summary-$TIMESTAMP.md"
    
    echo -e "${BLUE}📊 Generating consolidated report...${NC}"
    
    cat > "$report_file" << EOF
# AI Employee Platform Load Test Summary

**Test Run**: $(date)
**Configuration**:
- API Base URL: $API_BASE_URL
- Concurrent Users: $CONCURRENT_USERS
- Test Duration: $TEST_DURATION seconds
- Warm-up Time: $WARM_UP_TIME seconds

## Test Results Overview

EOF
    
    # Check for individual test results
    local results_found=0
    
    # Auth service results
    local auth_results=$(find "$RESULTS_DIR" -name "auth-load-test-*.json" -newer "$0" 2>/dev/null | head -1)
    if [ -n "$auth_results" ] && [ -f "$auth_results" ]; then
        echo "### Authentication Service Load Test" >> "$report_file"
        echo "" >> "$report_file"
        
        # Extract key metrics using jq if available, otherwise use basic parsing
        if command -v jq >/dev/null 2>&1; then
            local total_req=$(jq -r '.totalRequests' "$auth_results" 2>/dev/null || echo "N/A")
            local success_req=$(jq -r '.successfulRequests' "$auth_results" 2>/dev/null || echo "N/A")
            local throughput=$(jq -r '.throughput' "$auth_results" 2>/dev/null || echo "N/A")
            local p95_time=$(jq -r '.responseTimePercentiles.p95' "$auth_results" 2>/dev/null || echo "N/A")
            
            echo "- Total Requests: $total_req" >> "$report_file"
            echo "- Successful Requests: $success_req" >> "$report_file"
            echo "- Throughput: $throughput req/sec" >> "$report_file"
            echo "- P95 Response Time: $p95_time ms" >> "$report_file"
        else
            echo "- Results file: $auth_results" >> "$report_file"
        fi
        
        echo "" >> "$report_file"
        results_found=$((results_found + 1))
    fi
    
    # AI routing results
    local ai_results=$(find "$RESULTS_DIR" -name "ai-routing-load-test-*.json" -newer "$0" 2>/dev/null | head -1)
    if [ -n "$ai_results" ] && [ -f "$ai_results" ]; then
        echo "### AI Routing Service Load Test" >> "$report_file"
        echo "" >> "$report_file"
        
        if command -v jq >/dev/null 2>&1; then
            local total_req=$(jq -r '.totalRequests' "$ai_results" 2>/dev/null || echo "N/A")
            local success_req=$(jq -r '.successfulRequests' "$ai_results" 2>/dev/null || echo "N/A")
            local timeout_req=$(jq -r '.timeoutRequests' "$ai_results" 2>/dev/null || echo "N/A")
            local throughput=$(jq -r '.throughput' "$ai_results" 2>/dev/null || echo "N/A")
            
            echo "- Total Requests: $total_req" >> "$report_file"
            echo "- Successful Requests: $success_req" >> "$report_file"
            echo "- Timeout Requests: $timeout_req" >> "$report_file"
            echo "- Throughput: $throughput req/sec" >> "$report_file"
        else
            echo "- Results file: $ai_results" >> "$report_file"
        fi
        
        echo "" >> "$report_file"
        results_found=$((results_found + 1))
    fi
    
    # System profiling results
    local profile_results=$(find "$RESULTS_DIR" -name "system-profile-*.json" -newer "$0" 2>/dev/null | head -1)
    if [ -n "$profile_results" ] && [ -f "$profile_results" ]; then
        echo "### System Performance Profile" >> "$report_file"
        echo "" >> "$report_file"
        echo "- Profile file: $profile_results" >> "$report_file"
        
        # Try to extract summary if jq is available
        if command -v jq >/dev/null 2>&1; then
            local avg_cpu=$(jq -r '.analysis.averages.cpu' "$profile_results" 2>/dev/null || echo "N/A")
            local peak_cpu=$(jq -r '.analysis.peaks.cpu' "$profile_results" 2>/dev/null || echo "N/A")
            local avg_memory=$(jq -r '.analysis.averages.memory' "$profile_results" 2>/dev/null || echo "N/A")
            local peak_memory=$(jq -r '.analysis.peaks.memory' "$profile_results" 2>/dev/null || echo "N/A")
            
            echo "- Average CPU Usage: $avg_cpu%" >> "$report_file"
            echo "- Peak CPU Usage: $peak_cpu%" >> "$report_file"
            echo "- Average Memory Usage: $avg_memory%" >> "$report_file"
            echo "- Peak Memory Usage: $peak_memory%" >> "$report_file"
        fi
        
        echo "" >> "$report_file"
        results_found=$((results_found + 1))
    fi
    
    # Summary
    echo "## Summary" >> "$report_file"
    echo "" >> "$report_file"
    
    if [ "$results_found" -gt 0 ]; then
        echo "✅ Successfully completed load testing with $results_found test suites." >> "$report_file"
        echo "" >> "$report_file"
        echo "### Files Generated:" >> "$report_file"
        ls -la "$RESULTS_DIR"/*-$TIMESTAMP* 2>/dev/null | awk '{print "- " $9}' >> "$report_file" || true
    else
        echo "⚠️ No test results found. Check individual test logs for details." >> "$report_file"
    fi
    
    echo "" >> "$report_file"
    echo "Generated at: $(date)" >> "$report_file"
    
    echo -e "${GREEN}📄 Consolidated report saved to: $report_file${NC}"
}

# Function to cleanup background processes
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    
    # Kill any background profiler processes
    pkill -f "system-profiler.js" 2>/dev/null || true
    
    # Wait for any remaining background jobs
    jobs -p | xargs -r kill 2>/dev/null || true
    wait 2>/dev/null || true
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# Main execution
main() {
    # Change to project root
    cd "$PROJECT_ROOT"
    
    # Install dependencies
    install_test_dependencies
    
    # Check service health
    check_service_health
    
    # Warm up services
    warm_up_services
    
    # Start system profiling
    local profile_duration=$((TEST_DURATION + 60))  # Extra time for test setup/teardown
    run_system_profiling "$profile_duration"
    
    echo -e "${GREEN}🏃‍♂️ Starting load tests...${NC}"
    echo ""
    
    local tests_passed=0
    local tests_failed=0
    
    # Run authentication service load test
    if run_load_test "Authentication Service Load Test" "$TEST_DIR/load-tests/auth-service-load.test.js"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    # Run AI routing service load test (if auth test passed)
    if [ "$tests_passed" -gt 0 ]; then
        if run_load_test "AI Routing Service Load Test" "$TEST_DIR/load-tests/ai-routing-load.test.js"; then
            tests_passed=$((tests_passed + 1))
        else
            tests_failed=$((tests_failed + 1))
        fi
    else
        echo -e "${YELLOW}⏭️ Skipping AI routing test due to auth test failure${NC}"
    fi
    
    echo ""
    
    # Wait a bit for profiling to complete
    sleep 5
    
    # Generate consolidated report
    generate_consolidated_report
    
    echo ""
    echo -e "${GREEN}🎉 Load testing completed!${NC}"
    echo -e "${GREEN}✅ Tests passed: $tests_passed${NC}"
    if [ "$tests_failed" -gt 0 ]; then
        echo -e "${RED}❌ Tests failed: $tests_failed${NC}"
    fi
    echo -e "${GREEN}📊 Results directory: $RESULTS_DIR${NC}"
    
    # Exit with appropriate code
    if [ "$tests_failed" -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# Help function
show_help() {
    cat << EOF
AI Employee Platform Load Testing Script

Usage: $0 [OPTIONS]

Options:
  -u, --url URL          API base URL (default: http://localhost:8080)
  -c, --users NUMBER     Number of concurrent users (default: 1000)
  -d, --duration SECONDS Test duration in seconds (default: 300)
  -w, --warmup SECONDS   Warm-up time in seconds (default: 30)
  -h, --help            Show this help message

Environment Variables:
  API_BASE_URL          Override API base URL
  CONCURRENT_USERS      Override number of concurrent users
  TEST_DURATION         Override test duration
  WARM_UP_TIME         Override warm-up time

Examples:
  $0                                    # Run with defaults
  $0 -c 500 -d 180                    # 500 users for 3 minutes
  $0 -u http://staging-api.example.com # Test staging environment
  API_BASE_URL=http://localhost:3000 $0 # Use environment variable

Output:
  - Individual test results in JSON format
  - System profiling data
  - Consolidated markdown report
  - All files timestamped and saved to test-reports/load-tests/
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            API_BASE_URL="$2"
            shift 2
            ;;
        -c|--users)
            CONCURRENT_USERS="$2"
            shift 2
            ;;
        -d|--duration)
            TEST_DURATION="$2"
            shift 2
            ;;
        -w|--warmup)
            WARM_UP_TIME="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Validate arguments
if ! [[ "$CONCURRENT_USERS" =~ ^[0-9]+$ ]] || [ "$CONCURRENT_USERS" -lt 1 ]; then
    echo -e "${RED}❌ Error: CONCURRENT_USERS must be a positive integer${NC}"
    exit 1
fi

if ! [[ "$TEST_DURATION" =~ ^[0-9]+$ ]] || [ "$TEST_DURATION" -lt 10 ]; then
    echo -e "${RED}❌ Error: TEST_DURATION must be at least 10 seconds${NC}"
    exit 1
fi

if ! [[ "$WARM_UP_TIME" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}❌ Error: WARM_UP_TIME must be a non-negative integer${NC}"
    exit 1
fi

# Run main function
main "$@"
