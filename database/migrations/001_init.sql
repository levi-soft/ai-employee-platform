
-- Initial database setup with indexes for performance
-- This migration creates performance indexes for the AI Employee Platform

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Credit Accounts table indexes
CREATE INDEX IF NOT EXISTS idx_credit_accounts_user_id ON credit_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_accounts_balance ON credit_accounts(balance);

-- AI Agents table indexes
CREATE INDEX IF NOT EXISTS idx_ai_agents_provider ON ai_agents(provider);
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON ai_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_agents_cost ON ai_agents(cost_per_token);
CREATE INDEX IF NOT EXISTS idx_ai_agents_capabilities ON ai_agents USING GIN(capabilities);

-- Transactions table indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_ai_agent_id ON transactions(ai_agent_id);

-- AI Requests table indexes  
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_id ON ai_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_ai_agent_id ON ai_requests(ai_agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_status ON ai_requests(status);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created_at ON ai_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cost ON ai_requests(cost);

-- Plugins table indexes
CREATE INDEX IF NOT EXISTS idx_plugins_category ON plugins(category);
CREATE INDEX IF NOT EXISTS idx_plugins_official ON plugins(is_official);
CREATE INDEX IF NOT EXISTS idx_plugins_active ON plugins(is_active);

-- User Plugins table indexes
CREATE INDEX IF NOT EXISTS idx_user_plugins_user_id ON user_plugins(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plugins_plugin_id ON user_plugins(plugin_id);
CREATE INDEX IF NOT EXISTS idx_user_plugins_enabled ON user_plugins(is_enabled);

-- Budget Limits table indexes
CREATE INDEX IF NOT EXISTS idx_budget_limits_user_id ON budget_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_limits_type ON budget_limits(limit_type);
CREATE INDEX IF NOT EXISTS idx_budget_limits_active ON budget_limits(is_active);
CREATE INDEX IF NOT EXISTS idx_budget_limits_reset_date ON budget_limits(reset_date);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date ON transactions(user_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_agent_date ON ai_requests(user_id, ai_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_plugins_user_enabled ON user_plugins(user_id, is_enabled);
