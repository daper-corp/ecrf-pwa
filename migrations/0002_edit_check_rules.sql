-- Edit Check Rules Schema
-- 고급 데이터 검증 규칙 엔진을 위한 스키마
-- Created: 2026-01-26

-- =====================================================
-- 1. EDIT CHECK RULES (검증 규칙 정의)
-- =====================================================

-- 검증 규칙 정의 테이블
CREATE TABLE IF NOT EXISTS edit_check_rules (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    rule_code TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL CHECK(rule_type IN (
        'RANGE',           -- 범위 검사 (min/max)
        'REQUIRED',        -- 필수 값 검사
        'CROSS_FIELD',     -- 동일 폼 내 필드 간 검사
        'CROSS_FORM',      -- 폼 간 검사 (같은 Visit)
        'CROSS_VISIT',     -- Visit 간 검사 (시간순서 등)
        'TEMPORAL',        -- 날짜/시간 순서 검사
        'CONDITIONAL',     -- 조건부 검사
        'CONSISTENCY',     -- 일관성 검사
        'MEDICAL_LOGIC',   -- 의학적 논리 검사
        'CUSTOM'           -- 사용자 정의 검사
    )),
    severity TEXT NOT NULL DEFAULT 'ERROR' CHECK(severity IN ('ERROR', 'WARNING', 'INFO')),
    is_active INTEGER DEFAULT 1,
    
    -- 규칙 적용 대상
    target_form_code TEXT,              -- 대상 폼 코드
    target_field_code TEXT,             -- 대상 필드 코드
    
    -- 규칙 정의 (JSON)
    rule_definition TEXT NOT NULL,      -- 규칙 정의 JSON
    -- {
    --   "condition": "optional condition expression",
    --   "expression": "validation expression",
    --   "params": { "key": "value" }
    -- }
    
    -- 에러 메시지
    error_message_template TEXT NOT NULL,
    error_message_ko TEXT,              -- 한국어 메시지
    
    -- 자동 쿼리 생성 설정
    auto_query_enabled INTEGER DEFAULT 0,
    auto_query_priority TEXT DEFAULT 'MINOR' CHECK(auto_query_priority IN ('CRITICAL', 'MAJOR', 'MINOR')),
    auto_query_category TEXT DEFAULT 'DATA_INCONSISTENT' CHECK(auto_query_category IN ('DATA_MISSING', 'DATA_INCONSISTENT', 'DATA_CLARIFICATION', 'PROTOCOL_DEVIATION', 'OTHER')),
    
    -- 메타데이터
    version INTEGER DEFAULT 1,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(study_id, rule_code)
);

-- =====================================================
-- 2. EDIT CHECK RESULTS (검증 결과)
-- =====================================================

-- 검증 실행 결과 테이블
CREATE TABLE IF NOT EXISTS edit_check_results (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES edit_check_rules(id) ON DELETE CASCADE,
    crf_instance_id TEXT NOT NULL REFERENCES crf_instances(id) ON DELETE CASCADE,
    crf_data_id TEXT REFERENCES crf_data(id) ON DELETE SET NULL,
    
    -- 검증 결과
    passed INTEGER NOT NULL,            -- 1: 통과, 0: 실패
    severity TEXT NOT NULL,             -- ERROR, WARNING, INFO
    error_message TEXT,                 -- 실제 에러 메시지
    
    -- 대상 정보
    field_code TEXT,
    field_value TEXT,                   -- 검증 시점 값
    
    -- 추가 컨텍스트 (JSON)
    context_data TEXT,                  -- { "related_fields": {...}, "related_visits": {...} }
    
    -- 해결 상태
    resolution_status TEXT DEFAULT 'PENDING' CHECK(resolution_status IN ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED', 'QUERY_OPENED')),
    resolved_by TEXT REFERENCES users(id),
    resolved_at TEXT,
    resolution_note TEXT,
    
    -- 자동 생성된 쿼리 ID (있는 경우)
    query_id TEXT REFERENCES queries(id),
    
    -- 메타데이터
    executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    execution_context TEXT              -- SAVE, COMPLETE, BATCH, MANUAL
);

-- =====================================================
-- 3. EDIT CHECK BATCH EXECUTIONS (일괄 검증 실행)
-- =====================================================

-- 일괄 검증 실행 히스토리
CREATE TABLE IF NOT EXISTS edit_check_batches (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    
    -- 실행 범위
    scope_type TEXT NOT NULL CHECK(scope_type IN ('STUDY', 'SITE', 'SUBJECT', 'VISIT', 'CRF')),
    scope_id TEXT NOT NULL,             -- 범위에 해당하는 ID
    
    -- 실행 결과 통계
    total_rules_executed INTEGER DEFAULT 0,
    total_checks_performed INTEGER DEFAULT 0,
    passed_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    info_count INTEGER DEFAULT 0,
    
    -- 실행 정보
    executed_by TEXT NOT NULL REFERENCES users(id),
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT DEFAULT 'RUNNING' CHECK(status IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    error_message TEXT
);

-- =====================================================
-- 4. RULE DEPENDENCIES (규칙 의존성)
-- =====================================================

-- 규칙 간 의존성 (실행 순서 결정용)
CREATE TABLE IF NOT EXISTS edit_check_rule_dependencies (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES edit_check_rules(id) ON DELETE CASCADE,
    depends_on_rule_id TEXT NOT NULL REFERENCES edit_check_rules(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rule_id, depends_on_rule_id)
);

-- =====================================================
-- 5. WAIVER LOG (검증 면제 기록)
-- =====================================================

-- 검증 규칙 면제 기록 (예외 처리)
CREATE TABLE IF NOT EXISTS edit_check_waivers (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES edit_check_rules(id),
    
    -- 면제 대상 (하나 이상 지정)
    subject_id TEXT REFERENCES subjects(id),
    visit_id TEXT REFERENCES visits(id),
    crf_instance_id TEXT REFERENCES crf_instances(id),
    
    -- 면제 정보
    waiver_reason TEXT NOT NULL,
    waiver_type TEXT NOT NULL CHECK(waiver_type IN ('PERMANENT', 'TEMPORARY', 'ONE_TIME')),
    expiry_date TEXT,                   -- TEMPORARY의 경우
    
    -- 승인 정보
    requested_by TEXT NOT NULL REFERENCES users(id),
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,
    approval_status TEXT DEFAULT 'PENDING' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT
);

-- =====================================================
-- INDEXES (성능 최적화)
-- =====================================================

-- Edit Check Rules
CREATE INDEX IF NOT EXISTS idx_edit_check_rules_study_id ON edit_check_rules(study_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_rules_type ON edit_check_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_edit_check_rules_target ON edit_check_rules(target_form_code, target_field_code);
CREATE INDEX IF NOT EXISTS idx_edit_check_rules_active ON edit_check_rules(is_active);

-- Edit Check Results
CREATE INDEX IF NOT EXISTS idx_edit_check_results_rule_id ON edit_check_results(rule_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_crf_instance_id ON edit_check_results(crf_instance_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_passed ON edit_check_results(passed);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_severity ON edit_check_results(severity);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_resolution ON edit_check_results(resolution_status);
CREATE INDEX IF NOT EXISTS idx_edit_check_results_executed_at ON edit_check_results(executed_at);

-- Edit Check Batches
CREATE INDEX IF NOT EXISTS idx_edit_check_batches_study_id ON edit_check_batches(study_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_batches_status ON edit_check_batches(status);

-- Waivers
CREATE INDEX IF NOT EXISTS idx_edit_check_waivers_rule_id ON edit_check_waivers(rule_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_waivers_subject_id ON edit_check_waivers(subject_id);
CREATE INDEX IF NOT EXISTS idx_edit_check_waivers_approval ON edit_check_waivers(approval_status);
