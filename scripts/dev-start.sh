
#!/bin/bash

# AI Employee Platform - Development Environment Startup Script
# Subtask 1.12: Development Workflow Optimization

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
STARTUP_TIMEOUT=120
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}🚀 AI Employee Platform - Development Environment Startup${NC}"
echo -e "${BLUE}===================================================${NC}"

# Function to print status
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check service health
check_service_health() {
    local service_name=$1
    local health_url=$2
    local max_attempts=30
    local attempt=1

    print_status "Checking health of $service_name..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$health_url" | grep -q "200"; then
            print_success "$service_name is healthy!"
            return 0
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    print_error "$service_name health check failed after $max_attempts attempts"
    return 1
}

# Function to start services with hot reload
start_services() {
    print_status "Starting services with hot reload..."
    
    # Start infrastructure (database, redis, etc.)
    print_status "Starting infrastructure services..."
    docker-compose up -d postgres redis
    
    # Wait for database to be ready
    print_status "Waiting for database to be ready..."
    sleep 10
    
    # Run database migrations
    print_status "Running database migrations..."
    cd "$PROJECT_ROOT/database"
    npm run migrate:dev || print_warning "Database migrations may have already been applied"
    
    # Start backend services with nodemon
    print_status "Starting backend services with hot reload..."
    cd "$PROJECT_ROOT"
    
    # Start auth service
    print_status "Starting auth service..."
    cd "$PROJECT_ROOT/services/auth-service"
    npm run dev &
    AUTH_PID=$!
    
    # Start other services (placeholder for when they're implemented)
    # cd "$PROJECT_ROOT/services/ai-routing-service" && npm run dev &
    # cd "$PROJECT_ROOT/services/billing-service" && npm run dev &
    # cd "$PROJECT_ROOT/services/user-management-service" && npm run dev &
    
    # Start frontend applications
    print_status "Starting frontend applications..."
    cd "$PROJECT_ROOT/apps/admin-dashboard"
    npm run dev &
    ADMIN_PID=$!
    
    cd "$PROJECT_ROOT/apps/employee-portal"
    npm run dev &
    PORTAL_PID=$!
    
    # Store PIDs for cleanup
    echo "$AUTH_PID $ADMIN_PID $PORTAL_PID" > "$PROJECT_ROOT/.dev-pids"
    
    print_success "All services started with hot reload!"
}

# Function to wait for services
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for auth service
    check_service_health "Auth Service" "http://localhost:3001/health"
    
    # Wait for admin dashboard
    check_service_health "Admin Dashboard" "http://localhost:3000"
    
    # Wait for employee portal
    check_service_health "Employee Portal" "http://localhost:3002"
    
    print_success "All services are ready!"
}

# Function to display service URLs
display_urls() {
    echo -e "\n${PURPLE}📋 Service URLs:${NC}"
    echo -e "${CYAN}🔐 Auth Service:      ${NC}http://localhost:3001"
    echo -e "${CYAN}⚡ Admin Dashboard:   ${NC}http://localhost:3000"
    echo -e "${CYAN}👥 Employee Portal:   ${NC}http://localhost:3002"
    echo -e "${CYAN}📊 API Gateway:       ${NC}http://localhost:8080"
    echo -e "${CYAN}🔍 API Docs:          ${NC}http://localhost:8080/api-docs"
    echo -e "\n${PURPLE}📋 Database URLs:${NC}"
    echo -e "${CYAN}🗄️  PostgreSQL:       ${NC}localhost:5432 (ai_platform_db)"
    echo -e "${CYAN}🔴 Redis:             ${NC}localhost:6379"
    echo -e "\n${GREEN}✨ Development environment is ready!${NC}"
    echo -e "${YELLOW}💡 Use Ctrl+C to stop all services${NC}"
}

# Function to cleanup on exit
cleanup() {
    print_status "Cleaning up development environment..."
    
    # Read PIDs and kill them
    if [ -f "$PROJECT_ROOT/.dev-pids" ]; then
        PIDS=$(cat "$PROJECT_ROOT/.dev-pids")
        for pid in $PIDS; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done
        rm "$PROJECT_ROOT/.dev-pids"
    fi
    
    # Stop any remaining processes
    pkill -f "nodemon" || true
    pkill -f "next dev" || true
    
    print_success "Development environment stopped!"
    exit 0
}

# Function to show help
show_help() {
    echo -e "${BLUE}AI Employee Platform - Development Startup Script${NC}"
    echo ""
    echo -e "${YELLOW}Usage:${NC} $0 [OPTIONS]"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo "  -h, --help     Show this help message"
    echo "  --quick        Skip health checks (faster startup)"
    echo "  --no-frontend  Start only backend services"
    echo "  --clean        Clean install dependencies before starting"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0              # Full development startup"
    echo "  $0 --quick      # Quick startup without health checks"
    echo "  $0 --clean      # Clean install and start"
}

# Main execution
main() {
    local quick_start=false
    local no_frontend=false
    local clean_install=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            --quick)
                quick_start=true
                shift
                ;;
            --no-frontend)
                no_frontend=true
                shift
                ;;
            --clean)
                clean_install=true
                shift
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Trap cleanup on exit
    trap cleanup INT TERM EXIT
    
    # Pre-flight checks
    print_status "Running pre-flight checks..."
    
    # Check required commands
    local required_commands=("node" "npm" "docker" "docker-compose" "curl")
    for cmd in "${required_commands[@]}"; do
        if ! command_exists "$cmd"; then
            print_error "Required command not found: $cmd"
            exit 1
        fi
    done
    
    # Check if ports are available
    local required_ports=(3000 3001 3002 5432 6379 8080)
    for port in "${required_ports[@]}"; do
        if lsof -i ":$port" >/dev/null 2>&1; then
            print_warning "Port $port is already in use"
        fi
    done
    
    # Clean install if requested
    if [ "$clean_install" = true ]; then
        print_status "Clean installing dependencies..."
        cd "$PROJECT_ROOT"
        rm -rf node_modules
        npm install
        
        # Install service dependencies
        cd "$PROJECT_ROOT/services/auth-service"
        rm -rf node_modules
        npm install
        
        cd "$PROJECT_ROOT/apps/admin-dashboard"
        rm -rf node_modules
        npm install
        
        cd "$PROJECT_ROOT/apps/employee-portal"
        rm -rf node_modules
        npm install
    fi
    
    # Start services
    start_services
    
    # Wait for services (unless quick start)
    if [ "$quick_start" = false ]; then
        sleep 15  # Give services time to start
        wait_for_services
    else
        print_status "Skipping health checks (quick start mode)"
        sleep 10
    fi
    
    # Display service information
    display_urls
    
    # Keep script running
    print_status "Development environment running. Press Ctrl+C to stop."
    while true; do
        sleep 1
    done
}

# Run main function
main "$@"
