
#!/bin/bash

# Memory Leak Detection Script for AI Employee Platform
# Monitors memory usage across all services and detects potential leaks

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs/memory-monitoring"
REPORT_DIR="$PROJECT_ROOT/test-reports/memory-leaks"
MONITORING_DURATION=${1:-300}  # Default 5 minutes
SAMPLE_INTERVAL=${2:-5}        # Default 5 seconds
MEMORY_THRESHOLD=${3:-80}      # Memory usage threshold in percentage

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create directories
mkdir -p "$LOG_DIR" "$REPORT_DIR"

# Timestamp for this run
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MEMORY_LOG="$LOG_DIR/memory_usage_$TIMESTAMP.log"
LEAK_REPORT="$REPORT_DIR/leak_detection_$TIMESTAMP.txt"

echo -e "${BLUE}🔍 Starting Memory Leak Detection${NC}"
echo -e "${BLUE}Duration: ${MONITORING_DURATION}s, Interval: ${SAMPLE_INTERVAL}s${NC}"
echo -e "${BLUE}Threshold: ${MEMORY_THRESHOLD}%${NC}"
echo ""

# Function to get container memory stats
get_container_memory() {
    local container_name=$1
    local stats
    
    if docker ps --format "table {{.Names}}" | grep -q "^$container_name$"; then
        stats=$(docker stats --no-stream --format "{{.MemUsage}} {{.MemPerc}}" "$container_name" 2>/dev/null || echo "N/A N/A")
        echo "$stats"
    else
        echo "STOPPED STOPPED"
    fi
}

# Function to get process memory usage
get_process_memory() {
    local process_name=$1
    local pid
    local memory_kb
    local memory_mb
    
    pid=$(pgrep -f "$process_name" | head -n 1)
    if [ -n "$pid" ]; then
        # Get RSS (Resident Set Size) in KB
        memory_kb=$(ps -o pid,rss -p "$pid" --no-headers 2>/dev/null | awk '{print $2}' || echo "0")
        memory_mb=$((memory_kb / 1024))
        echo "$memory_mb"
    else
        echo "0"
    fi
}

# Function to analyze memory trend
analyze_memory_trend() {
    local service_name=$1
    local memory_values=$2
    
    # Convert space-separated values to array
    IFS=' ' read -ra values <<< "$memory_values"
    local count=${#values[@]}
    
    if [ "$count" -lt 10 ]; then
        echo "INSUFFICIENT_DATA"
        return
    fi
    
    # Calculate trend using simple linear regression slope
    local sum_x=0
    local sum_y=0
    local sum_xy=0
    local sum_x2=0
    
    for i in "${!values[@]}"; do
        local x=$((i + 1))
        local y=${values[i]}
        
        sum_x=$((sum_x + x))
        sum_y=$(echo "$sum_y + $y" | bc)
        sum_xy=$(echo "$sum_xy + ($x * $y)" | bc)
        sum_x2=$((sum_x2 + x * x))
    done
    
    # Calculate slope: (n*sum_xy - sum_x*sum_y) / (n*sum_x2 - sum_x^2)
    local n=$count
    local numerator=$(echo "($n * $sum_xy) - ($sum_x * $sum_y)" | bc)
    local denominator=$(echo "($n * $sum_x2) - ($sum_x * $sum_x)" | bc)
    
    if [ "$denominator" != "0" ]; then
        local slope=$(echo "scale=4; $numerator / $denominator" | bc)
        
        # Determine trend
        local trend_result=$(echo "$slope > 0.5" | bc)
        if [ "$trend_result" -eq 1 ]; then
            echo "INCREASING"
        else
            local stable_result=$(echo "$slope < -0.5" | bc)
            if [ "$stable_result" -eq 1 ]; then
                echo "DECREASING"
            else
                echo "STABLE"
            fi
        fi
    else
        echo "STABLE"
    fi
}

# Function to detect memory leaks
detect_memory_leaks() {
    local log_file=$1
    local report_file=$2
    
    echo "🔍 Analyzing memory usage patterns..." > "$report_file"
    echo "Generated: $(date)" >> "$report_file"
    echo "Duration: ${MONITORING_DURATION}s" >> "$report_file"
    echo "Sample Interval: ${SAMPLE_INTERVAL}s" >> "$report_file"
    echo "Threshold: ${MEMORY_THRESHOLD}%" >> "$report_file"
    echo "" >> "$report_file"
    
    # Services to monitor
    local services=(
        "ai-employee-platform-auth-service-1:auth-service"
        "ai-employee-platform-ai-routing-service-1:ai-routing"
        "ai-employee-platform-billing-service-1:billing"
        "ai-employee-platform-user-management-service-1:user-mgmt"
        "ai-employee-platform-plugin-manager-service-1:plugin-mgr"
        "ai-employee-platform-notification-service-1:notification"
        "ai-employee-platform-admin-dashboard-1:admin-ui"
        "ai-employee-platform-employee-portal-1:employee-ui"
        "postgres:database"
        "redis:cache"
    )
    
    local leak_detected=0
    
    for service_info in "${services[@]}"; do
        IFS=':' read -ra service_parts <<< "$service_info"
        local container_name="${service_parts[0]}"
        local service_name="${service_parts[1]}"
        
        echo -e "\n📊 Analyzing $service_name..." >> "$report_file"
        echo "Container: $container_name" >> "$report_file"
        
        # Extract memory values for this service from log
        local memory_values=$(grep "$service_name" "$log_file" | awk '{print $3}' | grep -v "STOPPED" | grep -v "N/A" | tr '\n' ' ')
        
        if [ -z "$memory_values" ]; then
            echo "❌ No memory data found" >> "$report_file"
            continue
        fi
        
        # Analyze trend
        local trend=$(analyze_memory_trend "$service_name" "$memory_values")
        echo "Memory Trend: $trend" >> "$report_file"
        
        # Calculate statistics
        local values_array=($memory_values)
        local count=${#values_array[@]}
        local max_memory=$(printf '%s\n' "${values_array[@]}" | sort -n | tail -1)
        local min_memory=$(printf '%s\n' "${values_array[@]}" | sort -n | head -1)
        local avg_memory=$(echo "$memory_values" | awk '{sum=0; for(i=1;i<=NF;i++) sum+=$i; print sum/NF}')
        
        echo "Sample Count: $count" >> "$report_file"
        echo "Min Memory: ${min_memory}MB" >> "$report_file"
        echo "Max Memory: ${max_memory}MB" >> "$report_file"
        echo "Avg Memory: ${avg_memory}MB" >> "$report_file"
        
        # Check for potential leaks
        local leak_score=0
        local leak_indicators=""
        
        # Check 1: Increasing trend
        if [ "$trend" = "INCREASING" ]; then
            leak_score=$((leak_score + 3))
            leak_indicators="$leak_indicators\n  - Memory usage is increasing over time"
        fi
        
        # Check 2: High memory growth rate
        if [ -n "$max_memory" ] && [ -n "$min_memory" ]; then
            local growth_rate=$(echo "scale=2; ($max_memory - $min_memory) / $min_memory * 100" | bc 2>/dev/null || echo "0")
            local high_growth=$(echo "$growth_rate > 50" | bc 2>/dev/null || echo "0")
            
            if [ "$high_growth" -eq 1 ]; then
                leak_score=$((leak_score + 2))
                leak_indicators="$leak_indicators\n  - High memory growth rate: ${growth_rate}%"
            fi
            
            echo "Memory Growth Rate: ${growth_rate}%" >> "$report_file"
        fi
        
        # Check 3: High peak memory usage
        if [ -n "$max_memory" ]; then
            local high_usage=$(echo "$max_memory > 500" | bc 2>/dev/null || echo "0")
            if [ "$high_usage" -eq 1 ]; then
                leak_score=$((leak_score + 1))
                leak_indicators="$leak_indicators\n  - High peak memory usage: ${max_memory}MB"
            fi
        fi
        
        # Check 4: Memory not decreasing after initial ramp-up
        if [ "$count" -gt 20 ]; then
            local last_quarter_start=$((count * 3 / 4))
            local first_quarter_end=$((count / 4))
            
            if [ "$last_quarter_start" -lt "$count" ] && [ "$first_quarter_end" -gt 0 ]; then
                local early_avg=$(echo "$memory_values" | cut -d' ' -f1-$first_quarter_end | awk '{sum=0; for(i=1;i<=NF;i++) sum+=$i; print sum/NF}')
                local late_avg=$(echo "$memory_values" | cut -d' ' -f$last_quarter_start- | awk '{sum=0; for(i=1;i<=NF;i++) sum+=$i; print sum/NF}')
                
                local no_gc=$(echo "$late_avg > $early_avg * 1.2" | bc 2>/dev/null || echo "0")
                if [ "$no_gc" -eq 1 ]; then
                    leak_score=$((leak_score + 2))
                    leak_indicators="$leak_indicators\n  - Memory not decreasing after ramp-up period"
                fi
            fi
        fi
        
        # Determine leak risk
        local risk_level="LOW"
        if [ "$leak_score" -ge 5 ]; then
            risk_level="HIGH"
            leak_detected=1
        elif [ "$leak_score" -ge 3 ]; then
            risk_level="MEDIUM"
        fi
        
        echo "Leak Risk Score: $leak_score/7" >> "$report_file"
        echo "Risk Level: $risk_level" >> "$report_file"
        
        if [ -n "$leak_indicators" ]; then
            echo "Leak Indicators:" >> "$report_file"
            echo -e "$leak_indicators" >> "$report_file"
        fi
        
        # Generate recommendations
        if [ "$risk_level" != "LOW" ]; then
            echo "Recommendations:" >> "$report_file"
            echo "  - Monitor service more closely for memory usage patterns" >> "$report_file"
            echo "  - Review application code for potential memory leaks" >> "$report_file"
            echo "  - Check garbage collection settings and frequency" >> "$report_file"
            echo "  - Consider implementing memory profiling tools" >> "$report_file"
            
            if [ "$service_name" != "database" ] && [ "$service_name" != "cache" ]; then
                echo "  - Add memory usage alerts and monitoring" >> "$report_file"
                echo "  - Implement graceful memory management" >> "$report_file"
            fi
        fi
    done
    
    # Summary
    echo "" >> "$report_file"
    echo "=== SUMMARY ===" >> "$report_file"
    if [ "$leak_detected" -eq 1 ]; then
        echo "🚨 POTENTIAL MEMORY LEAKS DETECTED!" >> "$report_file"
        echo "Review services with HIGH risk levels immediately." >> "$report_file"
    else
        echo "✅ No critical memory leaks detected." >> "$report_file"
        echo "Continue monitoring for any unusual patterns." >> "$report_file"
    fi
    
    return $leak_detected
}

# Function to monitor system memory
monitor_system_memory() {
    local duration=$1
    local interval=$2
    
    local end_time=$(($(date +%s) + duration))
    local sample_count=0
    
    echo "timestamp,service,memory_mb,memory_percent,cpu_percent,trend" > "$MEMORY_LOG"
    
    echo -e "${GREEN}📊 Monitoring memory usage...${NC}"
    
    while [ $(date +%s) -lt $end_time ]; do
        local current_time=$(date +%s)
        sample_count=$((sample_count + 1))
        
        # Monitor Docker containers
        local containers=(
            "ai-employee-platform-auth-service-1:auth-service"
            "ai-employee-platform-ai-routing-service-1:ai-routing"
            "ai-employee-platform-billing-service-1:billing"
            "ai-employee-platform-user-management-service-1:user-mgmt"
            "ai-employee-platform-plugin-manager-service-1:plugin-mgr"
            "ai-employee-platform-notification-service-1:notification"
            "ai-employee-platform-admin-dashboard-1:admin-ui"
            "ai-employee-platform-employee-portal-1:employee-ui"
            "postgres:database"
            "redis:cache"
        )
        
        for container_info in "${containers[@]}"; do
            IFS=':' read -ra container_parts <<< "$container_info"
            local container_name="${container_parts[0]}"
            local service_name="${container_parts[1]}"
            
            local memory_stats=$(get_container_memory "$container_name")
            IFS=' ' read -ra stats <<< "$memory_stats"
            
            if [ "${stats[0]}" != "STOPPED" ] && [ "${stats[0]}" != "N/A" ]; then
                local memory_usage="${stats[0]}"
                local memory_percent="${stats[1]}"
                
                # Extract numeric values
                local memory_mb=$(echo "$memory_usage" | sed 's/MiB.*//' | sed 's/GiB.*//' | head -n1)
                local mem_pct=$(echo "$memory_percent" | sed 's/%//')
                
                # Check if it's in GiB and convert to MB
                if [[ "$memory_usage" == *"GiB"* ]]; then
                    memory_mb=$(echo "scale=0; $memory_mb * 1024" | bc)
                fi
                
                # Get CPU stats (simplified)
                local cpu_stats=$(docker stats --no-stream --format "{{.CPUPerc}}" "$container_name" 2>/dev/null || echo "0.00%")
                local cpu_pct=$(echo "$cpu_stats" | sed 's/%//')
                
                echo "$current_time,$service_name,$memory_mb,$mem_pct,$cpu_pct,monitoring" >> "$MEMORY_LOG"
                
                # Alert on high memory usage
                local high_mem_check=$(echo "$mem_pct > $MEMORY_THRESHOLD" | bc 2>/dev/null || echo "0")
                if [ "$high_mem_check" -eq 1 ]; then
                    echo -e "${YELLOW}⚠️  High memory usage detected: $service_name ($mem_pct%)${NC}"
                fi
            else
                echo "$current_time,$service_name,STOPPED,STOPPED,STOPPED,stopped" >> "$MEMORY_LOG"
            fi
        done
        
        # Progress indicator
        local remaining=$((end_time - current_time))
        echo -ne "\r${BLUE}Sample $sample_count, ${remaining}s remaining...${NC}"
        
        sleep "$interval"
    done
    
    echo -e "\n${GREEN}✅ Memory monitoring completed${NC}"
    echo -e "${GREEN}📊 Collected $sample_count samples${NC}"
    echo -e "${GREEN}📄 Log saved to: $MEMORY_LOG${NC}"
}

# Function to generate heap dump (Node.js services)
generate_heap_dumps() {
    echo -e "\n${BLUE}📸 Generating heap dumps for Node.js services...${NC}"
    
    local heap_dir="$REPORT_DIR/heap-dumps-$TIMESTAMP"
    mkdir -p "$heap_dir"
    
    local node_services=(
        "ai-employee-platform-auth-service-1"
        "ai-employee-platform-ai-routing-service-1"
        "ai-employee-platform-billing-service-1"
        "ai-employee-platform-user-management-service-1"
        "ai-employee-platform-plugin-manager-service-1"
        "ai-employee-platform-notification-service-1"
    )
    
    for container in "${node_services[@]}"; do
        if docker ps --format "table {{.Names}}" | grep -q "^$container$"; then
            echo "Generating heap dump for $container..."
            
            # Try to generate heap dump using kill -USR2 signal
            local pid=$(docker exec "$container" pgrep node 2>/dev/null | head -n1)
            if [ -n "$pid" ]; then
                docker exec "$container" kill -USR2 "$pid" 2>/dev/null || echo "Failed to generate heap dump for $container"
            fi
        fi
    done
    
    echo -e "${GREEN}✅ Heap dump generation completed${NC}"
}

# Main execution
main() {
    echo -e "${BLUE}🚀 AI Employee Platform - Memory Leak Detection${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
        exit 1
    fi
    
    # Check if services are running
    local running_services=$(docker ps --format "{{.Names}}" | grep -c "ai-employee-platform" || echo "0")
    if [ "$running_services" -eq 0 ]; then
        echo -e "${YELLOW}⚠️  No AI Employee Platform services detected.${NC}"
        echo -e "${YELLOW}   Starting services...${NC}"
        
        cd "$PROJECT_ROOT"
        if [ -f "docker-compose.yml" ]; then
            docker-compose up -d
            sleep 30  # Wait for services to start
        else
            echo -e "${RED}❌ docker-compose.yml not found${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}✅ Found $running_services running services${NC}"
    echo ""
    
    # Start monitoring
    monitor_system_memory "$MONITORING_DURATION" "$SAMPLE_INTERVAL"
    
    # Generate heap dumps
    generate_heap_dumps
    
    # Analyze results
    echo -e "\n${BLUE}🔍 Analyzing memory usage patterns...${NC}"
    if detect_memory_leaks "$MEMORY_LOG" "$LEAK_REPORT"; then
        echo -e "${RED}🚨 Potential memory leaks detected!${NC}"
        echo -e "${RED}📄 Check report: $LEAK_REPORT${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ No critical memory leaks detected${NC}"
        echo -e "${GREEN}📄 Report saved: $LEAK_REPORT${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}🎉 Memory leak detection completed successfully!${NC}"
    echo -e "${GREEN}📊 Memory log: $MEMORY_LOG${NC}"
    echo -e "${GREEN}📄 Leak report: $LEAK_REPORT${NC}"
}

# Help function
show_help() {
    echo "Memory Leak Detection Script"
    echo ""
    echo "Usage: $0 [DURATION] [INTERVAL] [THRESHOLD]"
    echo ""
    echo "Arguments:"
    echo "  DURATION   Monitoring duration in seconds (default: 300)"
    echo "  INTERVAL   Sample interval in seconds (default: 5)"
    echo "  THRESHOLD  Memory usage threshold in percent (default: 80)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Monitor for 5 minutes with 5s intervals"
    echo "  $0 600               # Monitor for 10 minutes"
    echo "  $0 300 10           # Monitor for 5 minutes with 10s intervals"
    echo "  $0 300 5 90         # Monitor for 5 minutes with 90% threshold"
    echo ""
    echo "Output files:"
    echo "  - Memory usage log: $LOG_DIR/memory_usage_[timestamp].log"
    echo "  - Leak detection report: $REPORT_DIR/leak_detection_[timestamp].txt"
    echo "  - Heap dumps: $REPORT_DIR/heap-dumps-[timestamp]/"
}

# Parse command line arguments
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Validate arguments
if [ -n "$1" ] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}❌ Error: Duration must be a positive integer${NC}"
    exit 1
fi

if [ -n "$2" ] && ! [[ "$2" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}❌ Error: Interval must be a positive integer${NC}"
    exit 1
fi

if [ -n "$3" ] && ! [[ "$3" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}❌ Error: Threshold must be a positive integer${NC}"
    exit 1
fi

# Run main function
main "$@"
