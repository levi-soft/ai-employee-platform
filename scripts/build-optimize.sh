
#!/bin/bash

# AI Employee Platform - Build Optimization Script
# Subtask 1.12: Development Workflow Optimization

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}🏗️  AI Employee Platform - Build Optimization${NC}"
echo -e "${BLUE}===============================================${NC}"

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

# Function to measure build time
measure_build_time() {
    local start_time=$(date +%s)
    local package_name=$1
    local package_path=$2
    
    print_status "Building $package_name..."
    
    cd "$package_path"
    if npm run build > /dev/null 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        print_success "$package_name built in ${duration}s"
        return $duration
    else
        print_error "Failed to build $package_name"
        return -1
    fi
}

# Function to clean build artifacts
clean_builds() {
    print_status "Cleaning build artifacts..."
    
    # Clean root
    rm -rf "$PROJECT_ROOT/dist" "$PROJECT_ROOT/.turbo" "$PROJECT_ROOT/node_modules/.cache"
    
    # Clean services
    for service in auth-service ai-routing-service billing-service user-management-service plugin-manager-service notification-service; do
        if [ -d "$PROJECT_ROOT/services/$service" ]; then
            rm -rf "$PROJECT_ROOT/services/$service/dist"
            rm -rf "$PROJECT_ROOT/services/$service/.turbo"
        fi
    done
    
    # Clean apps
    for app in admin-dashboard employee-portal; do
        if [ -d "$PROJECT_ROOT/apps/$app" ]; then
            rm -rf "$PROJECT_ROOT/apps/$app/.next"
            rm -rf "$PROJECT_ROOT/apps/$app/dist"
            rm -rf "$PROJECT_ROOT/apps/$app/.turbo"
        fi
    done
    
    # Clean packages
    for package in shared-types shared-utils ui-components api-client; do
        if [ -d "$PROJECT_ROOT/packages/$package" ]; then
            rm -rf "$PROJECT_ROOT/packages/$package/dist"
            rm -rf "$PROJECT_ROOT/packages/$package/.turbo"
        fi
    done
    
    # Clean database
    if [ -d "$PROJECT_ROOT/database" ]; then
        rm -rf "$PROJECT_ROOT/database/dist"
    fi
    
    print_success "Build artifacts cleaned!"
}

# Function to optimize TypeScript build
optimize_typescript() {
    print_status "Optimizing TypeScript build configuration..."
    
    # Update root tsconfig.json with build optimizations
    local temp_file=$(mktemp)
    cat > "$temp_file" << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": false,
    "incremental": true,
    "tsBuildInfoFile": "./tsconfig.tsbuildinfo"
  },
  "references": [
    { "path": "./packages/shared-types" },
    { "path": "./packages/shared-utils" },
    { "path": "./packages/ui-components" },
    { "path": "./packages/api-client" },
    { "path": "./services/auth-service" },
    { "path": "./apps/admin-dashboard" },
    { "path": "./apps/employee-portal" },
    { "path": "./database" }
  ]
}
EOF
    
    if ! cmp -s "$temp_file" "$PROJECT_ROOT/tsconfig.json"; then
        cp "$temp_file" "$PROJECT_ROOT/tsconfig.json"
        print_success "Updated root TypeScript configuration"
    fi
    rm "$temp_file"
}

# Function to parallel build packages
parallel_build() {
    print_status "Building packages in parallel..."
    
    local total_time=0
    local pids=()
    
    # Build shared packages first (they are dependencies)
    print_status "Building shared packages..."
    
    # Build shared-types first
    local shared_types_time
    shared_types_time=$(measure_build_time "shared-types" "$PROJECT_ROOT/packages/shared-types")
    if [ $shared_types_time -eq -1 ]; then
        print_error "Failed to build shared-types"
        return 1
    fi
    total_time=$((total_time + shared_types_time))
    
    # Build shared-utils next
    local shared_utils_time
    shared_utils_time=$(measure_build_time "shared-utils" "$PROJECT_ROOT/packages/shared-utils")
    if [ $shared_utils_time -eq -1 ]; then
        print_error "Failed to build shared-utils"
        return 1
    fi
    total_time=$((total_time + shared_utils_time))
    
    # Build other packages in parallel
    print_status "Building remaining packages in parallel..."
    
    # Background builds for independent packages
    if [ -d "$PROJECT_ROOT/packages/ui-components" ]; then
        (measure_build_time "ui-components" "$PROJECT_ROOT/packages/ui-components" > /tmp/ui-components-build.log 2>&1) &
        pids+=($!)
    fi
    
    if [ -d "$PROJECT_ROOT/packages/api-client" ]; then
        (measure_build_time "api-client" "$PROJECT_ROOT/packages/api-client" > /tmp/api-client-build.log 2>&1) &
        pids+=($!)
    fi
    
    if [ -d "$PROJECT_ROOT/services/auth-service" ]; then
        (measure_build_time "auth-service" "$PROJECT_ROOT/services/auth-service" > /tmp/auth-service-build.log 2>&1) &
        pids+=($!)
    fi
    
    if [ -d "$PROJECT_ROOT/database" ]; then
        (measure_build_time "database" "$PROJECT_ROOT/database" > /tmp/database-build.log 2>&1) &
        pids+=($!)
    fi
    
    # Wait for all background builds
    for pid in "${pids[@]}"; do
        wait $pid
        if [ $? -ne 0 ]; then
            print_warning "One of the parallel builds failed"
        fi
    done
    
    # Display logs
    for log in /tmp/*-build.log; do
        if [ -f "$log" ]; then
            cat "$log"
            rm "$log"
        fi
    done
    
    print_success "Parallel build completed in approximately ${total_time}s"
}

# Function to optimize node_modules
optimize_node_modules() {
    print_status "Optimizing node_modules..."
    
    # Use npm ci for faster, reproducible installs
    cd "$PROJECT_ROOT"
    if [ -f "package-lock.json" ]; then
        print_status "Using npm ci for optimized dependency installation..."
        npm ci --prefer-offline --no-audit
    else
        print_status "Using npm install with optimization flags..."
        npm install --prefer-offline --no-audit --progress=false
    fi
    
    print_success "Dependencies optimized!"
}

# Function to show build report
show_build_report() {
    echo -e "\n${BLUE}📊 Build Optimization Report${NC}"
    echo -e "${BLUE}==============================${NC}"
    
    # Count built packages
    local built_packages=0
    
    for dir in packages/*/dist services/*/dist apps/*/.next database/dist; do
        if [ -d "$PROJECT_ROOT/$dir" ]; then
            ((built_packages++))
        fi
    done
    
    echo -e "${GREEN}✅ Built packages: $built_packages${NC}"
    
    # Show disk space usage
    local total_size=$(du -sh "$PROJECT_ROOT" | cut -f1)
    local node_modules_size=$(du -sh "$PROJECT_ROOT"/*/node_modules 2>/dev/null | awk '{sum+=$1} END {print sum}' || echo "0")
    
    echo -e "${GREEN}📦 Total project size: $total_size${NC}"
    echo -e "${GREEN}📁 Node modules size: ${node_modules_size}M${NC}"
    
    # Show build artifacts
    echo -e "\n${YELLOW}🏗️  Build Artifacts:${NC}"
    find "$PROJECT_ROOT" -name "dist" -o -name ".next" -o -name "*.tsbuildinfo" | grep -v node_modules | sort
    
    echo -e "\n${GREEN}🚀 Build optimization completed!${NC}"
}

# Function to show help
show_help() {
    echo -e "${BLUE}AI Employee Platform - Build Optimization Script${NC}"
    echo ""
    echo -e "${YELLOW}Usage:${NC} $0 [OPTIONS]"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo "  -h, --help      Show this help message"
    echo "  --clean         Clean all build artifacts before building"
    echo "  --parallel      Use parallel building (default)"
    echo "  --sequential    Use sequential building"
    echo "  --optimize      Optimize TypeScript and dependencies"
    echo "  --report        Show detailed build report"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0                    # Full optimized build"
    echo "  $0 --clean            # Clean build"
    echo "  $0 --optimize         # Optimize and build"
}

# Main execution
main() {
    local clean_build=false
    local parallel_build_enabled=true
    local optimize_enabled=false
    local show_report=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            --clean)
                clean_build=true
                shift
                ;;
            --parallel)
                parallel_build_enabled=true
                shift
                ;;
            --sequential)
                parallel_build_enabled=false
                shift
                ;;
            --optimize)
                optimize_enabled=true
                shift
                ;;
            --report)
                show_report=true
                shift
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    local start_time=$(date +%s)
    
    # Clean if requested
    if [ "$clean_build" = true ]; then
        clean_builds
    fi
    
    # Optimize if requested
    if [ "$optimize_enabled" = true ]; then
        optimize_typescript
        optimize_node_modules
    fi
    
    # Build packages
    if [ "$parallel_build_enabled" = true ]; then
        parallel_build
    else
        print_status "Building packages sequentially..."
        
        # Build in dependency order
        local packages=(
            "packages/shared-types"
            "packages/shared-utils"  
            "packages/ui-components"
            "packages/api-client"
            "services/auth-service"
            "database"
        )
        
        for package in "${packages[@]}"; do
            if [ -d "$PROJECT_ROOT/$package" ]; then
                measure_build_time "$(basename $package)" "$PROJECT_ROOT/$package"
            fi
        done
    fi
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    print_success "All builds completed in ${total_duration}s"
    
    # Show report if requested
    if [ "$show_report" = true ]; then
        show_build_report
    fi
    
    # Check if build time is under 2 minutes (requirement)
    if [ $total_duration -lt 120 ]; then
        print_success "✅ Build time requirement met: ${total_duration}s < 120s"
    else
        print_warning "⚠️  Build time exceeds requirement: ${total_duration}s > 120s"
    fi
}

# Run main function
main "$@"
