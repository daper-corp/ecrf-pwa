-- Migration: Enhanced Two-Factor Authentication columns
-- Created: 2026-02-02
-- Production-grade 2FA with rate limiting, lockout, and code reuse prevention

-- Add enhanced 2FA security columns to users table
ALTER TABLE users ADD COLUMN two_factor_pending_setup INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_failed_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_lockout_until TEXT;
ALTER TABLE users ADD COLUMN two_factor_last_used_timestep INTEGER;

-- Create index for 2FA lookups
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled ON users(two_factor_enabled);
CREATE INDEX IF NOT EXISTS idx_users_two_factor_lockout ON users(two_factor_lockout_until);
