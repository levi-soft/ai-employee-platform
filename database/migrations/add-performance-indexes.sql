
-- Performance Index Migration for AI Employee Platform
-- Created: 2025-08-08
-- Purpose: Add critical performance indexes for all database tables

-- Begin Transaction
BEGIN;

-- =======================
-- USER-RELATED INDEXES
-- =======================

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON "User"(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON "User"(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON "User"("isActive");
CREATE INDEX IF NOT EXISTS idx_users_created_at ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS idx_users_email_active ON "User"(email, "isActive");
CREATE INDEX IF NOT EXISTS idx_users_role_active ON "User"(role, "isActive");

-- Credit Accounts indexes
CREATE INDEX IF NOT EXISTS idx_credit_accounts_user_id ON "CreditAccount"("userId");
CREATE INDEX IF NOT EXISTS idx_credit_accounts_balance ON "CreditAccount"(balance);
CREATE INDEX IF NOT EXISTS idx_credit_accounts_updated_at ON "CreditAccount"("updatedAt");

-- =======================
-- TRANSACTION INDEXES  
-- =======================

-- Transactions table indexes (most critical for performance)
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON "Transaction"("userId");
CREATE INDEX IF NOT EXISTS idx_transactions_type ON "Transaction"(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON "Transaction"(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON "Transaction"("createdAt");
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON "Transaction"(amount);

-- Composite indexes for common transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON "Transaction"("userId", type);
CREATE INDEX IF NOT EXISTS idx_transactions_user_status ON "Transaction"("userId", status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON "Transaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON "Transaction"(type, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_status ON "Transaction"("userId", type, status);

-- Date-based transaction queries (for analytics)
CREATE INDEX IF NOT EXISTS idx_transactions_date_range ON "Transaction"("createdAt", "userId", amount);
CREATE INDEX IF NOT EXISTS idx_transactions_monthly ON "Transaction"(
  EXTRACT(YEAR FROM "createdAt"), 
  EXTRACT(MONTH FROM "createdAt"), 
  "userId"
);

-- =======================
-- AI AGENT INDEXES
-- =======================

-- AI Agents table indexes
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON "AIAgent"("isActive");
CREATE INDEX IF NOT EXISTS idx_ai_agents_provider ON "AIAgent"(provider);
CREATE INDEX IF NOT EXISTS idx_ai_agents_model ON "AIAgent"(model);
CREATE INDEX IF NOT EXISTS idx_ai_agents_cost ON "AIAgent"("costPerRequest");
CREATE INDEX IF NOT EXISTS idx_ai_agents_provider_active ON "AIAgent"(provider, "isActive");
CREATE INDEX IF NOT EXISTS idx_ai_agents_cost_active ON "AIAgent"("costPerRequest", "isActive");

-- AI Request logs indexes (high volume table)
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_id ON "AIRequest"("userId");
CREATE INDEX IF NOT EXISTS idx_ai_requests_agent_id ON "AIRequest"("agentId");
CREATE INDEX IF NOT EXISTS idx_ai_requests_status ON "AIRequest"(status);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created_at ON "AIRequest"("createdAt");
CREATE INDEX IF NOT EXISTS idx_ai_requests_cost ON "AIRequest"("totalCost");

-- Composite AI request indexes for analytics
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_agent ON "AIRequest"("userId", "agentId");
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_created ON "AIRequest"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_ai_requests_agent_created ON "AIRequest"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_cost ON "AIRequest"("userId", "totalCost");

-- Time-based AI request queries (for usage analytics)
CREATE INDEX IF NOT EXISTS idx_ai_requests_hourly ON "AIRequest"(
  EXTRACT(HOUR FROM "createdAt"),
  "userId",
  "agentId"
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_daily ON "AIRequest"(
  DATE("createdAt"),
  "userId"
);

-- =======================
-- PLUGIN SYSTEM INDEXES
-- =======================

-- Plugins table indexes
CREATE INDEX IF NOT EXISTS idx_plugins_active ON "Plugin"("isActive");
CREATE INDEX IF NOT EXISTS idx_plugins_author ON "Plugin"(author);
CREATE INDEX IF NOT EXISTS idx_plugins_version ON "Plugin"(version);
CREATE INDEX IF NOT EXISTS idx_plugins_created_at ON "Plugin"("createdAt");
CREATE INDEX IF NOT EXISTS idx_plugins_rating ON "Plugin"(rating);

-- User Plugins relationship indexes
CREATE INDEX IF NOT EXISTS idx_user_plugins_user_id ON "UserPlugin"("userId");
CREATE INDEX IF NOT EXISTS idx_user_plugins_plugin_id ON "UserPlugin"("pluginId");
CREATE INDEX IF NOT EXISTS idx_user_plugins_active ON "UserPlugin"("isActive");
CREATE INDEX IF NOT EXISTS idx_user_plugins_installed ON "UserPlugin"("installedAt");

-- Composite plugin indexes
CREATE INDEX IF NOT EXISTS idx_user_plugins_user_active ON "UserPlugin"("userId", "isActive");
CREATE INDEX IF NOT EXISTS idx_plugins_author_active ON "Plugin"(author, "isActive");
CREATE INDEX IF NOT EXISTS idx_plugins_rating_active ON "Plugin"(rating DESC, "isActive");

-- =======================
-- BUDGET MANAGEMENT INDEXES
-- =======================

-- Budget Limits indexes
CREATE INDEX IF NOT EXISTS idx_budget_limits_user_id ON "BudgetLimit"("userId");
CREATE INDEX IF NOT EXISTS idx_budget_limits_period ON "BudgetLimit"(period);
CREATE INDEX IF NOT EXISTS idx_budget_limits_active ON "BudgetLimit"("isActive");
CREATE INDEX IF NOT EXISTS idx_budget_limits_amount ON "BudgetLimit"(amount);

-- Composite budget indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_budget_limits_user_period ON "BudgetLimit"("userId", period);
CREATE INDEX IF NOT EXISTS idx_budget_limits_user_active ON "BudgetLimit"("userId", "isActive");
CREATE INDEX IF NOT EXISTS idx_budget_limits_period_active ON "BudgetLimit"(period, "isActive");

-- =======================
-- FULL-TEXT SEARCH INDEXES (PostgreSQL specific)
-- =======================

-- Full-text search for users (name, email)
CREATE INDEX IF NOT EXISTS idx_users_fulltext ON "User" USING GIN(
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(email, ''))
);

-- Full-text search for plugins (name, description)
CREATE INDEX IF NOT EXISTS idx_plugins_fulltext ON "Plugin" USING GIN(
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(description, ''))
);

-- Full-text search for AI agents (name, description, capabilities)
CREATE INDEX IF NOT EXISTS idx_ai_agents_fulltext ON "AIAgent" USING GIN(
  to_tsvector('english', 
    COALESCE(name, '') || ' ' || 
    COALESCE(description, '') || ' ' || 
    COALESCE(array_to_string(capabilities, ' '), '')
  )
);

-- =======================
-- PARTIAL INDEXES (for better performance on specific conditions)
-- =======================

-- Index only active users
CREATE INDEX IF NOT EXISTS idx_users_active_only ON "User"(email, name) WHERE "isActive" = true;

-- Index only successful transactions
CREATE INDEX IF NOT EXISTS idx_transactions_success_only ON "Transaction"("userId", "createdAt", amount) 
WHERE status = 'COMPLETED';

-- Index only active AI agents
CREATE INDEX IF NOT EXISTS idx_ai_agents_active_only ON "AIAgent"(provider, model, "costPerRequest") 
WHERE "isActive" = true;

-- Index only installed user plugins
CREATE INDEX IF NOT EXISTS idx_user_plugins_installed_only ON "UserPlugin"("userId", "pluginId", "installedAt") 
WHERE "isActive" = true;

-- =======================
-- STATISTICS UPDATE
-- =======================

-- Update table statistics for better query planning
ANALYZE "User";
ANALYZE "CreditAccount";
ANALYZE "Transaction";
ANALYZE "AIAgent";
ANALYZE "AIRequest";
ANALYZE "Plugin";
ANALYZE "UserPlugin";
ANALYZE "BudgetLimit";

-- Commit Transaction
COMMIT;

-- =======================
-- INDEX USAGE MONITORING
-- =======================

-- Create view for monitoring index usage
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Create view for unused indexes
CREATE OR REPLACE VIEW unused_indexes AS
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- =======================
-- PERFORMANCE MONITORING
-- =======================

-- Create function to get slow queries
CREATE OR REPLACE FUNCTION get_slow_queries()
RETURNS TABLE(
    query_text text,
    calls bigint,
    mean_time double precision,
    total_time double precision,
    rows_affected bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pg_stat_statements.query,
        pg_stat_statements.calls,
        pg_stat_statements.mean_exec_time,
        pg_stat_statements.total_exec_time,
        pg_stat_statements.rows
    FROM pg_stat_statements
    WHERE pg_stat_statements.mean_exec_time > 100 -- queries taking more than 100ms
    ORDER BY pg_stat_statements.mean_exec_time DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

PRINT 'Performance indexes created successfully!';
PRINT 'Total indexes added: ~40 indexes';
PRINT 'Index monitoring views and functions created.';
PRINT 'Run ANALYZE on all tables completed.';
