// Role-Based Access Control Middleware
// 역할 기반 접근 제어 미들웨어
// 실제 임상시험 환경에 맞게 Study/Site별 접근 권한 관리

import { Context, Next } from 'hono';
import type { Bindings, Variables, UserRole } from '../types';
import { getAuthUser } from './auth';

/**
 * 권한 정의
 */
export const PERMISSIONS = {
  // 데이터 조회
  READ_DATA: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
  
  // 데이터 입력/수정 (ADMIN 추가)
  WRITE_DATA: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'DM'],
  
  // 최종 서명
  SIGN_CRF: ['ADMIN', 'PI'],
  
  // Query 발행
  CREATE_QUERY: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
  
  // Query 답변
  ANSWER_QUERY: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'DM'],
  
  // Query 종료
  CLOSE_QUERY: ['ADMIN', 'CRA', 'DM'],
  
  // Data Export
  EXPORT_DATA: ['ADMIN', 'PI', 'DM'],
  
  // Data Lock/Unlock
  LOCK_DATA: ['ADMIN', 'DM'],
  UNLOCK_DATA: ['ADMIN', 'DM'],
  
  // Study 관리
  MANAGE_STUDY: ['ADMIN', 'DM'],
  
  // Site 관리
  MANAGE_SITE: ['ADMIN', 'DM'],
  
  // 사용자 관리 (시스템 사용자 생성/삭제)
  MANAGE_USERS: ['ADMIN'],
  
  // Study 사용자 할당 (Study에 DM/CRA 할당)
  ASSIGN_STUDY_USERS: ['ADMIN', 'DM'],
  
  // Site 사용자 할당 (Site에 PI/CRC 할당)
  ASSIGN_SITE_USERS: ['ADMIN', 'DM'],
  
  // 감사 로그 조회
  VIEW_AUDIT: ['ADMIN', 'PI', 'DM'],
  
  // Edit Check 관리
  MANAGE_EDIT_CHECKS: ['ADMIN', 'DM'],
  
  // Edit Check 실행
  EXECUTE_EDIT_CHECKS: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
  
  // Edit Check 결과 조회
  VIEW_EDIT_CHECKS: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Study 내 역할 정의
 */
export const STUDY_ROLES = {
  SPONSOR_PM: '스폰서 PM',
  SPONSOR_DM: '스폰서 DM',
  SPONSOR_CRA: '스폰서 CRA',
  CRO_PM: 'CRO PM',
  CRO_DM: 'CRO DM',
  CRO_CRA: 'CRO CRA',
} as const;

export type StudyRole = keyof typeof STUDY_ROLES;

/**
 * 권한 확인
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(role);
}

/**
 * 특정 권한 필요 미들웨어 생성
 */
export function requirePermission(...permissions: Permission[]) {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const user = getAuthUser(c);

    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    // 모든 필요 권한을 가지고 있는지 확인
    for (const permission of permissions) {
      if (!hasPermission(user.role, permission)) {
        return c.json({ 
          success: false, 
          error: `권한이 없습니다. 필요 권한: ${permission}` 
        }, 403);
      }
    }

    return next();
  };
}

/**
 * 특정 역할 필요 미들웨어 생성
 */
export function requireRole(...roles: UserRole[]) {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const user = getAuthUser(c);

    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!roles.includes(user.role)) {
      return c.json({ 
        success: false, 
        error: `권한이 없습니다. 필요 역할: ${roles.join(', ')}` 
      }, 403);
    }

    return next();
  };
}

/**
 * Study 접근 권한 확인
 * - ADMIN: 모든 Study 접근 가능
 * - DM/CRA: study_users 테이블에 할당된 Study만 접근 가능
 * - PI/SUB_INV/CRC: site_users 테이블을 통해 할당된 Site의 Study만 접근 가능
 */
export async function checkStudyAccess(
  db: D1Database,
  userId: string,
  role: UserRole,
  studyId: string
): Promise<boolean> {
  // ADMIN은 모든 Study 접근 가능
  if (role === 'ADMIN') {
    return true;
  }

  // DM, CRA는 study_users 테이블에서 할당 여부 확인
  if (role === 'DM' || role === 'CRA') {
    const studyUser = await db.prepare(`
      SELECT id FROM study_users 
      WHERE study_id = ? AND user_id = ? AND status = 'ACTIVE'
    `).bind(studyId, userId).first();
    
    return !!studyUser;
  }

  // PI, SUB_INV, CRC는 site_users 테이블에서 해당 Study의 Site에 할당되어 있는지 확인
  const siteUser = await db.prepare(`
    SELECT su.id FROM site_users su
    JOIN sites s ON su.site_id = s.id
    WHERE s.study_id = ? AND su.user_id = ?
    LIMIT 1
  `).bind(studyId, userId).first();

  return !!siteUser;
}

/**
 * Site 접근 권한 확인
 * - ADMIN: 모든 Site 접근 가능
 * - DM/CRA: 해당 Site의 Study에 할당되어 있어야 함
 * - PI/SUB_INV/CRC: site_users에 직접 할당되어 있어야 함
 */
export async function checkSiteAccess(
  db: D1Database,
  userId: string,
  role: UserRole,
  siteId: string
): Promise<boolean> {
  // ADMIN은 모든 Site 접근 가능
  if (role === 'ADMIN') {
    return true;
  }

  // DM, CRA는 해당 Site의 Study에 할당되어 있어야 함
  if (role === 'DM' || role === 'CRA') {
    const studyUser = await db.prepare(`
      SELECT stu.id FROM study_users stu
      JOIN sites s ON stu.study_id = s.study_id
      WHERE s.id = ? AND stu.user_id = ? AND stu.status = 'ACTIVE'
    `).bind(siteId, userId).first();
    
    return !!studyUser;
  }

  // PI, SUB_INV, CRC는 site_users에 직접 할당되어 있어야 함
  const siteUser = await db.prepare(`
    SELECT id FROM site_users WHERE site_id = ? AND user_id = ?
  `).bind(siteId, userId).first();

  return !!siteUser;
}

/**
 * Subject 접근 권한 확인
 */
export async function checkSubjectAccess(
  db: D1Database,
  userId: string,
  role: UserRole,
  subjectId: string
): Promise<boolean> {
  // ADMIN은 모든 Subject 접근 가능
  if (role === 'ADMIN') {
    return true;
  }

  // DM, CRA는 해당 Subject의 Study에 할당되어 있어야 함
  if (role === 'DM' || role === 'CRA') {
    const studyUser = await db.prepare(`
      SELECT stu.id FROM study_users stu
      JOIN sites s ON stu.study_id = s.study_id
      JOIN subjects subj ON subj.site_id = s.id
      WHERE subj.id = ? AND stu.user_id = ? AND stu.status = 'ACTIVE'
    `).bind(subjectId, userId).first();
    
    return !!studyUser;
  }

  // PI, SUB_INV, CRC는 해당 Subject의 Site에 할당되어 있어야 함
  const siteUser = await db.prepare(`
    SELECT su.id FROM site_users su
    JOIN subjects subj ON su.site_id = subj.site_id
    WHERE subj.id = ? AND su.user_id = ?
    LIMIT 1
  `).bind(subjectId, userId).first();

  return !!siteUser;
}

/**
 * Site 접근 권한 확인 미들웨어
 */
export function requireSiteAccess() {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const user = getAuthUser(c);

    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    // Site ID 추출 (URL 파라미터 또는 쿼리)
    const siteId = c.req.param('siteId') || c.req.query('siteId');

    if (!siteId) {
      return next(); // Site ID가 없으면 다른 곳에서 처리
    }

    const hasAccess = await checkSiteAccess(c.env.DB, user.userId, user.role, siteId);

    if (!hasAccess) {
      return c.json({ 
        success: false, 
        error: '해당 기관에 접근 권한이 없습니다.' 
      }, 403);
    }

    return next();
  };
}

/**
 * Study 접근 권한 확인 미들웨어
 */
export function requireStudyAccess() {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const user = getAuthUser(c);

    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    // Study ID 추출 (URL 파라미터 또는 쿼리)
    const studyId = c.req.param('studyId') || c.req.query('studyId');

    if (!studyId) {
      return next(); // Study ID가 없으면 다른 곳에서 처리
    }

    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, studyId);

    if (!hasAccess) {
      return c.json({ 
        success: false, 
        error: '해당 연구에 접근 권한이 없습니다.' 
      }, 403);
    }

    return next();
  };
}

/**
 * 사용자의 접근 가능한 Study 목록 조회
 */
export async function getAccessibleStudyIds(
  db: D1Database,
  userId: string,
  role: UserRole
): Promise<string[]> {
  // ADMIN은 모든 Study 접근 가능
  if (role === 'ADMIN') {
    const studies = await db.prepare('SELECT id FROM studies').all();
    return studies.results.map((s: any) => s.id);
  }

  // DM, CRA는 study_users 테이블에서 조회
  if (role === 'DM' || role === 'CRA') {
    const studyUsers = await db.prepare(`
      SELECT DISTINCT study_id FROM study_users 
      WHERE user_id = ? AND status = 'ACTIVE'
    `).bind(userId).all();
    
    return studyUsers.results.map((su: any) => su.study_id);
  }

  // PI, SUB_INV, CRC는 site_users를 통해 조회
  const siteUsers = await db.prepare(`
    SELECT DISTINCT s.study_id FROM site_users su
    JOIN sites s ON su.site_id = s.id
    WHERE su.user_id = ?
  `).bind(userId).all();

  return siteUsers.results.map((su: any) => su.study_id);
}

/**
 * 사용자의 접근 가능한 Site 목록 조회
 */
export async function getAccessibleSiteIds(
  db: D1Database,
  userId: string,
  role: UserRole,
  studyId?: string
): Promise<string[]> {
  // ADMIN은 모든 Site 접근 가능
  if (role === 'ADMIN') {
    let query = 'SELECT id FROM sites';
    if (studyId) {
      query += ' WHERE study_id = ?';
      const sites = await db.prepare(query).bind(studyId).all();
      return sites.results.map((s: any) => s.id);
    }
    const sites = await db.prepare(query).all();
    return sites.results.map((s: any) => s.id);
  }

  // DM, CRA는 할당된 Study의 모든 Site에 접근 가능
  if (role === 'DM' || role === 'CRA') {
    let query = `
      SELECT DISTINCT s.id FROM sites s
      JOIN study_users stu ON s.study_id = stu.study_id
      WHERE stu.user_id = ? AND stu.status = 'ACTIVE'
    `;
    if (studyId) {
      query += ' AND s.study_id = ?';
      const sites = await db.prepare(query).bind(userId, studyId).all();
      return sites.results.map((s: any) => s.id);
    }
    const sites = await db.prepare(query).bind(userId).all();
    return sites.results.map((s: any) => s.id);
  }

  // PI, SUB_INV, CRC는 직접 할당된 Site만
  let query = `
    SELECT DISTINCT s.id FROM sites s
    JOIN site_users su ON s.id = su.site_id
    WHERE su.user_id = ?
  `;
  if (studyId) {
    query += ' AND s.study_id = ?';
    const sites = await db.prepare(query).bind(userId, studyId).all();
    return sites.results.map((s: any) => s.id);
  }
  const sites = await db.prepare(query).bind(userId).all();
  return sites.results.map((s: any) => s.id);
}
