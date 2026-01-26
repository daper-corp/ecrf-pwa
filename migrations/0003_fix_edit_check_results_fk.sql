-- Migration: Fix edit_check_results foreign key constraint
-- BUILT_IN_RULES are not stored in edit_check_rules table
-- Created: 2026-01-26

-- SQLite doesn't support ALTER TABLE to drop constraints
-- So we need to recreate the table

-- Step 1: Create new table without strict foreign key on rule_id
CREATE TABLE IF NOT EXISTS edit_check_results_new (
    id TEXT PRIMARY KEY,
    rule_id TEXT,  -- Can be NULL for built-in rules or reference edit_check_rules
    crf_instance_id TEXT NOT NULL REFERENCES crf_instances(id) ON DELETE CASCADE,
    crf_data_id TEXT REFERENCES crf_data(id) ON DELETE SET NULL,
    
    -- 검증 결과
    passed INTEGER NOT NULL,            -- 1: 통과, 0: 실패
    severity TEXT NOT NULL,             -- ERROR, WARNING, INFO
    error_message TEXT,                 -- 실제 에러 메시지
    
    -- 규칙 정보 (For built-in rules without DB entry)
    rule_code TEXT,                     -- Rule code (e.g., EC001, VS_SBP_RANGE)
    rule_name TEXT,                     -- Rule name for display
    
    -- 대상 정보
    field_code TEXT,
    field_value TEXT,                   -- 검증 시점 값
    
    -- 추가 컨텍스트 (JSON)
    context_data TEXT,                  -- { "related_fields": {...}, "related_visits": {...} }
    
    -- 해결 상태
    resolution_status TEXT DEFAULT 'PENDING' CHECK(resolution_status IN ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED', 'QUERY_OPENED')),
    resolved_by TEXT REFERENCES users(id),
    resolved_at TEXT,
    resolution_comment TEXT,
    
    -- 연관 쿼리
    query_id TEXT REFERENCES queries(id) ON DELETE SET NULL,
    
    -- 배치 실행 정보
    batch_id TEXT REFERENCES edit_check_batches(id) ON DELETE SET NULL,
    
    -- 메타데이터
    executed_at TEXT NOT NULL,
    execution_context TEXT DEFAULT 'MANUAL' CHECK(execution_context IN ('SAVE', 'COMPLETE', 'BATCH', 'MANUAL'))
);

-- Step 2: Copy existing data
INSERT INTO edit_check_results_new 
SELECT 
    id, rule_id, crf_instance_id, crf_data_id,
    passed, severity, error_message,
    NULL as rule_code, NULL as rule_name,
    field_code, field_value, context_data,
    resolution_status, resolved_by, resolved_at, resolution_note,
    query_id, NULL as batch_id, executed_at, execution_context
FROM edit_check_results;

-- Step 3: Drop old table
DROP TABLE IF EXISTS edit_check_results;

-- Step 4: Rename new table
ALTER TABLE edit_check_results_new RENAME TO edit_check_results;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_edit_check_results_rule_id ON edit_check_results(rule_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_crf_instance ON edit_check_results(crf_instance_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_crf_data ON edit_check_results(crf_data_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_passed ON edit_check_results(passed);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_severity ON edit_check_results(severity);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_status ON edit_check_results(resolution_status);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_executed ON edit_check_results(executed_at);
