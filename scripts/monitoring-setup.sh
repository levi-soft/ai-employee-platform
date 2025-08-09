
#!/bin/bash

# AI Employee Platform - Monitoring & Logging Setup Script
# This script sets up the complete ELK stack and monitoring infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INFRASTRUCTURE_DIR="$PROJECT_ROOT/infrastructure"
LOGGING_DIR="$INFRASTRUCTURE_DIR/logging"

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "================================================================="
    echo "         AI Employee Platform - Monitoring Setup"
    echo "================================================================="
    echo -e "${NC}"
}

# Check dependencies
check_dependencies() {
    print_status "Checking dependencies..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker ps &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    print_success "All dependencies are available"
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    # ELK stack directories
    mkdir -p "$LOGGING_DIR/elasticsearch/config"
    mkdir -p "$LOGGING_DIR/elasticsearch/data"
    mkdir -p "$LOGGING_DIR/logstash/config"
    mkdir -p "$LOGGING_DIR/logstash/pipeline"
    mkdir -p "$LOGGING_DIR/kibana/config"
    mkdir -p "$LOGGING_DIR/filebeat/config"
    
    # Logs directory
    mkdir -p "$PROJECT_ROOT/logs"
    
    # Set permissions for Elasticsearch data directory
    if [[ "$OSTYPE" != "darwin"* ]]; then
        sudo chown -R 1000:1000 "$LOGGING_DIR/elasticsearch/data" 2>/dev/null || true
    fi
    
    print_success "Directories created successfully"
}

# Setup ELK stack
setup_elk_stack() {
    print_status "Setting up ELK stack..."
    
    # Navigate to logging directory
    cd "$LOGGING_DIR"
    
    # Pull required images
    print_status "Pulling Docker images..."
    docker-compose -f docker-compose.elk.yml pull
    
    # Start ELK stack
    print_status "Starting ELK stack services..."
    docker-compose -f docker-compose.elk.yml up -d
    
    print_success "ELK stack started successfully"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for Elasticsearch
    print_status "Waiting for Elasticsearch..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -s -f "http://localhost:9200/_cluster/health" > /dev/null 2>&1; then
            print_success "Elasticsearch is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            print_error "Elasticsearch failed to start within 5 minutes"
            exit 1
        fi
        
        echo -n "."
        sleep 10
        ((attempt++))
    done
    
    # Wait for Kibana
    print_status "Waiting for Kibana..."
    attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -s -f "http://localhost:5601/api/status" > /dev/null 2>&1; then
            print_success "Kibana is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            print_error "Kibana failed to start within 5 minutes"
            exit 1
        fi
        
        echo -n "."
        sleep 10
        ((attempt++))
    done
}

# Setup index templates and patterns
setup_elasticsearch_templates() {
    print_status "Setting up Elasticsearch templates..."
    
    # Create index template for AI Platform logs
    curl -X PUT "localhost:9200/_template/ai-platform-logs" \
        -H "Content-Type: application/json" \
        -d '{
            "index_patterns": ["ai-platform-logs-*", "filebeat-ai-platform-*"],
            "settings": {
                "number_of_shards": 1,
                "number_of_replicas": 0,
                "index.refresh_interval": "30s",
                "index.mapping.total_fields.limit": 2000
            },
            "mappings": {
                "properties": {
                    "@timestamp": { "type": "date" },
                    "timestamp": { "type": "date" },
                    "level": { "type": "keyword" },
                    "service": { "type": "keyword" },
                    "message": {
                        "type": "text",
                        "analyzer": "standard",
                        "fields": {
                            "keyword": {
                                "type": "keyword",
                                "ignore_above": 256
                            }
                        }
                    },
                    "userId": { "type": "keyword" },
                    "requestId": { "type": "keyword" },
                    "sessionId": { "type": "keyword" },
                    "operation": { "type": "keyword" },
                    "duration": { "type": "float" },
                    "statusCode": { "type": "integer" },
                    "method": { "type": "keyword" },
                    "url": { "type": "keyword" },
                    "ip": { "type": "ip" },
                    "userAgent": {
                        "type": "text",
                        "fields": {
                            "keyword": {
                                "type": "keyword",
                                "ignore_above": 256
                            }
                        }
                    },
                    "severity": { "type": "keyword" },
                    "environment": { "type": "keyword" },
                    "platform": { "type": "keyword" },
                    "error": {
                        "properties": {
                            "name": { "type": "keyword" },
                            "message": { "type": "text" },
                            "stack": { "type": "text" }
                        }
                    }
                }
            }
        }' > /dev/null 2>&1
    
    print_success "Elasticsearch templates configured"
}

# Setup Kibana dashboards and index patterns
setup_kibana_dashboards() {
    print_status "Setting up Kibana index patterns and dashboards..."
    
    # Wait a bit more for Kibana to be fully ready
    sleep 30
    
    # Create index pattern for AI Platform logs
    curl -X POST "localhost:5601/api/saved_objects/index-pattern/ai-platform-logs-*" \
        -H "kbn-xsrf: true" \
        -H "Content-Type: application/json" \
        -d '{
            "attributes": {
                "title": "ai-platform-logs-*",
                "timeFieldName": "@timestamp",
                "fields": "[]"
            }
        }' > /dev/null 2>&1 || print_warning "Index pattern might already exist"
    
    # Create index pattern for Filebeat logs
    curl -X POST "localhost:5601/api/saved_objects/index-pattern/filebeat-ai-platform-*" \
        -H "kbn-xsrf: true" \
        -H "Content-Type: application/json" \
        -d '{
            "attributes": {
                "title": "filebeat-ai-platform-*",
                "timeFieldName": "@timestamp",
                "fields": "[]"
            }
        }' > /dev/null 2>&1 || print_warning "Filebeat index pattern might already exist"
    
    print_success "Kibana configured successfully"
}

# Test the monitoring setup
test_monitoring() {
    print_status "Testing monitoring setup..."
    
    # Test Elasticsearch
    if curl -s -f "http://localhost:9200/_cluster/health" > /dev/null; then
        print_success "✓ Elasticsearch is accessible"
    else
        print_error "✗ Elasticsearch is not accessible"
        return 1
    fi
    
    # Test Kibana
    if curl -s -f "http://localhost:5601/api/status" > /dev/null; then
        print_success "✓ Kibana is accessible"
    else
        print_error "✗ Kibana is not accessible"
        return 1
    fi
    
    # Test Logstash
    if curl -s -f "http://localhost:9600/_node/stats" > /dev/null; then
        print_success "✓ Logstash is accessible"
    else
        print_warning "⚠ Logstash health check failed (this is often normal during startup)"
    fi
    
    print_success "Monitoring setup test completed"
}

# Display connection information
display_info() {
    echo -e "${GREEN}"
    echo "================================================================="
    echo "         Monitoring Setup Complete!"
    echo "================================================================="
    echo -e "${NC}"
    echo "Services are now running and accessible:"
    echo ""
    echo -e "${BLUE}Elasticsearch:${NC} http://localhost:9200"
    echo "  - Health: curl http://localhost:9200/_cluster/health"
    echo "  - Indices: curl http://localhost:9200/_cat/indices?v"
    echo ""
    echo -e "${BLUE}Kibana:${NC} http://localhost:5601"
    echo "  - Username: (not required)"
    echo "  - Index Patterns: ai-platform-logs-*, filebeat-ai-platform-*"
    echo ""
    echo -e "${BLUE}Logstash:${NC} http://localhost:9600"
    echo "  - Node stats: curl http://localhost:9600/_node/stats"
    echo ""
    echo -e "${YELLOW}Log Collection:${NC}"
    echo "  - File logs: $PROJECT_ROOT/logs/"
    echo "  - HTTP endpoint: http://localhost:8080 (Logstash)"
    echo "  - TCP endpoint: localhost:5000 (Logstash)"
    echo ""
    echo -e "${YELLOW}Getting Started:${NC}"
    echo "1. Open Kibana at http://localhost:5601"
    echo "2. Go to Discover to view logs"
    echo "3. Create visualizations and dashboards"
    echo "4. Check the logs directory for application logs"
    echo ""
    echo -e "${BLUE}Management Commands:${NC}"
    echo "  Start:   $0 start"
    echo "  Stop:    $0 stop"
    echo "  Restart: $0 restart"
    echo "  Status:  $0 status"
    echo "  Logs:    $0 logs"
    echo "  Clean:   $0 clean"
}

# Management functions
start_monitoring() {
    print_status "Starting monitoring services..."
    cd "$LOGGING_DIR"
    docker-compose -f docker-compose.elk.yml up -d
    print_success "Monitoring services started"
}

stop_monitoring() {
    print_status "Stopping monitoring services..."
    cd "$LOGGING_DIR"
    docker-compose -f docker-compose.elk.yml down
    print_success "Monitoring services stopped"
}

restart_monitoring() {
    print_status "Restarting monitoring services..."
    stop_monitoring
    sleep 5
    start_monitoring
}

status_monitoring() {
    print_status "Checking monitoring services status..."
    cd "$LOGGING_DIR"
    docker-compose -f docker-compose.elk.yml ps
}

show_logs() {
    local service=${1:-""}
    cd "$LOGGING_DIR"
    
    if [[ -n "$service" ]]; then
        print_status "Showing logs for $service..."
        docker-compose -f docker-compose.elk.yml logs -f "$service"
    else
        print_status "Showing all monitoring service logs..."
        docker-compose -f docker-compose.elk.yml logs -f
    fi
}

clean_monitoring() {
    print_warning "This will remove all monitoring data and containers!"
    read -p "Are you sure you want to continue? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Cleaning monitoring setup..."
        cd "$LOGGING_DIR"
        docker-compose -f docker-compose.elk.yml down -v --remove-orphans
        docker system prune -f
        
        # Remove data directory
        if [[ -d "$LOGGING_DIR/elasticsearch/data" ]]; then
            rm -rf "$LOGGING_DIR/elasticsearch/data"
            mkdir -p "$LOGGING_DIR/elasticsearch/data"
        fi
        
        print_success "Monitoring setup cleaned"
    else
        print_status "Clean operation cancelled"
    fi
}

# Main execution logic
main() {
    case "${1:-setup}" in
        "setup")
            print_banner
            check_dependencies
            create_directories
            setup_elk_stack
            wait_for_services
            setup_elasticsearch_templates
            setup_kibana_dashboards
            test_monitoring
            display_info
            ;;
        "start")
            start_monitoring
            ;;
        "stop")
            stop_monitoring
            ;;
        "restart")
            restart_monitoring
            ;;
        "status")
            status_monitoring
            ;;
        "logs")
            show_logs "${2:-}"
            ;;
        "test")
            test_monitoring
            ;;
        "clean")
            clean_monitoring
            ;;
        "help"|"-h"|"--help")
            echo "Usage: $0 [COMMAND]"
            echo ""
            echo "Commands:"
            echo "  setup     Set up the complete monitoring infrastructure (default)"
            echo "  start     Start monitoring services"
            echo "  stop      Stop monitoring services"
            echo "  restart   Restart monitoring services"
            echo "  status    Show monitoring services status"
            echo "  logs      Show logs (optionally specify service name)"
            echo "  test      Test monitoring setup"
            echo "  clean     Clean up monitoring setup (removes all data)"
            echo "  help      Show this help message"
            ;;
        *)
            print_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Execute main function with all arguments
main "$@"
