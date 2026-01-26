-- eCRF PWA Seed Data
-- 테스트용 초기 데이터
-- Created: 2025-01-26

-- =====================================================
-- 1. TEST USERS (테스트 사용자)
-- =====================================================
-- 비밀번호: Test1234! (PBKDF2-SHA256 hash, 100000 iterations)
-- 실제 운영 시 반드시 변경 필요

INSERT OR IGNORE INTO users (id, email, password_hash, name, role, status, created_at) VALUES
    ('usr_admin_001', 'admin@ecrf.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'System Admin', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP),
    ('usr_pi_001', 'pi@hospital1.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'Dr. Kim (PI)', 'PI', 'ACTIVE', CURRENT_TIMESTAMP),
    ('usr_subinv_001', 'subinv@hospital1.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'Dr. Lee (Sub-Investigator)', 'SUB_INV', 'ACTIVE', CURRENT_TIMESTAMP),
    ('usr_crc_001', 'crc@hospital1.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'Nurse Park (CRC)', 'CRC', 'ACTIVE', CURRENT_TIMESTAMP),
    ('usr_cra_001', 'cra@sponsor.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'Monitor Choi (CRA)', 'CRA', 'ACTIVE', CURRENT_TIMESTAMP),
    ('usr_dm_001', 'dm@sponsor.local', '021fe56545cd3d68e528eecf37e0e207:cc46b203aedc2662560430f6eb568b47568e861bfe26aeb269c5464a62973467', 'Data Manager Jung', 'DM', 'ACTIVE', CURRENT_TIMESTAMP);

-- =====================================================
-- 2. TEST STUDY (테스트 임상시험)
-- =====================================================

INSERT OR IGNORE INTO studies (id, protocol_number, title, short_title, version, phase, status, sponsor, irb_approval_number, irb_approval_date, study_start_date, description, created_by, created_at) VALUES
    ('study_001', 'ECRF-2025-001', 'A Phase III, Randomized, Double-Blind, Placebo-Controlled Study to Evaluate the Efficacy and Safety of Test Drug in Patients with Condition X', 'Test Drug Phase III', '1.0', 'III', 'ACTIVE', 'PharmaCo Inc.', 'IRB-2025-001234', '2025-01-01', '2025-02-01', 'Phase III 임상시험 테스트 프로토콜', 'usr_admin_001', CURRENT_TIMESTAMP);

-- =====================================================
-- 3. VISIT SCHEDULES (방문 스케줄)
-- =====================================================

INSERT OR IGNORE INTO visit_schedules (id, study_id, visit_name, visit_number, visit_window_before, visit_window_after, target_day, is_required, description) VALUES
    ('vs_001', 'study_001', 'Screening', 1, 0, 14, -14, 1, '스크리닝 방문 (Day -14 ~ Day -1)'),
    ('vs_002', 'study_001', 'Baseline (Day 1)', 2, 0, 0, 1, 1, '기준선 방문 및 첫 투약'),
    ('vs_003', 'study_001', 'Week 2', 3, 3, 3, 15, 1, '2주차 방문'),
    ('vs_004', 'study_001', 'Week 4', 4, 3, 3, 29, 1, '4주차 방문'),
    ('vs_005', 'study_001', 'Week 8', 5, 3, 3, 57, 1, '8주차 방문'),
    ('vs_006', 'study_001', 'Week 12 (End of Treatment)', 6, 3, 3, 85, 1, '12주차 방문 (치료 종료)'),
    ('vs_007', 'study_001', 'Follow-up (Week 16)', 7, 7, 7, 113, 1, '추적 방문'),
    ('vs_008', 'study_001', 'Unscheduled Visit', 99, 0, 0, NULL, 0, '예정외 방문');

-- =====================================================
-- 4. FORM DEFINITIONS (폼 정의)
-- =====================================================

-- Screening Visit Forms
INSERT OR IGNORE INTO form_definitions (id, study_id, visit_schedule_id, form_name, form_code, form_order, is_required, description) VALUES
    ('form_001', 'study_001', 'vs_001', 'Informed Consent', 'IC', 1, 1, '동의서 확인'),
    ('form_002', 'study_001', 'vs_001', 'Demographics', 'DM', 2, 1, '인구통계학적 정보'),
    ('form_003', 'study_001', 'vs_001', 'Medical History', 'MH', 3, 1, '병력'),
    ('form_004', 'study_001', 'vs_001', 'Inclusion/Exclusion Criteria', 'IE', 4, 1, '선정/제외 기준');

-- All Visit Forms
INSERT OR IGNORE INTO form_definitions (id, study_id, visit_schedule_id, form_name, form_code, form_order, is_required, description) VALUES
    ('form_005', 'study_001', NULL, 'Vital Signs', 'VS', 1, 1, '활력징후'),
    ('form_006', 'study_001', NULL, 'Physical Examination', 'PE', 2, 0, '신체검진'),
    ('form_007', 'study_001', NULL, 'Laboratory Tests', 'LB', 3, 0, '검사실 검사'),
    ('form_008', 'study_001', NULL, 'Adverse Events', 'AE', 4, 0, '이상반응'),
    ('form_009', 'study_001', NULL, 'Concomitant Medications', 'CM', 5, 0, '병용약물'),
    ('form_010', 'study_001', NULL, 'Study Drug Administration', 'DA', 6, 0, '시험약 투여');

-- =====================================================
-- 5. FIELD DEFINITIONS (필드 정의)
-- =====================================================

-- Demographics Form Fields
INSERT OR IGNORE INTO field_definitions (id, form_definition_id, field_name, field_code, field_type, field_order, is_required, options, min_value, max_value, validation_rules) VALUES
    ('fld_dm_001', 'form_002', 'Birth Date', 'BRTHDTC', 'DATE', 1, 1, NULL, NULL, NULL, '{"type":"date","maxDate":"today-18y"}'),
    ('fld_dm_002', 'form_002', 'Sex', 'SEX', 'SELECT', 2, 1, '[{"value":"M","label":"Male"},{"value":"F","label":"Female"}]', NULL, NULL, NULL),
    ('fld_dm_003', 'form_002', 'Race', 'RACE', 'SELECT', 3, 1, '[{"value":"ASIAN","label":"Asian"},{"value":"WHITE","label":"White"},{"value":"BLACK","label":"Black or African American"},{"value":"OTHER","label":"Other"}]', NULL, NULL, NULL),
    ('fld_dm_004', 'form_002', 'Ethnicity', 'ETHNIC', 'SELECT', 4, 0, '[{"value":"HISPANIC","label":"Hispanic or Latino"},{"value":"NOT_HISPANIC","label":"Not Hispanic or Latino"},{"value":"UNKNOWN","label":"Unknown"}]', NULL, NULL, NULL),
    ('fld_dm_005', 'form_002', 'Height (cm)', 'HEIGHT', 'NUMBER', 5, 1, NULL, '100', '250', '{"type":"range","min":100,"max":250,"unit":"cm"}'),
    ('fld_dm_006', 'form_002', 'Weight (kg)', 'WEIGHT', 'NUMBER', 6, 1, NULL, '30', '300', '{"type":"range","min":30,"max":300,"unit":"kg"}'),
    ('fld_dm_007', 'form_002', 'BMI', 'BMI', 'CALCULATED', 7, 0, NULL, NULL, NULL, '{"formula":"WEIGHT/((HEIGHT/100)^2)","decimals":1}');

-- Vital Signs Form Fields
INSERT OR IGNORE INTO field_definitions (id, form_definition_id, field_name, field_code, field_type, field_order, is_required, min_value, max_value, validation_rules) VALUES
    ('fld_vs_001', 'form_005', 'Assessment Date', 'VSDTC', 'DATE', 1, 1, NULL, NULL, '{"type":"date","maxDate":"today"}'),
    ('fld_vs_002', 'form_005', 'Assessment Time', 'VSTM', 'TEXT', 2, 0, NULL, NULL, '{"type":"time"}'),
    ('fld_vs_003', 'form_005', 'Systolic Blood Pressure (mmHg)', 'SYSBP', 'NUMBER', 3, 1, '80', '200', '{"type":"range","min":80,"max":200,"unit":"mmHg","warnMin":90,"warnMax":180}'),
    ('fld_vs_004', 'form_005', 'Diastolic Blood Pressure (mmHg)', 'DIABP', 'NUMBER', 4, 1, '40', '120', '{"type":"range","min":40,"max":120,"unit":"mmHg","warnMin":60,"warnMax":100}'),
    ('fld_vs_005', 'form_005', 'Heart Rate (bpm)', 'HR', 'NUMBER', 5, 1, '40', '200', '{"type":"range","min":40,"max":200,"unit":"bpm","warnMin":60,"warnMax":100}'),
    ('fld_vs_006', 'form_005', 'Body Temperature (°C)', 'TEMP', 'NUMBER', 6, 1, '35.0', '42.0', '{"type":"range","min":35.0,"max":42.0,"unit":"°C","decimals":1,"warnMin":36.0,"warnMax":37.5}'),
    ('fld_vs_007', 'form_005', 'Respiratory Rate (breaths/min)', 'RESP', 'NUMBER', 7, 0, '8', '40', '{"type":"range","min":8,"max":40,"unit":"breaths/min","warnMin":12,"warnMax":20}');

-- Adverse Event Form Fields
INSERT OR IGNORE INTO field_definitions (id, form_definition_id, field_name, field_code, field_type, field_order, is_required, options, validation_rules) VALUES
    ('fld_ae_001', 'form_008', 'Adverse Event Term', 'AETERM', 'TEXT', 1, 1, NULL, '{"type":"text","minLength":3,"maxLength":200}'),
    ('fld_ae_002', 'form_008', 'Start Date', 'AESTDTC', 'DATE', 2, 1, NULL, '{"type":"date","maxDate":"today"}'),
    ('fld_ae_003', 'form_008', 'End Date', 'AEENDTC', 'DATE', 3, 0, NULL, '{"type":"date","maxDate":"today","minField":"AESTDTC"}'),
    ('fld_ae_004', 'form_008', 'Ongoing', 'AEONGO', 'RADIO', 4, 1, '[{"value":"Y","label":"Yes"},{"value":"N","label":"No"}]', NULL),
    ('fld_ae_005', 'form_008', 'Severity', 'AESEV', 'SELECT', 5, 1, '[{"value":"MILD","label":"Mild"},{"value":"MODERATE","label":"Moderate"},{"value":"SEVERE","label":"Severe"}]', NULL),
    ('fld_ae_006', 'form_008', 'Serious', 'AESER', 'RADIO', 6, 1, '[{"value":"Y","label":"Yes"},{"value":"N","label":"No"}]', NULL),
    ('fld_ae_007', 'form_008', 'Relationship to Study Drug', 'AEREL', 'SELECT', 7, 1, '[{"value":"NOT_RELATED","label":"Not Related"},{"value":"UNLIKELY","label":"Unlikely"},{"value":"POSSIBLE","label":"Possible"},{"value":"PROBABLE","label":"Probable"},{"value":"DEFINITE","label":"Definite"}]', NULL),
    ('fld_ae_008', 'form_008', 'Action Taken with Study Drug', 'AEACN', 'SELECT', 8, 1, '[{"value":"NONE","label":"None"},{"value":"DOSE_REDUCED","label":"Dose Reduced"},{"value":"INTERRUPTED","label":"Drug Interrupted"},{"value":"WITHDRAWN","label":"Drug Withdrawn"}]', NULL),
    ('fld_ae_009', 'form_008', 'Outcome', 'AEOUT', 'SELECT', 9, 1, '[{"value":"RECOVERED","label":"Recovered/Resolved"},{"value":"RECOVERING","label":"Recovering/Resolving"},{"value":"NOT_RECOVERED","label":"Not Recovered/Not Resolved"},{"value":"SEQUELAE","label":"Recovered with Sequelae"},{"value":"FATAL","label":"Fatal"},{"value":"UNKNOWN","label":"Unknown"}]', NULL);

-- =====================================================
-- 6. TEST SITES (테스트 기관)
-- =====================================================

INSERT OR IGNORE INTO sites (id, study_id, site_number, name, address, city, country, pi_name, pi_email, status, activation_date) VALUES
    ('site_001', 'study_001', '01', 'Seoul University Hospital', '101 Daehak-ro, Jongno-gu', 'Seoul', 'KR', 'Dr. Kim', 'pi@hospital1.local', 'ACTIVE', '2025-02-01'),
    ('site_002', 'study_001', '02', 'Busan Medical Center', '123 Gudeok-ro, Seo-gu', 'Busan', 'KR', 'Dr. Park', 'pi@hospital2.local', 'ACTIVE', '2025-02-01'),
    ('site_003', 'study_001', '03', 'Daegu General Hospital', '456 Dalseong-ro, Jung-gu', 'Daegu', 'KR', 'Dr. Choi', 'pi@hospital3.local', 'PENDING', NULL);

-- Site-User Assignments
INSERT OR IGNORE INTO site_users (id, site_id, user_id, is_primary) VALUES
    ('su_001', 'site_001', 'usr_pi_001', 1),
    ('su_002', 'site_001', 'usr_subinv_001', 0),
    ('su_003', 'site_001', 'usr_crc_001', 0);

-- =====================================================
-- 7. TEST SUBJECTS (테스트 피험자)
-- =====================================================

INSERT OR IGNORE INTO subjects (id, site_id, subject_number, screening_number, status, screening_date, created_by) VALUES
    ('subj_001', 'site_001', '01-001', 'SCR-001', 'ENROLLED', '2025-02-05', 'usr_crc_001'),
    ('subj_002', 'site_001', '01-002', 'SCR-002', 'SCREENING', '2025-02-10', 'usr_crc_001'),
    ('subj_003', 'site_001', '01-003', 'SCR-003', 'SCREEN_FAILED', '2025-02-08', 'usr_crc_001');

-- =====================================================
-- 8. TEST VISITS (테스트 방문)
-- =====================================================

INSERT OR IGNORE INTO visits (id, subject_id, visit_schedule_id, visit_name, visit_number, scheduled_date, actual_date, status) VALUES
    ('visit_001', 'subj_001', 'vs_001', 'Screening', 1, '2025-02-05', '2025-02-05', 'COMPLETED'),
    ('visit_002', 'subj_001', 'vs_002', 'Baseline (Day 1)', 2, '2025-02-19', '2025-02-19', 'COMPLETED'),
    ('visit_003', 'subj_001', 'vs_003', 'Week 2', 3, '2025-03-05', NULL, 'SCHEDULED'),
    ('visit_004', 'subj_002', 'vs_001', 'Screening', 1, '2025-02-10', '2025-02-10', 'IN_PROGRESS');

-- =====================================================
-- 9. SAMPLE CRF DATA (샘플 CRF 데이터)
-- =====================================================

-- CRF Instances
INSERT OR IGNORE INTO crf_instances (id, visit_id, form_definition_id, form_name, form_code, status, data_entry_by, data_entry_at) VALUES
    ('crf_001', 'visit_001', 'form_002', 'Demographics', 'DM', 'COMPLETE', 'usr_crc_001', '2025-02-05 10:30:00'),
    ('crf_002', 'visit_001', 'form_005', 'Vital Signs', 'VS', 'COMPLETE', 'usr_crc_001', '2025-02-05 10:45:00'),
    ('crf_003', 'visit_002', 'form_005', 'Vital Signs', 'VS', 'DRAFT', 'usr_crc_001', '2025-02-19 09:00:00');

-- CRF Data - Demographics
INSERT OR IGNORE INTO crf_data (id, crf_instance_id, field_code, field_value, validation_status) VALUES
    ('data_001', 'crf_001', 'BRTHDTC', '1985-03-15', 'VALID'),
    ('data_002', 'crf_001', 'SEX', 'M', 'VALID'),
    ('data_003', 'crf_001', 'RACE', 'ASIAN', 'VALID'),
    ('data_004', 'crf_001', 'HEIGHT', '175', 'VALID'),
    ('data_005', 'crf_001', 'WEIGHT', '72', 'VALID'),
    ('data_006', 'crf_001', 'BMI', '23.5', 'VALID');

-- CRF Data - Vital Signs (Screening)
INSERT OR IGNORE INTO crf_data (id, crf_instance_id, field_code, field_value, validation_status) VALUES
    ('data_007', 'crf_002', 'VSDTC', '2025-02-05', 'VALID'),
    ('data_008', 'crf_002', 'SYSBP', '125', 'VALID'),
    ('data_009', 'crf_002', 'DIABP', '82', 'VALID'),
    ('data_010', 'crf_002', 'HR', '72', 'VALID'),
    ('data_011', 'crf_002', 'TEMP', '36.5', 'VALID'),
    ('data_012', 'crf_002', 'RESP', '16', 'VALID');

-- =====================================================
-- 10. SAMPLE AUDIT LOG (샘플 감사 로그)
-- =====================================================

INSERT OR IGNORE INTO audit_logs (id, user_id, user_name, user_role, timestamp, action, table_name, record_id, field_name, old_value, new_value, reason_for_change, ip_address, study_id, site_id, subject_id) VALUES
    ('audit_001', 'usr_crc_001', 'Nurse Park (CRC)', 'CRC', '2025-02-05 10:30:00', 'CREATE', 'subjects', 'subj_001', NULL, NULL, NULL, 'New subject enrollment', '192.168.1.100', 'study_001', 'site_001', 'subj_001'),
    ('audit_002', 'usr_crc_001', 'Nurse Park (CRC)', 'CRC', '2025-02-05 10:35:00', 'CREATE', 'crf_instances', 'crf_001', NULL, NULL, NULL, 'Initial data entry', '192.168.1.100', 'study_001', 'site_001', 'subj_001'),
    ('audit_003', 'usr_crc_001', 'Nurse Park (CRC)', 'CRC', '2025-02-05 10:45:00', 'UPDATE', 'crf_instances', 'crf_001', 'status', 'DRAFT', 'COMPLETE', 'Data entry completed', '192.168.1.100', 'study_001', 'site_001', 'subj_001');
