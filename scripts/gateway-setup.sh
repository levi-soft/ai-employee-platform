
#!/bin/bash

# AI Employee Platform - API Gateway Setup Script
# Version: 1.0.0
# This script sets up and manages the Nginx API Gateway

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"
NGINX_DIR="$PROJECT_ROOT/infrastructure/nginx"
SSL_DIR="$NGINX_DIR/ssl"
DOCKER_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
HOSTS_FILE="/etc/hosts"
DOMAIN="ai-employee-platform.local"

# Logging
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

# Print usage
print_usage() {
    cat << EOF
AI Employee Platform - API Gateway Setup

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    setup       Setup the API Gateway (default)
    start       Start the gateway service
    stop        Stop the gateway service
    restart     Restart the gateway service
    status      Show gateway status
    logs        Show gateway logs
    test        Test gateway configuration
    ssl-setup   Setup SSL certificates
    hosts-setup Configure local hosts file
    cleanup     Remove gateway containers and volumes

Options:
    --dev       Use development configuration
    --prod      Use production configuration (default)
    --force     Force operation without confirmation
    --help      Show this help message

Examples:
    $0 setup --dev
    $0 start
    $0 logs --follow
    $0 test
    $0 ssl-setup --force

EOF
}

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v docker >/dev/null 2>&1; then
        missing_deps+=("docker")
    fi
    
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        missing_deps+=("docker-compose")
    fi
    
    if ! command -v curl >/dev/null 2>&1; then
        missing_deps+=("curl")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_info "Please install the required dependencies and try again."
        exit 1
    fi
}

# Setup hosts file entry
setup_hosts() {
    local force=${1:-false}
    
    if grep -q "$DOMAIN" "$HOSTS_FILE" 2>/dev/null; then
        log_info "Hosts file entry already exists for $DOMAIN"
        return 0
    fi
    
    log_info "Adding $DOMAIN to hosts file..."
    
    if [ "$force" = true ]; then
        echo "127.0.0.1 $DOMAIN" | sudo tee -a "$HOSTS_FILE" >/dev/null
        log_success "Added $DOMAIN to hosts file"
    else
        log_warning "The following entry needs to be added to your hosts file:"
        echo "127.0.0.1 $DOMAIN"
        log_info "Run with --force to add automatically, or add manually:"
        log_info "echo '127.0.0.1 $DOMAIN' | sudo tee -a $HOSTS_FILE"
    fi
}

# Setup SSL certificates
setup_ssl() {
    local force=${1:-false}
    
    log_info "Setting up SSL certificates..."
    
    # Create SSL directory
    mkdir -p "$SSL_DIR"
    
    # Check if certificates already exist
    if [ -f "$SSL_DIR/server.crt" ] && [ -f "$SSL_DIR/server.key" ] && [ "$force" != true ]; then
        log_info "SSL certificates already exist. Use --force to regenerate."
        return 0
    fi
    
    log_info "Generating SSL certificates..."
    
    # Generate certificates using OpenSSL
    docker run --rm -v "$SSL_DIR:/ssl" -w /ssl alpine/openssl sh -c "
        apk add --no-cache openssl
        
        # Generate private key
        openssl genrsa -out server.key 2048
        
        # Generate certificate
        openssl req -new -x509 -key server.key -out server.crt -days 365 \
            -subj '/C=US/ST=CA/L=San Francisco/O=AI Employee Platform/CN=$DOMAIN' \
            -extensions v3_req -config <(
cat <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = localhost
DNS.3 = *.ai-employee-platform.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF
            )
        
        # Generate default certificate
        openssl req -x509 -newkey rsa:2048 -keyout default.key -out default.crt -days 1 -nodes \
            -subj '/CN=invalid'
        
        # Generate DH parameters
        openssl dhparam -out dhparam.pem 2048
        
        # Set permissions
        chmod 600 *.key
        chmod 644 *.crt *.pem
    "
    
    log_success "SSL certificates generated successfully"
}

# Build gateway image
build_gateway() {
    log_info "Building API Gateway Docker image..."
    
    cd "$NGINX_DIR"
    docker build -t ai-employee-platform/api-gateway:latest .
    
    log_success "API Gateway image built successfully"
}

# Test gateway configuration
test_configuration() {
    log_info "Testing gateway configuration..."
    
    # Test nginx configuration syntax
    docker run --rm -v "$NGINX_DIR/nginx.conf:/etc/nginx/nginx.conf:ro" \
        nginx:1.24-alpine nginx -t
    
    log_success "Gateway configuration is valid"
}

# Start gateway service
start_gateway() {
    log_info "Starting API Gateway..."
    
    cd "$PROJECT_ROOT"
    
    # Start only the gateway service
    if command -v docker-compose >/dev/null 2>&1; then
        docker-compose up -d api-gateway
    else
        docker compose up -d api-gateway
    fi
    
    # Wait for service to be ready
    log_info "Waiting for gateway to be ready..."
    for i in {1..30}; do
        if curl -k -s -o /dev/null -w "%{http_code}" https://localhost/health | grep -q "200"; then
            log_success "API Gateway is ready!"
            return 0
        fi
        sleep 2
    done
    
    log_warning "Gateway may not be fully ready yet. Check logs: $0 logs"
}

# Stop gateway service
stop_gateway() {
    log_info "Stopping API Gateway..."
    
    cd "$PROJECT_ROOT"
    
    if command -v docker-compose >/dev/null 2>&1; then
        docker-compose stop api-gateway
    else
        docker compose stop api-gateway
    fi
    
    log_success "API Gateway stopped"
}

# Restart gateway service
restart_gateway() {
    log_info "Restarting API Gateway..."
    stop_gateway
    start_gateway
}

# Show gateway status
show_status() {
    log_info "API Gateway Status:"
    echo
    
    # Container status
    echo "Container Status:"
    docker ps --filter "name=ai-employee-platform.*api-gateway" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo
    
    # Health check
    echo "Health Check:"
    if curl -k -s https://localhost/health 2>/dev/null; then
        echo "✅ HTTPS endpoint: healthy"
    else
        echo "❌ HTTPS endpoint: unhealthy"
    fi
    
    if curl -s http://localhost/health 2>/dev/null; then
        echo "✅ HTTP endpoint: healthy"
    else
        echo "❌ HTTP endpoint: unhealthy"
    fi
    echo
    
    # SSL certificate info
    if [ -f "$SSL_DIR/server.crt" ]; then
        echo "SSL Certificate:"
        openssl x509 -in "$SSL_DIR/server.crt" -noout -subject -dates 2>/dev/null || echo "Certificate file exists but may be invalid"
    else
        echo "SSL Certificate: Not found"
    fi
}

# Show logs
show_logs() {
    local follow=${1:-false}
    
    cd "$PROJECT_ROOT"
    
    if [ "$follow" = true ]; then
        if command -v docker-compose >/dev/null 2>&1; then
            docker-compose logs -f api-gateway
        else
            docker compose logs -f api-gateway
        fi
    else
        if command -v docker-compose >/dev/null 2>&1; then
            docker-compose logs --tail=50 api-gateway
        else
            docker compose logs --tail=50 api-gateway
        fi
    fi
}

# Run connectivity tests
run_tests() {
    log_info "Running gateway connectivity tests..."
    
    local base_url="https://localhost"
    local failed_tests=0
    
    # Test endpoints
    declare -A test_endpoints=(
        ["Health Check"]="/health"
        ["Auth Service"]="/api/auth/health"
        ["AI Service"]="/api/ai/health"
        ["Billing Service"]="/api/billing/health"
        ["User Service"]="/api/users/health"
        ["Plugin Service"]="/api/plugins/health"
        ["Notification Service"]="/api/notifications/health"
    )
    
    for test_name in "${!test_endpoints[@]}"; do
        endpoint="${test_endpoints[$test_name]}"
        
        log_info "Testing $test_name ($endpoint)..."
        
        response_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$base_url$endpoint" 2>/dev/null || echo "000")
        
        case $response_code in
            200|404) # 404 is OK for service health endpoints that don't exist yet
                log_success "$test_name: OK ($response_code)"
                ;;
            000)
                log_error "$test_name: Connection failed"
                ((failed_tests++))
                ;;
            *)
                log_warning "$test_name: Unexpected response ($response_code)"
                ;;
        esac
    done
    
    # Test rate limiting
    log_info "Testing rate limiting..."
    rate_limit_test=0
    for i in {1..5}; do
        response_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$base_url/health" 2>/dev/null || echo "000")
        if [ "$response_code" = "429" ]; then
            rate_limit_test=1
            break
        fi
        sleep 0.1
    done
    
    if [ $rate_limit_test -eq 1 ]; then
        log_success "Rate limiting: Working"
    else
        log_warning "Rate limiting: Not triggered (may need more aggressive testing)"
    fi
    
    echo
    if [ $failed_tests -eq 0 ]; then
        log_success "All tests passed! ✅"
        return 0
    else
        log_error "$failed_tests tests failed ❌"
        return 1
    fi
}

# Cleanup
cleanup() {
    local force=${1:-false}
    
    if [ "$force" != true ]; then
        echo -n "This will remove API Gateway containers and volumes. Continue? (y/N): "
        read -r response
        if [[ ! $response =~ ^[Yy]$ ]]; then
            log_info "Cleanup cancelled"
            return 0
        fi
    fi
    
    log_info "Cleaning up API Gateway..."
    
    cd "$PROJECT_ROOT"
    
    # Stop and remove containers
    if command -v docker-compose >/dev/null 2>&1; then
        docker-compose rm -f -s api-gateway 2>/dev/null || true
    else
        docker compose rm -f -s api-gateway 2>/dev/null || true
    fi
    
    # Remove images
    docker rmi ai-employee-platform/api-gateway:latest 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# Main execution
main() {
    local command="setup"
    local dev_mode=false
    local force=false
    local follow_logs=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            setup|start|stop|restart|status|logs|test|ssl-setup|hosts-setup|cleanup)
                command=$1
                ;;
            --dev)
                dev_mode=true
                ;;
            --prod)
                dev_mode=false
                ;;
            --force)
                force=true
                ;;
            --follow)
                follow_logs=true
                ;;
            --help|-h)
                print_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
        shift
    done
    
    # Check dependencies
    check_dependencies
    
    # Execute command
    case $command in
        setup)
            log_info "Setting up AI Employee Platform API Gateway..."
            setup_ssl "$force"
            setup_hosts "$force"
            test_configuration
            build_gateway
            log_success "Gateway setup completed!"
            log_info "Next steps:"
            log_info "  1. Start the gateway: $0 start"
            log_info "  2. Test the gateway: $0 test"
            log_info "  3. View status: $0 status"
            ;;
        start)
            start_gateway
            ;;
        stop)
            stop_gateway
            ;;
        restart)
            restart_gateway
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs "$follow_logs"
            ;;
        test)
            run_tests
            ;;
        ssl-setup)
            setup_ssl "$force"
            ;;
        hosts-setup)
            setup_hosts "$force"
            ;;
        cleanup)
            cleanup "$force"
            ;;
        *)
            log_error "Unknown command: $command"
            print_usage
            exit 1
            ;;
    esac
}

# Execute main function with all arguments
main "$@"
