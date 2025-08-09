
-- Data Archiving Strategy for AI Employee Platform
-- Automated data archiving and cleanup procedures
-- Created: 2025-08-08

-- =======================
-- ARCHIVING CONFIGURATION
-- =======================

-- Create archiving schema for old data
CREATE SCHEMA IF NOT EXISTS archive;

-- Set default retention periods (configurable)
DO $$
DECLARE
    -- Retention periods in days
    ai_request_retention CONSTANT INTEGER := 365;        -- 1 year
    transaction_retention CONSTANT INTEGER := 2555;      -- 7 years (compliance)
    audit_log_retention CONSTANT INTEGER := 1095;        -- 3 years
    notification_history_retention CONSTANT INTEGER := 90; -- 3 months
    session_data_retention CONSTANT INTEGER := 30;       -- 1 month
BEGIN
    -- Store configuration in a settings table
    CREATE TABLE IF NOT EXISTS archive.archiving_config (
        setting_name VARCHAR(100) PRIMARY KEY,
        setting_value INTEGER NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Insert or update retention settings
    INSERT INTO archive.archiving_config (setting_name, setting_value, description) VALUES
        ('ai_request_retention_days', ai_request_retention, 'AI request logs retention period'),
        ('transaction_retention_days', transaction_retention, 'Financial transaction retention period'),
        ('audit_log_retention_days', audit_log_retention, 'Security audit log retention period'),
        ('notification_retention_days', notification_history_retention, 'Notification history retention period'),
        ('session_retention_days', session_data_retention, 'Session data retention period')
    ON CONFLICT (setting_name) DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_at = CURRENT_TIMESTAMP;
END
$$;

-- =======================
-- ARCHIVE TABLES
-- =======================

-- Archived AI Requests table
CREATE TABLE IF NOT EXISTS archive."AIRequest" (
    id VARCHAR(50) PRIMARY KEY,
    "userId" VARCHAR(50) NOT NULL,
    "agentId" VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    response TEXT,
    "tokenUsed" INTEGER DEFAULT 0,
    "totalCost" DECIMAL(10,2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'PENDING',
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Additional archival metadata
    archive_reason TEXT,
    original_table_name TEXT DEFAULT 'AIRequest'
);

-- Archived Transactions table
CREATE TABLE IF NOT EXISTS archive."Transaction" (
    id VARCHAR(50) PRIMARY KEY,
    "userId" VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'PENDING',
    "requestId" VARCHAR(50),
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Additional archival metadata
    archive_reason TEXT,
    original_table_name TEXT DEFAULT 'Transaction'
);

-- Archived Audit Logs table (if it exists)
CREATE TABLE IF NOT EXISTS archive.audit_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    ip_address INET,
    user_agent TEXT,
    severity VARCHAR(20) DEFAULT 'LOW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Additional archival metadata
    archive_reason TEXT,
    original_table_name TEXT DEFAULT 'audit_logs'
);

-- Archived Notification History table (if it exists)
CREATE TABLE IF NOT EXISTS archive.notification_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL,
    subject VARCHAR(255),
    content TEXT,
    status VARCHAR(20) DEFAULT 'PENDING',
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Additional archival metadata
    archive_reason TEXT,
    original_table_name TEXT DEFAULT 'notification_history'
);

-- Create indexes for archived tables
CREATE INDEX IF NOT EXISTS idx_archive_ai_requests_user_created ON archive."AIRequest"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_archive_ai_requests_archived_at ON archive."AIRequest"("archivedAt");
CREATE INDEX IF NOT EXISTS idx_archive_transactions_user_created ON archive."Transaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_archive_transactions_archived_at ON archive."Transaction"("archivedAt");
CREATE INDEX IF NOT EXISTS idx_archive_audit_logs_created ON archive.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_archive_notification_history_created ON archive.notification_history(created_at);

-- =======================
-- ARCHIVING FUNCTIONS
-- =======================

-- Function to get retention period for a specific type
CREATE OR REPLACE FUNCTION archive.get_retention_days(setting_name TEXT)
RETURNS INTEGER AS $$
DECLARE
    retention_days INTEGER;
BEGIN
    SELECT setting_value INTO retention_days 
    FROM archive.archiving_config 
    WHERE archiving_config.setting_name = get_retention_days.setting_name;
    
    RETURN COALESCE(retention_days, 365); -- Default to 1 year if not found
END;
$$ LANGUAGE plpgsql;

-- Function to archive AI Requests
CREATE OR REPLACE FUNCTION archive.archive_ai_requests()
RETURNS TABLE(archived_count INTEGER, freed_space TEXT) AS $$
DECLARE
    retention_days INTEGER;
    cutoff_date TIMESTAMP;
    archived_records INTEGER := 0;
    table_size_before BIGINT;
    table_size_after BIGINT;
BEGIN
    -- Get retention period
    retention_days := archive.get_retention_days('ai_request_retention_days');
    cutoff_date := CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Get table size before archiving
    SELECT pg_total_relation_size('"AIRequest"'::regclass) INTO table_size_before;
    
    -- Archive old AI requests
    WITH archived AS (
        INSERT INTO archive."AIRequest" (
            id, "userId", "agentId", prompt, response, "tokenUsed", 
            "totalCost", status, "createdAt", "updatedAt", "archivedAt", archive_reason
        )
        SELECT 
            id, "userId", "agentId", prompt, response, "tokenUsed",
            "totalCost", status, "createdAt", "updatedAt", CURRENT_TIMESTAMP,
            'Automatic archiving - data older than ' || retention_days || ' days'
        FROM "AIRequest"
        WHERE "createdAt" < cutoff_date
        RETURNING id
    ),
    deleted AS (
        DELETE FROM "AIRequest"
        WHERE id IN (SELECT id FROM archived)
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_records FROM deleted;
    
    -- Get table size after archiving
    SELECT pg_total_relation_size('"AIRequest"'::regclass) INTO table_size_after;
    
    -- Update statistics
    ANALYZE "AIRequest";
    ANALYZE archive."AIRequest";
    
    RETURN QUERY SELECT 
        archived_records,
        pg_size_pretty(table_size_before - table_size_after);
END;
$$ LANGUAGE plpgsql;

-- Function to archive Transactions (with compliance considerations)
CREATE OR REPLACE FUNCTION archive.archive_transactions()
RETURNS TABLE(archived_count INTEGER, freed_space TEXT) AS $$
DECLARE
    retention_days INTEGER;
    cutoff_date TIMESTAMP;
    archived_records INTEGER := 0;
    table_size_before BIGINT;
    table_size_after BIGINT;
BEGIN
    -- Get retention period (transactions have longer retention for compliance)
    retention_days := archive.get_retention_days('transaction_retention_days');
    cutoff_date := CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Get table size before archiving
    SELECT pg_total_relation_size('"Transaction"'::regclass) INTO table_size_before;
    
    -- Archive old transactions (only completed/cancelled ones)
    WITH archived AS (
        INSERT INTO archive."Transaction" (
            id, "userId", type, amount, description, status, "requestId", 
            metadata, "createdAt", "updatedAt", "archivedAt", archive_reason
        )
        SELECT 
            id, "userId", type, amount, description, status, "requestId",
            metadata, "createdAt", "updatedAt", CURRENT_TIMESTAMP,
            'Automatic archiving - completed transactions older than ' || retention_days || ' days'
        FROM "Transaction"
        WHERE "createdAt" < cutoff_date 
        AND status IN ('COMPLETED', 'CANCELLED', 'FAILED')
        RETURNING id
    ),
    deleted AS (
        DELETE FROM "Transaction"
        WHERE id IN (SELECT id FROM archived)
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_records FROM deleted;
    
    -- Get table size after archiving
    SELECT pg_total_relation_size('"Transaction"'::regclass) INTO table_size_after;
    
    -- Update statistics
    ANALYZE "Transaction";
    ANALYZE archive."Transaction";
    
    RETURN QUERY SELECT 
        archived_records,
        pg_size_pretty(table_size_before - table_size_after);
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old session data (if exists in Redis, this is for any SQL-based sessions)
CREATE OR REPLACE FUNCTION archive.cleanup_old_sessions()
RETURNS INTEGER AS $$
DECLARE
    retention_days INTEGER;
    cutoff_date TIMESTAMP;
    deleted_records INTEGER := 0;
BEGIN
    retention_days := archive.get_retention_days('session_retention_days');
    cutoff_date := CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- This would clean up any SQL-based session storage
    -- For Redis sessions, this would be handled by Redis TTL
    
    RETURN deleted_records;
END;
$$ LANGUAGE plpgsql;

-- Function to archive old plugin usage logs (if they exist)
CREATE OR REPLACE FUNCTION archive.archive_plugin_logs()
RETURNS INTEGER AS $$
DECLARE
    retention_days INTEGER := 180; -- 6 months for plugin logs
    cutoff_date TIMESTAMP;
    archived_records INTEGER := 0;
BEGIN
    cutoff_date := CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Archive plugin usage logs if table exists
    -- This is a placeholder for future plugin usage tracking
    
    RETURN archived_records;
END;
$$ LANGUAGE plpgsql;

-- Master archiving function
CREATE OR REPLACE FUNCTION archive.run_archiving_process()
RETURNS TABLE(
    operation TEXT,
    records_archived INTEGER,
    space_freed TEXT,
    execution_time INTERVAL,
    status TEXT
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    ai_result RECORD;
    tx_result RECORD;
    session_result INTEGER;
    plugin_result INTEGER;
BEGIN
    start_time := CURRENT_TIMESTAMP;
    
    -- Archive AI Requests
    SELECT * FROM archive.archive_ai_requests() INTO ai_result;
    end_time := CURRENT_TIMESTAMP;
    
    RETURN QUERY SELECT 
        'AI Requests'::TEXT,
        ai_result.archived_count,
        ai_result.freed_space,
        end_time - start_time,
        'SUCCESS'::TEXT;
    
    -- Archive Transactions
    start_time := CURRENT_TIMESTAMP;
    SELECT * FROM archive.archive_transactions() INTO tx_result;
    end_time := CURRENT_TIMESTAMP;
    
    RETURN QUERY SELECT 
        'Transactions'::TEXT,
        tx_result.archived_count,
        tx_result.freed_space,
        end_time - start_time,
        'SUCCESS'::TEXT;
    
    -- Cleanup Sessions
    start_time := CURRENT_TIMESTAMP;
    SELECT archive.cleanup_old_sessions() INTO session_result;
    end_time := CURRENT_TIMESTAMP;
    
    RETURN QUERY SELECT 
        'Session Cleanup'::TEXT,
        session_result,
        'N/A'::TEXT,
        end_time - start_time,
        'SUCCESS'::TEXT;
    
    -- Archive Plugin Logs
    start_time := CURRENT_TIMESTAMP;
    SELECT archive.archive_plugin_logs() INTO plugin_result;
    end_time := CURRENT_TIMESTAMP;
    
    RETURN QUERY SELECT 
        'Plugin Logs'::TEXT,
        plugin_result,
        'N/A'::TEXT,
        end_time - start_time,
        'SUCCESS'::TEXT;
    
    -- Update archiving log
    INSERT INTO archive.archiving_log (
        run_date,
        ai_requests_archived,
        transactions_archived,
        total_records_archived,
        execution_time,
        status
    ) VALUES (
        CURRENT_TIMESTAMP,
        ai_result.archived_count,
        tx_result.archived_count,
        ai_result.archived_count + tx_result.archived_count + session_result + plugin_result,
        CURRENT_TIMESTAMP - start_time,
        'SUCCESS'
    );

EXCEPTION WHEN OTHERS THEN
    -- Log error
    INSERT INTO archive.archiving_log (
        run_date,
        ai_requests_archived,
        transactions_archived,
        total_records_archived,
        execution_time,
        status,
        error_message
    ) VALUES (
        CURRENT_TIMESTAMP,
        0,
        0,
        0,
        CURRENT_TIMESTAMP - start_time,
        'ERROR',
        SQLERRM
    );
    
    RETURN QUERY SELECT 
        'ERROR'::TEXT,
        0,
        'N/A'::TEXT,
        CURRENT_TIMESTAMP - start_time,
        SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- ARCHIVING LOG TABLE
-- =======================

-- Create archiving execution log
CREATE TABLE IF NOT EXISTS archive.archiving_log (
    id SERIAL PRIMARY KEY,
    run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ai_requests_archived INTEGER DEFAULT 0,
    transactions_archived INTEGER DEFAULT 0,
    total_records_archived INTEGER DEFAULT 0,
    execution_time INTERVAL,
    status VARCHAR(20) DEFAULT 'RUNNING',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_archiving_log_run_date ON archive.archiving_log(run_date);
CREATE INDEX IF NOT EXISTS idx_archiving_log_status ON archive.archiving_log(status);

-- =======================
-- UTILITY FUNCTIONS
-- =======================

-- Function to get archive statistics
CREATE OR REPLACE FUNCTION archive.get_archive_stats()
RETURNS TABLE(
    table_name TEXT,
    live_records BIGINT,
    archived_records BIGINT,
    total_size TEXT,
    archive_size TEXT,
    oldest_live_record TIMESTAMP,
    newest_archived_record TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    WITH stats AS (
        SELECT 
            'AIRequest' as tbl_name,
            (SELECT COUNT(*) FROM "AIRequest") as live_count,
            (SELECT COUNT(*) FROM archive."AIRequest") as archived_count,
            pg_size_pretty(pg_total_relation_size('"AIRequest"'::regclass)) as live_size,
            pg_size_pretty(pg_total_relation_size('archive."AIRequest"'::regclass)) as arch_size,
            (SELECT MIN("createdAt") FROM "AIRequest") as oldest_live,
            (SELECT MAX("createdAt") FROM archive."AIRequest") as newest_archived
        
        UNION ALL
        
        SELECT 
            'Transaction' as tbl_name,
            (SELECT COUNT(*) FROM "Transaction") as live_count,
            (SELECT COUNT(*) FROM archive."Transaction") as archived_count,
            pg_size_pretty(pg_total_relation_size('"Transaction"'::regclass)) as live_size,
            pg_size_pretty(pg_total_relation_size('archive."Transaction"'::regclass)) as arch_size,
            (SELECT MIN("createdAt") FROM "Transaction") as oldest_live,
            (SELECT MAX("createdAt") FROM archive."Transaction") as newest_archived
    )
    SELECT * FROM stats;
END;
$$ LANGUAGE plpgsql;

-- Function to restore archived data (emergency use)
CREATE OR REPLACE FUNCTION archive.restore_archived_data(
    table_type TEXT,
    start_date TIMESTAMP,
    end_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
RETURNS INTEGER AS $$
DECLARE
    restored_count INTEGER := 0;
BEGIN
    CASE table_type
        WHEN 'ai_requests' THEN
            WITH restored AS (
                INSERT INTO "AIRequest" (
                    id, "userId", "agentId", prompt, response, "tokenUsed",
                    "totalCost", status, "createdAt", "updatedAt"
                )
                SELECT 
                    id, "userId", "agentId", prompt, response, "tokenUsed",
                    "totalCost", status, "createdAt", "updatedAt"
                FROM archive."AIRequest"
                WHERE "createdAt" BETWEEN start_date AND end_date
                RETURNING id
            ),
            deleted AS (
                DELETE FROM archive."AIRequest"
                WHERE "createdAt" BETWEEN start_date AND end_date
                RETURNING id
            )
            SELECT COUNT(*) INTO restored_count FROM restored;
            
        WHEN 'transactions' THEN
            WITH restored AS (
                INSERT INTO "Transaction" (
                    id, "userId", type, amount, description, status, "requestId",
                    metadata, "createdAt", "updatedAt"
                )
                SELECT 
                    id, "userId", type, amount, description, status, "requestId",
                    metadata, "createdAt", "updatedAt"
                FROM archive."Transaction"
                WHERE "createdAt" BETWEEN start_date AND end_date
                RETURNING id
            ),
            deleted AS (
                DELETE FROM archive."Transaction"
                WHERE "createdAt" BETWEEN start_date AND end_date
                RETURNING id
            )
            SELECT COUNT(*) INTO restored_count FROM restored;
            
        ELSE
            RAISE EXCEPTION 'Invalid table type: %', table_type;
    END CASE;
    
    RETURN restored_count;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- AUTOMATED SCHEDULING
-- =======================

-- Create a view for monitoring archiving schedule
CREATE OR REPLACE VIEW archive.archiving_schedule AS
SELECT 
    'AI Requests' as data_type,
    get_retention_days('ai_request_retention_days') as retention_days,
    COUNT(*) as eligible_records,
    pg_size_pretty(SUM(LENGTH(prompt::TEXT) + LENGTH(COALESCE(response::TEXT, '')))) as estimated_space
FROM "AIRequest"
WHERE "createdAt" < CURRENT_TIMESTAMP - (get_retention_days('ai_request_retention_days') || ' days')::INTERVAL

UNION ALL

SELECT 
    'Transactions' as data_type,
    get_retention_days('transaction_retention_days') as retention_days,
    COUNT(*) as eligible_records,
    pg_size_pretty(SUM(COALESCE(LENGTH(description::TEXT), 0))) as estimated_space
FROM "Transaction"
WHERE "createdAt" < CURRENT_TIMESTAMP - (get_retention_days('transaction_retention_days') || ' days')::INTERVAL
AND status IN ('COMPLETED', 'CANCELLED', 'FAILED');

-- =======================
-- SAMPLE USAGE
-- =======================

/*
-- Run full archiving process
SELECT * FROM archive.run_archiving_process();

-- Get archive statistics
SELECT * FROM archive.get_archive_stats();

-- View archiving schedule
SELECT * FROM archive.archiving_schedule;

-- Get archiving history
SELECT * FROM archive.archiving_log ORDER BY run_date DESC LIMIT 10;

-- Update retention settings
UPDATE archive.archiving_config 
SET setting_value = 90 
WHERE setting_name = 'ai_request_retention_days';

-- Emergency restore (use with caution)
SELECT archive.restore_archived_data('ai_requests', '2024-01-01', '2024-01-31');
*/

-- Initialize with a comment
COMMENT ON SCHEMA archive IS 'Archive schema for AI Employee Platform - Contains archived data and archiving utilities';

-- Log successful creation
INSERT INTO archive.archiving_log (
    run_date,
    ai_requests_archived,
    transactions_archived,
    total_records_archived,
    execution_time,
    status,
    error_message
) VALUES (
    CURRENT_TIMESTAMP,
    0,
    0,
    0,
    '0 seconds'::INTERVAL,
    'SETUP',
    'Data archiving system initialized successfully'
);

PRINT 'Data archiving system created successfully!';
PRINT 'Schema: archive';
PRINT 'Functions: archive_ai_requests(), archive_transactions(), run_archiving_process()';
PRINT 'Views: archiving_schedule, archiving_log';
PRINT 'Usage: SELECT * FROM archive.run_archiving_process();';
