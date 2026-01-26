-- Migration: Add Two-Factor Authentication columns to users table
-- Created: 2026-01-26

-- Add 2FA columns to users table
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_verified_at TEXT;
ALTER TABLE users ADD COLUMN two_factor_backup_codes TEXT;

-- Add push notification columns
ALTER TABLE users ADD COLUMN push_subscription TEXT;
ALTER TABLE users ADD COLUMN notification_preferences TEXT DEFAULT '{"query":true,"signature":true,"lock":true}';
