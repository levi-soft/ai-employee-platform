
#!/bin/bash

# AI Employee Platform - Development Docker Management Script
# This script provides easy commands to manage the development environment

set -e

PROJECT_NAME="ai-employee-platform"
COMPOSE_FILE="infrastructure/docker/docker-compose.dev.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

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

# Function to show usage
show_usage() {
    cat << EOF
AI Employee Platform - Development Docker Management

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    start           Start all development services
    stop            Stop all services
    restart         Restart all services
    build           Build all containers
    rebuild         Rebuild all containers from scratch
    logs [service]  Show logs for all services or specific service
    status          Show status of all containers
    clean           Remove all containers, volumes, and images
    shell [service] Open shell in running service container
    db-shell        Open PostgreSQL shell
    redis-shell     Open Redis shell
    health          Check health of all services
    setup           Initial setup (build and start)

Service Names:
    postgres, redis, auth-service, ai-routing-service, billing-service,
    user-management-service, plugin-manager-service, notification-service,
    admin-dashboard, employee-portal, nginx

Examples:
    $0 start                    # Start all services
    $0 logs auth-service        # Show auth service logs
    $0 shell auth-service       # Open shell in auth service
    $0 rebuild                  # Rebuild and restart all services

EOF
}

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Function to check if compose file exists
check_compose_file() {
    if [ ! -f "$COMPOSE_FILE" ]; then
        log_error "Docker compose file not found: $COMPOSE_FILE"
        exit 1
    fi
}

# Function to start services
start_services() {
    log_info "Starting development services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    log_success "Services started successfully!"
    log_info "Access points:"
    echo "  - Admin Dashboard: http://localhost:3000"
    echo "  - Employee Portal: http://localhost:3100"
    echo "  - API Gateway: http://localhost:8080"
    echo "  - PostgreSQL: localhost:5432"
    echo "  - Redis: localhost:6379"
}

# Function to stop services
stop_services() {
    log_info "Stopping all services..."
    docker-compose -f "$COMPOSE_FILE" down
    log_success "Services stopped successfully!"
}

# Function to restart services
restart_services() {
    log_info "Restarting all services..."
    docker-compose -f "$COMPOSE_FILE" restart
    log_success "Services restarted successfully!"
}

# Function to build containers
build_containers() {
    log_info "Building all containers..."
    docker-compose -f "$COMPOSE_FILE" build --parallel
    log_success "Containers built successfully!"
}

# Function to rebuild containers
rebuild_containers() {
    log_info "Rebuilding all containers from scratch..."
    docker-compose -f "$COMPOSE_FILE" down
    docker-compose -f "$COMPOSE_FILE" build --no-cache --parallel
    docker-compose -f "$COMPOSE_FILE" up -d
    log_success "Containers rebuilt and started successfully!"
}

# Function to show logs
show_logs() {
    if [ -n "$1" ]; then
        log_info "Showing logs for service: $1"
        docker-compose -f "$COMPOSE_FILE" logs -f "$1"
    else
        log_info "Showing logs for all services"
        docker-compose -f "$COMPOSE_FILE" logs -f
    fi
}

# Function to show container status
show_status() {
    log_info "Container status:"
    docker-compose -f "$COMPOSE_FILE" ps
}

# Function to clean up everything
clean_all() {
    log_warning "This will remove all containers, volumes, and images. Are you sure? (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        log_info "Cleaning up all Docker resources..."
        docker-compose -f "$COMPOSE_FILE" down -v --rmi all
        docker system prune -f
        log_success "Cleanup completed!"
    else
        log_info "Cleanup cancelled."
    fi
}

# Function to open shell in service
open_shell() {
    if [ -z "$1" ]; then
        log_error "Please specify a service name"
        exit 1
    fi
    
    log_info "Opening shell in $1..."
    docker-compose -f "$COMPOSE_FILE" exec "$1" /bin/sh
}

# Function to open database shell
open_db_shell() {
    log_info "Opening PostgreSQL shell..."
    docker-compose -f "$COMPOSE_FILE" exec postgres psql -U postgres -d ai_employee_platform
}

# Function to open Redis shell
open_redis_shell() {
    log_info "Opening Redis shell..."
    docker-compose -f "$COMPOSE_FILE" exec redis redis-cli
}

# Function to check health of all services
check_health() {
    log_info "Checking health of all services..."
    services=("postgres" "redis" "auth-service" "ai-routing-service" "billing-service" 
              "user-management-service" "plugin-manager-service" "notification-service"
              "admin-dashboard" "employee-portal" "nginx")
    
    for service in "${services[@]}"; do
        health_status=$(docker-compose -f "$COMPOSE_FILE" ps -q "$service" | xargs docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || echo "no-healthcheck")
        if [ "$health_status" = "healthy" ]; then
            log_success "$service: healthy"
        elif [ "$health_status" = "no-healthcheck" ]; then
            log_warning "$service: no health check configured"
        else
            log_error "$service: $health_status"
        fi
    done
}

# Function for initial setup
initial_setup() {
    log_info "Running initial setup..."
    build_containers
    start_services
    sleep 10
    check_health
    log_success "Initial setup completed!"
}

# Main script logic
case "${1:-}" in
    "start")
        check_docker
        check_compose_file
        start_services
        ;;
    "stop")
        check_docker
        check_compose_file
        stop_services
        ;;
    "restart")
        check_docker
        check_compose_file
        restart_services
        ;;
    "build")
        check_docker
        check_compose_file
        build_containers
        ;;
    "rebuild")
        check_docker
        check_compose_file
        rebuild_containers
        ;;
    "logs")
        check_docker
        check_compose_file
        show_logs "$2"
        ;;
    "status")
        check_docker
        check_compose_file
        show_status
        ;;
    "clean")
        check_docker
        check_compose_file
        clean_all
        ;;
    "shell")
        check_docker
        check_compose_file
        open_shell "$2"
        ;;
    "db-shell")
        check_docker
        check_compose_file
        open_db_shell
        ;;
    "redis-shell")
        check_docker
        check_compose_file
        open_redis_shell
        ;;
    "health")
        check_docker
        check_compose_file
        check_health
        ;;
    "setup")
        check_docker
        check_compose_file
        initial_setup
        ;;
    "help"|"-h"|"--help"|"")
        show_usage
        ;;
    *)
        log_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac
