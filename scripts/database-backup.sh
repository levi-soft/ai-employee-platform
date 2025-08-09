
#!/bin/bash

# Database Backup Script for AI Employee Platform
# Automated backup with encryption, compression, and cloud storage support
# Created: 2025-08-08

set -euo pipefail

# =======================
# CONFIGURATION
# =======================

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/database/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Database configuration (from environment or defaults)
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-ai_employee_platform}"
DB_USER="${DATABASE_USER:-postgres}"
DB_PASSWORD="${DATABASE_PASSWORD:-}"

# Backup configuration
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_COMPRESSION="${BACKUP_COMPRESSION:-true}"
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-false}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# Cloud storage configuration (optional)
CLOUD_BACKUP_ENABLED="${CLOUD_BACKUP_ENABLED:-false}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Notification configuration
NOTIFICATION_ENABLED="${NOTIFICATION_ENABLED:-false}"
NOTIFICATION_EMAIL="${NOTIFICATION_EMAIL:-}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"

# =======================
# UTILITY FUNCTIONS
# =======================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }
log_success() { log "SUCCESS" "$@"; }

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Send notification
send_notification() {
    local status="$1"
    local message="$2"
    
    if [[ "$NOTIFICATION_ENABLED" != "true" ]]; then
        return 0
    fi
    
    # Email notification
    if [[ -n "$NOTIFICATION_EMAIL" ]] && command_exists mail; then
        echo "$message" | mail -s "Database Backup $status" "$NOTIFICATION_EMAIL"
    fi
    
    # Webhook notification
    if [[ -n "$NOTIFICATION_WEBHOOK" ]] && command_exists curl; then
        curl -X POST "$NOTIFICATION_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{\"status\":\"$status\",\"message\":\"$message\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
            --max-time 10 --silent || true
    fi
}

# Format file size
format_size() {
    local bytes="$1"
    if [[ $bytes -gt 1073741824 ]]; then
        echo "$((bytes / 1073741824))GB"
    elif [[ $bytes -gt 1048576 ]]; then
        echo "$((bytes / 1048576))MB"
    elif [[ $bytes -gt 1024 ]]; then
        echo "$((bytes / 1024))KB"
    else
        echo "${bytes}B"
    fi
}

# =======================
# BACKUP FUNCTIONS
# =======================

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check required tools
    local required_tools=("pg_dump" "psql")
    for tool in "${required_tools[@]}"; do
        if ! command_exists "$tool"; then
            log_error "Required tool '$tool' not found. Please install PostgreSQL client tools."
            exit 1
        fi
    done
    
    # Check optional tools
    if [[ "$BACKUP_COMPRESSION" == "true" ]] && ! command_exists gzip; then
        log_warn "gzip not found. Compression will be disabled."
        BACKUP_COMPRESSION="false"
    fi
    
    if [[ "$BACKUP_ENCRYPTION" == "true" ]] && ! command_exists openssl; then
        log_warn "openssl not found. Encryption will be disabled."
        BACKUP_ENCRYPTION="false"
    fi
    
    if [[ "$CLOUD_BACKUP_ENABLED" == "true" ]] && ! command_exists aws; then
        log_warn "AWS CLI not found. Cloud backup will be disabled."
        CLOUD_BACKUP_ENABLED="false"
    fi
    
    # Check database connection
    log_info "Testing database connection..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1 || {
        log_error "Cannot connect to database. Please check connection parameters."
        exit 1
    }
    
    log_success "Prerequisites check completed"
}

# Create database backup
create_backup() {
    local backup_type="$1"
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_filename="ai_employee_platform_${backup_type}_${timestamp}.sql"
    local backup_path="${BACKUP_DIR}/${backup_filename}"
    
    log_info "Starting $backup_type backup: $backup_filename"
    
    # Set PostgreSQL password
    export PGPASSWORD="$DB_PASSWORD"
    
    local start_time=$(date +%s)
    
    case "$backup_type" in
        "full")
            log_info "Creating full database backup..."
            pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
                   -d "$DB_NAME" \
                   --verbose \
                   --no-password \
                   --format=custom \
                   --compress=9 \
                   --file="$backup_path" 2>>"$LOG_FILE"
            ;;
        "schema")
            log_info "Creating schema-only backup..."
            pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
                   -d "$DB_NAME" \
                   --verbose \
                   --no-password \
                   --schema-only \
                   --format=custom \
                   --file="$backup_path" 2>>"$LOG_FILE"
            ;;
        "data")
            log_info "Creating data-only backup..."
            pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
                   -d "$DB_NAME" \
                   --verbose \
                   --no-password \
                   --data-only \
                   --format=custom \
                   --compress=9 \
                   --file="$backup_path" 2>>"$LOG_FILE"
            ;;
        *)
            log_error "Invalid backup type: $backup_type"
            return 1
            ;;
    esac
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    if [[ ! -f "$backup_path" ]]; then
        log_error "Backup file was not created: $backup_path"
        return 1
    fi
    
    local file_size=$(stat -f%z "$backup_path" 2>/dev/null || stat -c%s "$backup_path" 2>/dev/null || echo "0")
    log_success "Backup created successfully: $(format_size $file_size) in ${duration}s"
    
    # Post-process backup file
    if [[ "$BACKUP_COMPRESSION" == "true" ]]; then
        compress_backup "$backup_path"
        backup_path="${backup_path}.gz"
    fi
    
    if [[ "$BACKUP_ENCRYPTION" == "true" ]]; then
        encrypt_backup "$backup_path"
        backup_path="${backup_path}.enc"
    fi
    
    # Upload to cloud storage
    if [[ "$CLOUD_BACKUP_ENABLED" == "true" ]]; then
        upload_to_cloud "$backup_path"
    fi
    
    echo "$backup_path"
}

# Compress backup file
compress_backup() {
    local backup_path="$1"
    log_info "Compressing backup file..."
    
    local start_time=$(date +%s)
    local original_size=$(stat -f%z "$backup_path" 2>/dev/null || stat -c%s "$backup_path" 2>/dev/null || echo "0")
    
    gzip -9 "$backup_path" || {
        log_error "Failed to compress backup file"
        return 1
    }
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local compressed_size=$(stat -f%z "${backup_path}.gz" 2>/dev/null || stat -c%s "${backup_path}.gz" 2>/dev/null || echo "0")
    local compression_ratio=$((100 - (compressed_size * 100 / original_size)))
    
    log_success "Compression completed: $(format_size $original_size) → $(format_size $compressed_size) (${compression_ratio}% reduction) in ${duration}s"
}

# Encrypt backup file
encrypt_backup() {
    local backup_path="$1"
    
    if [[ -z "$BACKUP_ENCRYPTION_KEY" ]]; then
        log_error "Encryption key not provided"
        return 1
    fi
    
    log_info "Encrypting backup file..."
    
    local start_time=$(date +%s)
    
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
        -in "$backup_path" \
        -out "${backup_path}.enc" \
        -k "$BACKUP_ENCRYPTION_KEY" || {
        log_error "Failed to encrypt backup file"
        return 1
    }
    
    # Remove unencrypted file
    rm -f "$backup_path"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Encryption completed in ${duration}s"
}

# Upload backup to cloud storage
upload_to_cloud() {
    local backup_path="$1"
    local backup_filename=$(basename "$backup_path")
    
    if [[ -z "$AWS_S3_BUCKET" ]]; then
        log_error "AWS S3 bucket not configured"
        return 1
    fi
    
    log_info "Uploading backup to S3: s3://${AWS_S3_BUCKET}/database-backups/${backup_filename}"
    
    local start_time=$(date +%s)
    
    aws s3 cp "$backup_path" "s3://${AWS_S3_BUCKET}/database-backups/${backup_filename}" \
        --region "$AWS_REGION" \
        --storage-class STANDARD_IA \
        --metadata "created=$(date -u +%Y-%m-%dT%H:%M:%SZ),database=$DB_NAME,host=$DB_HOST" || {
        log_error "Failed to upload backup to S3"
        return 1
    }
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Cloud upload completed in ${duration}s"
}

# Verify backup integrity
verify_backup() {
    local backup_path="$1"
    log_info "Verifying backup integrity..."
    
    if [[ "$backup_path" == *.enc ]]; then
        log_warn "Encrypted backup verification requires decryption"
        return 0
    fi
    
    local temp_db="verify_backup_$(date +%s)"
    local verification_passed=true
    
    # Create temporary database for verification
    PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$temp_db" 2>/dev/null || {
        log_warn "Cannot create temporary database for verification"
        return 0
    }
    
    # Restore backup to temporary database
    if [[ "$backup_path" == *.gz ]]; then
        log_info "Decompressing and restoring backup for verification..."
        gunzip -c "$backup_path" | PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$temp_db" --verbose 2>>"$LOG_FILE" || verification_passed=false
    else
        log_info "Restoring backup for verification..."
        PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$temp_db" --verbose "$backup_path" 2>>"$LOG_FILE" || verification_passed=false
    fi
    
    if [[ "$verification_passed" == "true" ]]; then
        # Basic integrity checks
        local table_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$temp_db" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs)
        local user_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$temp_db" -t -c "SELECT count(*) FROM \"User\";" 2>/dev/null | xargs || echo "0")
        
        log_success "Backup verification passed - Tables: $table_count, Users: $user_count"
    else
        log_error "Backup verification failed"
    fi
    
    # Cleanup temporary database
    PGPASSWORD="$DB_PASSWORD" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$temp_db" 2>/dev/null || true
    
    return $([ "$verification_passed" == "true" ] && echo 0 || echo 1)
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups (older than $BACKUP_RETENTION_DAYS days)..."
    
    local deleted_count=0
    local deleted_size=0
    
    # Find and delete old local backups
    if command_exists find; then
        while IFS= read -r -d '' file; do
            local file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
            deleted_size=$((deleted_size + file_size))
            rm -f "$file"
            ((deleted_count++))
            log_info "Deleted old backup: $(basename "$file") ($(format_size $file_size))"
        done < <(find "$BACKUP_DIR" -name "ai_employee_platform_*.sql*" -type f -mtime +$BACKUP_RETENTION_DAYS -print0 2>/dev/null)
    fi
    
    # Cleanup old cloud backups
    if [[ "$CLOUD_BACKUP_ENABLED" == "true" ]] && [[ -n "$AWS_S3_BUCKET" ]]; then
        log_info "Cleaning up old cloud backups..."
        local cutoff_date=$(date -u -d "$BACKUP_RETENTION_DAYS days ago" +%Y-%m-%d 2>/dev/null || date -u -v-${BACKUP_RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null)
        
        aws s3api list-objects-v2 \
            --bucket "$AWS_S3_BUCKET" \
            --prefix "database-backups/" \
            --query "Contents[?LastModified<'$cutoff_date'].Key" \
            --output text 2>/dev/null | while read -r key; do
            if [[ -n "$key" && "$key" != "None" ]]; then
                aws s3 rm "s3://${AWS_S3_BUCKET}/$key" --region "$AWS_REGION" >/dev/null 2>&1 && {
                    log_info "Deleted old cloud backup: $key"
                }
            fi
        done
    fi
    
    if [[ $deleted_count -gt 0 ]]; then
        log_success "Cleanup completed: $deleted_count files deleted, $(format_size $deleted_size) freed"
    else
        log_info "No old backups found for cleanup"
    fi
}

# Get backup status and statistics
get_backup_status() {
    log_info "Backup Status Report"
    echo "==================="
    
    # Local backup statistics
    if [[ -d "$BACKUP_DIR" ]]; then
        local backup_count=$(find "$BACKUP_DIR" -name "ai_employee_platform_*.sql*" -type f 2>/dev/null | wc -l)
        local total_size=0
        
        while IFS= read -r file; do
            if [[ -f "$file" ]]; then
                local file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
                total_size=$((total_size + file_size))
            fi
        done < <(find "$BACKUP_DIR" -name "ai_employee_platform_*.sql*" -type f 2>/dev/null)
        
        echo "Local Backups: $backup_count files, $(format_size $total_size)"
        
        # List recent backups
        echo ""
        echo "Recent Backups:"
        find "$BACKUP_DIR" -name "ai_employee_platform_*.sql*" -type f -exec ls -lh {} \; 2>/dev/null | \
            sort -k6,7 -r | head -10 | while read -r line; do
            echo "  $line"
        done
    fi
    
    # Cloud backup statistics
    if [[ "$CLOUD_BACKUP_ENABLED" == "true" ]] && [[ -n "$AWS_S3_BUCKET" ]]; then
        echo ""
        echo "Cloud Backups (S3):"
        aws s3 ls "s3://${AWS_S3_BUCKET}/database-backups/" --recursive --human-readable --summarize 2>/dev/null || {
            echo "  Unable to list cloud backups"
        }
    fi
    
    # Database statistics
    echo ""
    echo "Database Statistics:"
    local db_size=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));" 2>/dev/null | xargs || echo "Unknown")
    echo "  Database Size: $db_size"
    
    local table_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs || echo "Unknown")
    echo "  Tables: $table_count"
    
    local user_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM \"User\";" 2>/dev/null | xargs || echo "Unknown")
    echo "  Users: $user_count"
}

# Restore database from backup
restore_database() {
    local backup_path="$1"
    local target_db="${2:-$DB_NAME}"
    
    if [[ ! -f "$backup_path" ]]; then
        log_error "Backup file not found: $backup_path"
        return 1
    fi
    
    log_warn "WARNING: This will replace the database '$target_db' with the backup data."
    read -p "Are you sure you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^yes$ ]]; then
        log_info "Restore operation cancelled"
        return 0
    fi
    
    log_info "Starting database restore from: $(basename "$backup_path")"
    
    # Handle encrypted backups
    if [[ "$backup_path" == *.enc ]]; then
        if [[ -z "$BACKUP_ENCRYPTION_KEY" ]]; then
            log_error "Encryption key required for encrypted backup"
            return 1
        fi
        
        log_info "Decrypting backup file..."
        local decrypted_path="${backup_path%.enc}"
        openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
            -in "$backup_path" \
            -out "$decrypted_path" \
            -k "$BACKUP_ENCRYPTION_KEY" || {
            log_error "Failed to decrypt backup file"
            return 1
        }
        backup_path="$decrypted_path"
    fi
    
    local start_time=$(date +%s)
    
    # Drop and recreate database
    export PGPASSWORD="$DB_PASSWORD"
    
    log_info "Dropping existing database..."
    dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$target_db" 2>/dev/null || true
    
    log_info "Creating new database..."
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$target_db" || {
        log_error "Failed to create database"
        return 1
    }
    
    # Restore from backup
    log_info "Restoring database from backup..."
    if [[ "$backup_path" == *.gz ]]; then
        gunzip -c "$backup_path" | pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$target_db" --verbose 2>>"$LOG_FILE" || {
            log_error "Failed to restore from compressed backup"
            return 1
        }
    else
        pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$target_db" --verbose "$backup_path" 2>>"$LOG_FILE" || {
            log_error "Failed to restore from backup"
            return 1
        }
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Database restore completed in ${duration}s"
    
    # Cleanup temporary decrypted file
    if [[ "$1" == *.enc ]] && [[ -f "${1%.enc}" ]]; then
        rm -f "${1%.enc}"
    fi
}

# =======================
# MAIN SCRIPT LOGIC
# =======================

show_usage() {
    cat << EOF
AI Employee Platform Database Backup Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  full                Create full database backup (default)
  schema              Create schema-only backup
  data                Create data-only backup
  verify <file>       Verify backup file integrity
  restore <file>      Restore database from backup file
  cleanup             Remove old backup files
  status              Show backup status and statistics
  help                Show this help message

Options:
  --retention <days>  Backup retention period (default: 30)
  --compress          Enable compression (default: true)
  --encrypt           Enable encryption (requires BACKUP_ENCRYPTION_KEY)
  --cloud             Enable cloud storage upload
  --notify            Enable notifications

Examples:
  $0 full --compress --cloud
  $0 schema --retention 7
  $0 verify /path/to/backup.sql
  $0 restore /path/to/backup.sql
  $0 cleanup
  $0 status

Environment Variables:
  DATABASE_HOST             Database host (default: localhost)
  DATABASE_PORT             Database port (default: 5432)
  DATABASE_NAME             Database name (default: ai_employee_platform)
  DATABASE_USER             Database user (default: postgres)
  DATABASE_PASSWORD         Database password (required)
  BACKUP_RETENTION_DAYS     Retention period in days (default: 30)
  BACKUP_ENCRYPTION_KEY     Encryption key for encrypted backups
  AWS_S3_BUCKET            S3 bucket for cloud backups
  AWS_REGION               AWS region (default: us-east-1)
  NOTIFICATION_EMAIL       Email for backup notifications
  NOTIFICATION_WEBHOOK     Webhook URL for notifications

EOF
}

main() {
    local command="${1:-full}"
    shift || true
    
    # Parse command line options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --retention)
                BACKUP_RETENTION_DAYS="$2"
                shift 2
                ;;
            --compress)
                BACKUP_COMPRESSION="true"
                shift
                ;;
            --encrypt)
                BACKUP_ENCRYPTION="true"
                shift
                ;;
            --cloud)
                CLOUD_BACKUP_ENABLED="true"
                shift
                ;;
            --notify)
                NOTIFICATION_ENABLED="true"
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Initialize logging
    log_info "AI Employee Platform Database Backup Script Started"
    log_info "Command: $command"
    
    case "$command" in
        "full"|"schema"|"data")
            check_prerequisites
            local backup_path
            backup_path=$(create_backup "$command")
            if [[ $? -eq 0 ]]; then
                verify_backup "$backup_path"
                cleanup_old_backups
                send_notification "SUCCESS" "Database backup completed successfully: $(basename "$backup_path")"
                log_success "Backup operation completed successfully"
            else
                send_notification "FAILED" "Database backup failed"
                log_error "Backup operation failed"
                exit 1
            fi
            ;;
        "verify")
            if [[ -z "$1" ]]; then
                log_error "Backup file path required for verify command"
                show_usage
                exit 1
            fi
            verify_backup "$1"
            ;;
        "restore")
            if [[ -z "$1" ]]; then
                log_error "Backup file path required for restore command"
                show_usage
                exit 1
            fi
            check_prerequisites
            restore_database "$1" "$2"
            ;;
        "cleanup")
            cleanup_old_backups
            ;;
        "status")
            get_backup_status
            ;;
        "help")
            show_usage
            ;;
        *)
            log_error "Invalid command: $command"
            show_usage
            exit 1
            ;;
    esac
    
    log_info "Script execution completed"
}

# Execute main function with all arguments
main "$@"
