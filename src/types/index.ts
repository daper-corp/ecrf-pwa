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
// AUDIT TRAIL TYPES
// =====================================================

export type AuditAction = 
  | 'CREATE' 
  | 'READ' 
  | 'UPDATE' 
  | 'DELETE' 
  | 'LOGIN' 
  | 'LOGOUT' 
  | 'SIGN' 
  | 'LOCK' 
  | 'UNLOCK' 
  | 'QUERY_OPEN' 
  | 'QUERY_ANSWER' 
  | 'QUERY_CLOSE';

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  timestamp: string;
  action: AuditAction;
  table_name: string;
  record_id: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason_for_change: string | null;
  ip_address: string | null;
  session_id: string | null;
  user_agent: string | null;
  study_id: string | null;
  site_id: string | null;
  subject_id: string | null;
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
