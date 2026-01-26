-- Migration: Add EXPORT action to audit_logs
-- Created: 2026-01-26

-- SQLite doesn't support directly modifying CHECK constraints
-- We need to recreate the table

-- Create temporary table
CREATE TABLE audit_logs_new (
    id TEXT PRIMARY KEY,
    -- WHO
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    -- WHEN
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- WHAT
    action TEXT NOT NULL CHECK(action IN ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'SIGN', 'LOCK', 'UNLOCK', 'QUERY_OPEN', 'QUERY_ANSWER', 'QUERY_CLOSE', 'EXPORT')),
    -- WHERE
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    field_name TEXT,
    -- CHANGE DETAILS
    old_value TEXT,
    new_value TEXT,
    -- WHY
    reason_for_change TEXT,
    -- CONTEXT
    study_id TEXT,
    site_id TEXT,
    subject_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    session_id TEXT
);

-- Copy data from old table
INSERT INTO audit_logs_new SELECT * FROM audit_logs;

-- Drop old table
DROP TABLE audit_logs;

-- Rename new table
ALTER TABLE audit_logs_new RENAME TO audit_logs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_study_id ON audit_logs(study_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);
