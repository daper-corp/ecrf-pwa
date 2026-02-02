// eCRF PWA Type Definitions
// 21 CFR Part 11 준수를 위한 타입 정의

// =====================================================
// USER & AUTHENTICATION TYPES
// =====================================================

export type UserRole = 'ADMIN' | 'PI' | 'SUB_INV' | 'CRC' | 'CRA' | 'DM';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
}

export interface AuthPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
  iat: number;
  exp: number;
}

// =====================================================
// STUDY TYPES
// =====================================================

export type StudyStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'LOCKED' | 'CANCELLED';
export type StudyPhase = 'I' | 'II' | 'III' | 'IV' | 'NA';

export interface Study {
  id: string;
  protocol_number: string;
  title: string;
  short_title: string | null;
  version: string;
  phase: StudyPhase | null;
  status: StudyStatus;
  sponsor: string | null;
  irb_approval_number: string | null;
  irb_approval_date: string | null;
  irb_expiry_date: string | null;
  study_start_date: string | null;
  study_end_date: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitSchedule {
  id: string;
  study_id: string;
  visit_name: string;
  visit_number: number;
  visit_window_before: number;
  visit_window_after: number;
  target_day: number | null;
  is_required: boolean;
  description: string | null;
  created_at: string;
}

// =====================================================
// SITE TYPES
// =====================================================

export type SiteStatus = 'PENDING' | 'ACTIVE' | 'CLOSED' | 'SUSPENDED';

export interface Site {
  id: string;
  study_id: string;
  site_number: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string;
  pi_name: string | null;
  pi_email: string | null;
  phone: string | null;
  status: SiteStatus;
  activation_date: string | null;
  closure_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteUser {
  id: string;
  site_id: string;
  user_id: string;
  is_primary: boolean;
  assigned_at: string;
}

// =====================================================
// SUBJECT TYPES
// =====================================================

export type SubjectStatus = 
  | 'SCREENING' 
  | 'SCREEN_FAILED' 
  | 'ENROLLED' 
  | 'RANDOMIZED' 
  | 'COMPLETED' 
  | 'WITHDRAWN' 
  | 'LOST_TO_FOLLOWUP';

export type WithdrawalInitiator = 'SUBJECT' | 'INVESTIGATOR' | 'SPONSOR';

export interface Subject {
  id: string;
  site_id: string;
  subject_number: string;
  screening_number: string | null;
  randomization_number: string | null;
  initials: string | null;
  status: SubjectStatus;
  screening_date: string | null;
  enrolled_date: string | null;
  randomized_date: string | null;
  completed_date: string | null;
  withdrawn_date: string | null;
  withdrawal_reason: string | null;
  withdrawal_initiated_by: WithdrawalInitiator | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// VISIT TYPES
// =====================================================

export type VisitStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'NOT_DONE';

export interface Visit {
  id: string;
  subject_id: string;
  visit_schedule_id: string | null;
  visit_name: string;
  visit_number: number;
  scheduled_date: string | null;
  actual_date: string | null;
  status: VisitStatus;
  not_done_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// CRF TYPES
// =====================================================

export type FieldType = 
  | 'TEXT' 
  | 'NUMBER' 
  | 'DATE' 
  | 'DATETIME' 
  | 'SELECT' 
  | 'MULTI_SELECT' 
  | 'RADIO' 
  | 'CHECKBOX' 
  | 'TEXTAREA' 
  | 'CALCULATED';

export type CRFStatus = 'DRAFT' | 'COMPLETE' | 'SIGNED' | 'LOCKED' | 'FROZEN';
export type ValidationStatus = 'VALID' | 'WARNING' | 'ERROR';

export interface FormDefinition {
  id: string;
  study_id: string;
  visit_schedule_id: string | null;
  form_name: string;
  form_code: string;
  form_order: number;
  is_required: boolean;
  description: string | null;
  created_at: string;
}

export interface FieldDefinition {
  id: string;
  form_definition_id: string;
  field_name: string;
  field_code: string;
  field_type: FieldType;
  field_order: number;
  is_required: boolean;
  is_key: boolean;
  default_value: string | null;
  placeholder: string | null;
  help_text: string | null;
  min_value: string | null;
  max_value: string | null;
  options: string | null;  // JSON string
  calculation_formula: string | null;
  skip_logic: string | null;  // JSON string
  validation_rules: string | null;  // JSON string
  created_at: string;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface ValidationRule {
  type: string;
  min?: number;
  max?: number;
  warnMin?: number;
  warnMax?: number;
  unit?: string;
  decimals?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  formula?: string;
  maxDate?: string;
  minDate?: string;
  minField?: string;
  maxField?: string;
}

export interface CRFInstance {
  id: string;
  visit_id: string;
  form_definition_id: string | null;
  form_name: string;
  form_code: string;
  status: CRFStatus;
  data_entry_by: string | null;
  data_entry_at: string | null;
  signed_by: string | null;
  signed_at: string | null;
  signature_meaning: string | null;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CRFData {
  id: string;
  crf_instance_id: string;
  field_definition_id: string | null;
  field_code: string;
  field_value: string | null;
  is_null: boolean;
  null_reason: string | null;
  validation_status: ValidationStatus;
  validation_message: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// QUERY TYPES
// =====================================================

export type QueryStatus = 'OPEN' | 'ANSWERED' | 'CLOSED' | 'CANCELLED';
export type QueryPriority = 'CRITICAL' | 'MAJOR' | 'MINOR';
export type QueryCategory = 
  | 'DATA_MISSING' 
  | 'DATA_INCONSISTENT' 
  | 'DATA_CLARIFICATION' 
  | 'PROTOCOL_DEVIATION' 
  | 'OTHER';
export type QueryResponseType = 'ANSWER' | 'FOLLOWUP' | 'CLOSE' | 'CANCEL';

export interface Query {
  id: string;
  crf_data_id: string | null;
  crf_instance_id: string | null;
  field_code: string | null;
  status: QueryStatus;
  priority: QueryPriority;
  category: QueryCategory | null;
  query_text: string;
  created_by: string;
  created_at: string;
  due_date: string | null;
}

export interface QueryResponse {
  id: string;
  query_id: string;
  response_text: string;
  response_type: QueryResponseType;
  responded_by: string;
  responded_at: string;
}

// =====================================================
// ELECTRONIC SIGNATURE TYPES
// =====================================================

export interface ElectronicSignature {
  id: string;
  user_id: string;
  record_type: string;
  record_id: string;
  signature_meaning: string;
  signature_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  data_hash: string;
  created_at: string;
}

// =====================================================
// AUDIT TRAIL TYPES (21 CFR Part 11 Compliant)
// =====================================================

/**
 * 21 CFR Part 11 준수 감사 액션 유형
 * - 모든 데이터 변경 사항 추적
 * - 전자 서명 및 인증 이벤트 기록
 * - 시스템 관리 활동 로깅
 */
export type AuditAction = 
  // 데이터 CRUD 작업
  | 'CREATE'              // 레코드 생성
  | 'READ'                // 레코드 조회 (민감한 데이터)
  | 'UPDATE'              // 레코드 수정
  | 'DELETE'              // 레코드 삭제 (소프트 삭제)
  // 인증 관련
  | 'LOGIN'               // 로그인 성공
  | 'LOGIN_FAILED'        // 로그인 실패
  | 'LOGOUT'              // 로그아웃
  | 'PASSWORD_CHANGE'     // 비밀번호 변경
  | 'PASSWORD_RESET'      // 비밀번호 재설정
  | '2FA_ENABLED'         // 2단계 인증 활성화
  | '2FA_DISABLED'        // 2단계 인증 비활성화
  | '2FA_VERIFIED'        // 2단계 인증 검증 성공
  | '2FA_FAILED'          // 2단계 인증 검증 실패
  | 'SESSION_TIMEOUT'     // 세션 타임아웃
  // 전자 서명 (21 CFR Part 11 핵심)
  | 'SIGN'                // 전자 서명
  | 'SIGN_REJECTED'       // 서명 거부
  | 'COUNTERSIGN'         // 추가 서명 (PI 서명 등)
  // 데이터 잠금/해제
  | 'LOCK'                // 데이터 잠금
  | 'UNLOCK'              // 데이터 잠금 해제
  | 'FREEZE'              // 데이터 동결
  | 'UNFREEZE'            // 데이터 동결 해제
  // Query 관리
  | 'QUERY_OPEN'          // Query 생성
  | 'QUERY_ANSWER'        // Query 응답
  | 'QUERY_CLOSE'         // Query 종료
  | 'QUERY_REOPEN'        // Query 재개
  | 'QUERY_CANCEL'        // Query 취소
  // CRF 워크플로우
  | 'CRF_SAVE'            // CRF 저장 (자동/수동)
  | 'CRF_SUBMIT'          // CRF 제출
  | 'CRF_VERIFY'          // CRF 검증 (SDV)
  | 'CRF_REVIEW'          // CRF 리뷰
  | 'CRF_APPROVE'         // CRF 승인
  | 'CRF_REJECT'          // CRF 반려
  // 데이터 내보내기
  | 'EXPORT'              // 데이터 내보내기
  | 'PRINT'               // 인쇄
  | 'DOWNLOAD'            // 파일 다운로드
  // 시스템 관리
  | 'USER_CREATE'         // 사용자 생성
  | 'USER_UPDATE'         // 사용자 정보 수정
  | 'USER_DEACTIVATE'     // 사용자 비활성화
  | 'USER_ACTIVATE'       // 사용자 활성화
  | 'ROLE_CHANGE'         // 역할 변경
  | 'PERMISSION_GRANT'    // 권한 부여
  | 'PERMISSION_REVOKE'   // 권한 회수
  // 연구 관리
  | 'STUDY_CREATE'        // 연구 생성
  | 'STUDY_UPDATE'        // 연구 수정
  | 'STUDY_LOCK'          // 연구 잠금
  | 'STUDY_CLOSE'         // 연구 종료
  | 'SITE_ACTIVATE'       // 기관 활성화
  | 'SITE_DEACTIVATE'     // 기관 비활성화
  // 피험자 관리
  | 'SUBJECT_ENROLL'      // 피험자 등록
  | 'SUBJECT_RANDOMIZE'   // 피험자 무작위 배정
  | 'SUBJECT_WITHDRAW'    // 피험자 철회
  | 'SUBJECT_COMPLETE'    // 피험자 완료
  // 시스템 이벤트
  | 'SYSTEM_CONFIG'       // 시스템 설정 변경
  | 'BACKUP'              // 데이터 백업
  | 'RESTORE'             // 데이터 복원
  | 'SYNC'                // 데이터 동기화 (오프라인)
  | 'CONFLICT_RESOLVE';   // 동기화 충돌 해결

/**
 * 감사 이벤트 심각도 수준
 */
export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * 감사 이벤트 카테고리
 */
export type AuditCategory = 
  | 'AUTHENTICATION'      // 인증
  | 'AUTHORIZATION'       // 권한
  | 'DATA_ENTRY'          // 데이터 입력
  | 'DATA_MODIFICATION'   // 데이터 수정
  | 'DATA_ACCESS'         // 데이터 조회
  | 'SIGNATURE'           // 전자 서명
  | 'WORKFLOW'            // 워크플로우
  | 'QUERY'               // Query 관리
  | 'EXPORT'              // 내보내기
  | 'ADMINISTRATION'      // 관리
  | 'SYSTEM';             // 시스템

/**
 * 21 CFR Part 11 준수 감사 로그 인터페이스
 */
export interface AuditLog {
  // 기본 식별자
  id: string;                           // 고유 감사 로그 ID
  sequence_number?: number;             // 순차 번호 (불변)
  
  // 사용자 정보 (WHO)
  user_id: string;                      // 사용자 ID
  user_name: string;                    // 사용자 이름 (스냅샷)
  user_email?: string;                  // 사용자 이메일 (스냅샷)
  user_role: string;                    // 사용자 역할 (스냅샷)
  
  // 시간 정보 (WHEN)
  timestamp: string;                    // ISO 8601 타임스탬프 (UTC)
  timezone?: string;                    // 사용자 타임존
  
  // 액션 정보 (WHAT)
  action: AuditAction;                  // 수행된 액션
  category?: AuditCategory;             // 액션 카테고리
  severity?: AuditSeverity;             // 심각도
  
  // 대상 정보 (WHERE)
  table_name: string;                   // 테이블/엔티티 이름
  record_id: string;                    // 레코드 ID
  field_name: string | null;            // 필드 이름 (필드 수준 변경 시)
  
  // 변경 내용 (CHANGE DETAILS)
  old_value: string | null;             // 이전 값
  new_value: string | null;             // 새 값
  change_summary?: string;              // 변경 요약 (다중 필드 변경 시)
  
  // 사유 및 맥락 (WHY - 21 CFR Part 11 필수)
  reason_for_change: string | null;     // 변경 사유 (규정 필수)
  comment?: string;                     // 추가 설명
  
  // 클라이언트 정보 (CONTEXT)
  ip_address: string | null;            // IP 주소
  session_id: string | null;            // 세션 ID
  user_agent: string | null;            // 브라우저/클라이언트 정보
  device_type?: string;                 // 장치 유형 (desktop/mobile/tablet)
  browser?: string;                     // 브라우저 정보
  os?: string;                          // 운영 체제
  
  // 연구 컨텍스트 (CLINICAL TRIAL CONTEXT)
  study_id: string | null;              // 연구 ID
  study_name?: string;                  // 연구 이름 (스냅샷)
  protocol_number?: string;             // 프로토콜 번호
  site_id: string | null;               // 기관 ID
  site_name?: string;                   // 기관 이름 (스냅샷)
  subject_id: string | null;            // 피험자 ID
  subject_number?: string;              // 피험자 번호
  visit_id?: string;                    // 방문 ID
  visit_name?: string;                  // 방문 이름
  form_id?: string;                     // CRF 폼 ID
  form_name?: string;                   // CRF 폼 이름
  
  // 서명 정보 (ELECTRONIC SIGNATURE)
  signature_id?: string;                // 관련 전자 서명 ID
  signature_meaning?: string;           // 서명 의미 (예: "승인", "검토 완료")
  
  // 무결성 검증 (INTEGRITY)
  checksum?: string;                    // 데이터 무결성 체크섬
  previous_log_id?: string;             // 이전 로그 ID (체이닝)
  
  // 메타데이터
  created_at?: string;                  // 로그 생성 시간
  is_system_generated?: boolean;        // 시스템 자동 생성 여부
}

// =====================================================
// DATA LOCK TYPES
// =====================================================

export type LockType = 'SUBJECT' | 'VISIT' | 'SITE' | 'STUDY';

export interface DataLock {
  id: string;
  lock_type: LockType;
  record_id: string;
  locked_by: string;
  locked_at: string;
  lock_reason: string | null;
  unlocked_by: string | null;
  unlocked_at: string | null;
  unlock_reason: string | null;
}

// =====================================================
// API RESPONSE TYPES
// =====================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// =====================================================
// ENVIRONMENT BINDINGS
// =====================================================

export interface Bindings {
  DB: D1Database;
  KV?: KVNamespace;
  R2?: R2Bucket;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

export type Variables = {
  user: AuthPayload | null;
  sessionId: string | null;
  requestId: string | null;
};

// =====================================================
// EDIT CHECK TYPES
// =====================================================

export type EditCheckRuleType = 
  | 'RANGE'           // 범위 검사
  | 'REQUIRED'        // 필수 값 검사
  | 'CROSS_FIELD'     // 동일 폼 내 필드 간 검사
  | 'CROSS_FORM'      // 폼 간 검사 (같은 Visit)
  | 'CROSS_VISIT'     // Visit 간 검사
  | 'TEMPORAL'        // 날짜/시간 순서 검사
  | 'CONDITIONAL'     // 조건부 검사
  | 'CONSISTENCY'     // 일관성 검사
  | 'MEDICAL_LOGIC'   // 의학적 논리 검사
  | 'CUSTOM';         // 사용자 정의 검사

export type EditCheckSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type EditCheckResolutionStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED' | 'WAIVED' | 'QUERY_OPENED';
export type EditCheckBatchStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type EditCheckWaiverType = 'PERMANENT' | 'TEMPORARY' | 'ONE_TIME';
export type EditCheckApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface EditCheckRule {
  id: string;
  study_id: string;
  rule_code: string;
  rule_name: string;
  description: string | null;
  rule_type: EditCheckRuleType;
  severity: EditCheckSeverity;
  is_active: boolean;
  target_form_code: string | null;
  target_field_code: string | null;
  rule_definition: string;  // JSON
  error_message_template: string;
  error_message_ko: string | null;
  auto_query_enabled: boolean;
  auto_query_priority: QueryPriority;
  auto_query_category: QueryCategory;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditCheckResult {
  id: string;
  rule_id: string;
  crf_instance_id: string;
  crf_data_id: string | null;
  passed: boolean;
  severity: EditCheckSeverity;
  error_message: string | null;
  field_code: string | null;
  field_value: string | null;
  context_data: string | null;  // JSON
  resolution_status: EditCheckResolutionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  query_id: string | null;
  executed_at: string;
  execution_context: string | null;
}

export interface EditCheckBatch {
  id: string;
  study_id: string;
  scope_type: 'STUDY' | 'SITE' | 'SUBJECT' | 'VISIT' | 'CRF';
  scope_id: string;
  total_rules_executed: number;
  total_checks_performed: number;
  passed_count: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  executed_by: string;
  started_at: string;
  completed_at: string | null;
  status: EditCheckBatchStatus;
  error_message: string | null;
}

export interface EditCheckWaiver {
  id: string;
  rule_id: string;
  subject_id: string | null;
  visit_id: string | null;
  crf_instance_id: string | null;
  waiver_reason: string;
  waiver_type: EditCheckWaiverType;
  expiry_date: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_status: EditCheckApprovalStatus;
  rejection_reason: string | null;
}
