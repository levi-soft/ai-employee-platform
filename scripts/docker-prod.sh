
#!/bin/bash

# AI Employee Platform - Production Docker Management Script
# This script provides easy commands to manage the production environment

set -e

PROJECT_NAME="ai-employee-platform"
COMPOSE_FILE="docker-compose.yml"
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
AI Employee Platform - Production Docker Management

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    deploy          Deploy production environment
    stop            Stop all services
    restart         Restart all services
    build           Build all containers
    rebuild         Rebuild all containers from scratch
    logs [service]  Show logs for all services or specific service
    status          Show status of all containers
    backup          Create backup of database and volumes
    restore         Restore from backup
    health          Check health of all services
    scale [service] [count]  Scale service to specified count

Production Commands:
    deploy          Full production deployment
    rollback        Rollback to previous version
    update [service] Update specific service

Examples:
    $0 deploy                   # Full production deployment
    $0 scale auth-service 3     # Scale auth service to 3 replicas
    $0 backup                   # Create system backup

EOF
}

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Function to check environment variables
check_env() {
    if [ ! -f ".env" ]; then
        log_warning ".env file not found. Creating from template..."
        if [ -f ".env.example" ]; then
            cp ".env.example" ".env"
            log_info "Please configure the .env file before deployment."
        else
            log_error "No .env.example found. Please create .env file manually."
            exit 1
        fi
    fi
}

# Function to deploy production environment
deploy_production() {
    log_info "Deploying production environment..."
    check_env
    
    # Build containers
    docker-compose build --parallel
    
    # Start services with restart policy
    docker-compose up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to become healthy..."
    sleep 30
    check_health
    
    log_success "Production deployment completed!"
    log_info "Access points:"
    echo "  - Admin Dashboard: http://localhost:3000"
    echo "  - Employee Portal: http://localhost:3100"
    echo "  - API Gateway: http://localhost:8080"
}

# Function to create backup
create_backup() {
    BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    log_info "Creating backup in $BACKUP_DIR..."
    
    # Backup database
    docker-compose exec postgres pg_dump -U postgres ai_employee_platform > "$BACKUP_DIR/database.sql"
    
    # Backup volumes
    docker run --rm -v ai-employee-platform_postgres_data:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf /backup/postgres_data.tar.gz -C /data .
    docker run --rm -v ai-employee-platform_redis_data:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf /backup/redis_data.tar.gz -C /data .
    
    log_success "Backup created in $BACKUP_DIR"
}

# Function to check health of all services
check_health() {
    log_info "Checking health of all services..."
    services=("postgres" "redis" "auth-service" "ai-routing-service" "billing-service" 
              "user-management-service" "plugin-manager-service" "notification-service"
              "admin-dashboard" "employee-portal" "nginx")
    
    all_healthy=true
    for service in "${services[@]}"; do
        health_status=$(docker-compose ps -q "$service" | xargs docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || echo "no-healthcheck")
        if [ "$health_status" = "healthy" ]; then
            log_success "$service: healthy"
        elif [ "$health_status" = "no-healthcheck" ]; then
            log_warning "$service: no health check configured"
        else
            log_error "$service: $health_status"
            all_healthy=false
        fi
    done
    
    if [ "$all_healthy" = true ]; then
        log_success "All services are healthy!"
    else
        log_error "Some services are not healthy. Check the logs."
    fi
}

# Function to scale services
scale_service() {
    if [ -z "$1" ] || [ -z "$2" ]; then
        log_error "Usage: scale [service] [count]"
        exit 1
    fi
    
    log_info "Scaling $1 to $2 replicas..."
    docker-compose up -d --scale "$1=$2"
    log_success "Service $1 scaled to $2 replicas"
}

# Main script logic
case "${1:-}" in
    "deploy")
        check_docker
        deploy_production
        ;;
    "stop")
        check_docker
        docker-compose down
        ;;
    "restart")
        check_docker
        docker-compose restart
        ;;
    "build")
        check_docker
        docker-compose build --parallel
        ;;
    "rebuild")
        check_docker
        docker-compose down
        docker-compose build --no-cache --parallel
        docker-compose up -d
        ;;
    "logs")
        check_docker
        if [ -n "$2" ]; then
            docker-compose logs -f "$2"
        else
            docker-compose logs -f
        fi
        ;;
    "status")
        check_docker
        docker-compose ps
        ;;
    "backup")
        check_docker
        create_backup
        ;;
    "health")
        check_docker
        check_health
        ;;
    "scale")
        check_docker
        scale_service "$2" "$3"
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
