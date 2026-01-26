-- eCRF PWA Initial Schema
-- 21 CFR Part 11 준수를 위한 데이터베이스 스키마
-- Created: 2025-01-26

-- =====================================================
-- 1. USERS & AUTHENTICATION (사용자 및 인증)
-- =====================================================

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    password_changed_at TEXT,
    last_login_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 세션 테이블 (JWT 토큰 관리용)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 비밀번호 히스토리 (재사용 방지)
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 2. STUDY (임상시험)
-- =====================================================

CREATE TABLE IF NOT EXISTS studies (
    id TEXT PRIMARY KEY,
    protocol_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    short_title TEXT,
    version TEXT NOT NULL DEFAULT '1.0',
    phase TEXT CHECK(phase IN ('I', 'II', 'III', 'IV', 'NA')),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'LOCKED', 'CANCELLED')),
    sponsor TEXT,
    irb_approval_number TEXT,
    irb_approval_date TEXT,
    irb_expiry_date TEXT,
    study_start_date TEXT,
    study_end_date TEXT,
    description TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Visit 스케줄 정의 (Study별)
CREATE TABLE IF NOT EXISTS visit_schedules (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    visit_name TEXT NOT NULL,
    visit_number INTEGER NOT NULL,
    visit_window_before INTEGER DEFAULT 0,  -- 방문 허용 범위 (이전, 일)
    visit_window_after INTEGER DEFAULT 0,   -- 방문 허용 범위 (이후, 일)
    target_day INTEGER,                     -- 기준일로부터 목표 일수
    is_required INTEGER DEFAULT 1,          -- 필수 방문 여부
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(study_id, visit_number)
);

-- CRF 폼 정의 (Study/Visit별)
CREATE TABLE IF NOT EXISTS form_definitions (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    visit_schedule_id TEXT REFERENCES visit_schedules(id) ON DELETE SET NULL,
    form_name TEXT NOT NULL,
    form_code TEXT NOT NULL,
    form_order INTEGER DEFAULT 0,
    is_required INTEGER DEFAULT 1,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(study_id, form_code)
);

-- 필드 정의 (폼별)
CREATE TABLE IF NOT EXISTS field_definitions (
    id TEXT PRIMARY KEY,
    form_definition_id TEXT NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    field_code TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK(field_type IN ('TEXT', 'NUMBER', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT', 'RADIO', 'CHECKBOX', 'TEXTAREA', 'CALCULATED')),
    field_order INTEGER DEFAULT 0,
    is_required INTEGER DEFAULT 0,
    is_key INTEGER DEFAULT 0,           -- Primary key 필드 여부
    default_value TEXT,
    placeholder TEXT,
    help_text TEXT,
    min_value TEXT,
    max_value TEXT,
    options TEXT,                        -- JSON 형식: [{"value": "M", "label": "Male"}, ...]
    calculation_formula TEXT,            -- 계산식 (CALCULATED 타입)
    skip_logic TEXT,                     -- 조건부 표시 로직 (JSON)
    validation_rules TEXT,               -- 검증 규칙 (JSON)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(form_definition_id, field_code)
);

-- =====================================================
-- 3. SITE (연구 기관)
-- =====================================================

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    site_number TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'KR',
    pi_name TEXT,
    pi_email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACTIVE', 'CLOSED', 'SUSPENDED')),
    activation_date TEXT,
    closure_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(study_id, site_number)
);

-- Site 사용자 매핑 (다대다)
CREATE TABLE IF NOT EXISTS site_users (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary INTEGER DEFAULT 0,        -- 기관 대표 여부
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, user_id)
);

-- =====================================================
-- 4. SUBJECT (피험자)
-- =====================================================

CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    subject_number TEXT NOT NULL,
    screening_number TEXT,
    randomization_number TEXT,
    initials TEXT,                       -- 이니셜 (개인정보 보호)
    status TEXT NOT NULL DEFAULT 'SCREENING' CHECK(status IN ('SCREENING', 'SCREEN_FAILED', 'ENROLLED', 'RANDOMIZED', 'COMPLETED', 'WITHDRAWN', 'LOST_TO_FOLLOWUP')),
    screening_date TEXT,
    enrolled_date TEXT,
    randomized_date TEXT,
    completed_date TEXT,
    withdrawn_date TEXT,
    withdrawal_reason TEXT,
    withdrawal_initiated_by TEXT,        -- SUBJECT, INVESTIGATOR, SPONSOR
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, subject_number)
);

-- =====================================================
-- 5. VISIT (방문)
-- =====================================================

CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    visit_schedule_id TEXT REFERENCES visit_schedules(id),
    visit_name TEXT NOT NULL,
    visit_number INTEGER NOT NULL,
    scheduled_date TEXT,
    actual_date TEXT,
    status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'NOT_DONE')),
    not_done_reason TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(subject_id, visit_number)
);

-- =====================================================
-- 6. CRF DATA (CRF 데이터)
-- =====================================================

-- CRF 인스턴스 (폼 단위)
CREATE TABLE IF NOT EXISTS crf_instances (
    id TEXT PRIMARY KEY,
    visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    form_definition_id TEXT REFERENCES form_definitions(id),
    form_name TEXT NOT NULL,
    form_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'COMPLETE', 'SIGNED', 'LOCKED', 'FROZEN')),
    data_entry_by TEXT REFERENCES users(id),
    data_entry_at TEXT,
    signed_by TEXT REFERENCES users(id),
    signed_at TEXT,
    signature_meaning TEXT,
    locked_by TEXT REFERENCES users(id),
    locked_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(visit_id, form_code)
);

-- CRF 필드 데이터
CREATE TABLE IF NOT EXISTS crf_data (
    id TEXT PRIMARY KEY,
    crf_instance_id TEXT NOT NULL REFERENCES crf_instances(id) ON DELETE CASCADE,
    field_definition_id TEXT REFERENCES field_definitions(id),
    field_code TEXT NOT NULL,
    field_value TEXT,
    is_null INTEGER DEFAULT 0,           -- NULL로 표시된 필드
    null_reason TEXT,                    -- NULL 사유
    validation_status TEXT DEFAULT 'VALID' CHECK(validation_status IN ('VALID', 'WARNING', 'ERROR')),
    validation_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(crf_instance_id, field_code)
);

-- =====================================================
-- 7. QUERY MANAGEMENT (데이터 질의)
-- =====================================================

CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    crf_data_id TEXT REFERENCES crf_data(id) ON DELETE CASCADE,
    crf_instance_id TEXT REFERENCES crf_instances(id) ON DELETE CASCADE,
    field_code TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'ANSWERED', 'CLOSED', 'CANCELLED')),
    priority TEXT NOT NULL DEFAULT 'MINOR' CHECK(priority IN ('CRITICAL', 'MAJOR', 'MINOR')),
    category TEXT CHECK(category IN ('DATA_MISSING', 'DATA_INCONSISTENT', 'DATA_CLARIFICATION', 'PROTOCOL_DEVIATION', 'OTHER')),
    query_text TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    due_date TEXT
);

-- Query 응답 (대화형)
CREATE TABLE IF NOT EXISTS query_responses (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    response_text TEXT NOT NULL,
    response_type TEXT NOT NULL CHECK(response_type IN ('ANSWER', 'FOLLOWUP', 'CLOSE', 'CANCEL')),
    responded_by TEXT NOT NULL REFERENCES users(id),
    responded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 8. ELECTRONIC SIGNATURE (전자서명)
-- =====================================================

CREATE TABLE IF NOT EXISTS electronic_signatures (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    record_type TEXT NOT NULL,           -- 서명 대상 유형 (CRF_INSTANCE, QUERY, etc.)
    record_id TEXT NOT NULL,
    signature_meaning TEXT NOT NULL,     -- 서명 의미 (법적 문구)
    signature_reason TEXT,               -- 서명 사유
    ip_address TEXT,
    user_agent TEXT,
    data_hash TEXT NOT NULL,             -- 서명 시점 데이터 해시
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 9. AUDIT TRAIL (감사 추적) - 21 CFR Part 11 핵심
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    -- WHO
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    -- WHEN
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- WHAT
    action TEXT NOT NULL CHECK(action IN ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'SIGN', 'LOCK', 'UNLOCK', 'QUERY_OPEN', 'QUERY_ANSWER', 'QUERY_CLOSE')),
    -- WHERE
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    -- DETAILS
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    -- WHY
    reason_for_change TEXT,
    -- CONTEXT
    ip_address TEXT,
    session_id TEXT,
    user_agent TEXT,
    -- METADATA
    study_id TEXT,
    site_id TEXT,
    subject_id TEXT
);

-- =====================================================
-- 10. DATA LOCK (데이터 잠금)
-- =====================================================

CREATE TABLE IF NOT EXISTS data_locks (
    id TEXT PRIMARY KEY,
    lock_type TEXT NOT NULL CHECK(lock_type IN ('SUBJECT', 'VISIT', 'SITE', 'STUDY')),
    record_id TEXT NOT NULL,
    locked_by TEXT NOT NULL REFERENCES users(id),
    locked_at TEXT DEFAULT CURRENT_TIMESTAMP,
    lock_reason TEXT,
    unlocked_by TEXT REFERENCES users(id),
    unlocked_at TEXT,
    unlock_reason TEXT,
    UNIQUE(lock_type, record_id)
);

-- =====================================================
-- 11. SYSTEM CONFIGURATION
-- =====================================================

CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES (성능 최적화)
-- =====================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Studies
CREATE INDEX IF NOT EXISTS idx_studies_status ON studies(status);
CREATE INDEX IF NOT EXISTS idx_studies_protocol ON studies(protocol_number);

-- Sites
CREATE INDEX IF NOT EXISTS idx_sites_study_id ON sites(study_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);

-- Subjects
CREATE INDEX IF NOT EXISTS idx_subjects_site_id ON subjects(site_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);
CREATE INDEX IF NOT EXISTS idx_subjects_screening_number ON subjects(screening_number);

-- Visits
CREATE INDEX IF NOT EXISTS idx_visits_subject_id ON visits(subject_id);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);

-- CRF
CREATE INDEX IF NOT EXISTS idx_crf_instances_visit_id ON crf_instances(visit_id);
CREATE INDEX IF NOT EXISTS idx_crf_instances_status ON crf_instances(status);
CREATE INDEX IF NOT EXISTS idx_crf_data_instance_id ON crf_data(crf_instance_id);

-- Queries
CREATE INDEX IF NOT EXISTS idx_queries_crf_data_id ON queries(crf_data_id);
CREATE INDEX IF NOT EXISTS idx_queries_status ON queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_priority ON queries(priority);

-- Audit Logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_study_id ON audit_logs(study_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_subject_id ON audit_logs(subject_id);

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- 시스템 설정 기본값
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
    ('session_timeout_minutes', '30', '세션 타임아웃 (분)'),
    ('max_login_attempts', '5', '최대 로그인 실패 횟수'),
    ('lockout_duration_minutes', '30', '계정 잠금 시간 (분)'),
    ('password_min_length', '8', '비밀번호 최소 길이'),
    ('password_history_count', '5', '비밀번호 재사용 방지 개수'),
    ('password_expiry_days', '90', '비밀번호 만료 일수'),
    ('audit_retention_days', '2555', '감사 로그 보존 기간 (7년)');
