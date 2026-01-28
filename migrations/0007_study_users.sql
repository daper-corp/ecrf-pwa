-- Migration: Study Users (Study-User 매핑)
-- 실제 임상시험 환경에 맞게 Study별 사용자 접근 권한 관리

-- study_users 테이블: Study에 할당된 사용자 매핑
-- DM, CRA 등이 특정 Study에만 접근할 수 있도록 제한
CREATE TABLE IF NOT EXISTS study_users (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_in_study TEXT NOT NULL, -- 'SPONSOR_DM', 'SPONSOR_CRA', 'SPONSOR_PM', 'CRO_DM', 'CRO_CRA' 등
  is_primary INTEGER DEFAULT 0, -- 주담당자 여부
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT, -- 할당한 사용자 ID
  notes TEXT, -- 메모
  status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  
  -- 동일 Study에 같은 사용자 중복 할당 방지
  UNIQUE(study_id, user_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_study_users_study_id ON study_users(study_id);
CREATE INDEX IF NOT EXISTS idx_study_users_user_id ON study_users(user_id);
CREATE INDEX IF NOT EXISTS idx_study_users_status ON study_users(status);
CREATE INDEX IF NOT EXISTS idx_study_users_role ON study_users(role_in_study);

-- 기존 데이터 마이그레이션: 현재 존재하는 DM, CRA 사용자들을 모든 Study에 할당 (호환성)
-- 실제 운영에서는 관리자가 개별 할당해야 함
INSERT OR IGNORE INTO study_users (id, study_id, user_id, role_in_study, is_primary, assigned_by, notes)
SELECT 
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  s.id,
  u.id,
  CASE u.role 
    WHEN 'DM' THEN 'SPONSOR_DM'
    WHEN 'CRA' THEN 'SPONSOR_CRA'
    ELSE u.role
  END,
  0,
  (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1),
  '마이그레이션으로 자동 할당됨'
FROM studies s
CROSS JOIN users u
WHERE u.role IN ('DM', 'CRA')
AND u.status = 'ACTIVE';
