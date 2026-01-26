// Role-Based Access Control Middleware
// 역할 기반 접근 제어 미들웨어

import { Context, Next } from 'hono';
import type { Bindings, Variables, UserRole } from '../types';
import { getAuthUser } from './auth';

/**
 * 권한 정의
 */
export const PERMISSIONS = {
  // 데이터 조회
  READ_DATA: ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
  
  // 데이터 입력/수정
  WRITE_DATA: ['PI', 'SUB_INV', 'CRC', 'DM'],
  
  // 최종 서명
  SIGN_CRF: ['PI'],
  
  // Query 발행
  CREATE_QUERY: ['PI', 'SUB_INV', 'CRC', 'CRA', 'DM'],
  
  // Query 답변
  ANSWER_QUERY: ['PI', 'SUB_INV', 'CRC', 'DM'],
  
  // Query 종료
  CLOSE_QUERY: ['CRA', 'DM'],
  
  // Data Export
  EXPORT_DATA: ['PI', 'DM'],
  
  // Data Lock/Unlock
  LOCK_DATA: ['DM'],
  UNLOCK_DATA: ['DM'],
  
  // Study 관리
  MANAGE_STUDY: ['ADMIN', 'DM'],
  
  // Site 관리
  MANAGE_SITE: ['ADMIN', 'DM'],
  
  // 사용자 관리
  MANAGE_USERS: ['ADMIN'],
  
  // 감사 로그 조회
  VIEW_AUDIT: ['ADMIN', 'PI', 'DM'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

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
 * Site 접근 권한 확인 미들웨어
 * - 사용자가 해당 Site에 할당되어 있는지 확인
 * - ADMIN, DM은 모든 Site 접근 가능
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

    // ADMIN, DM은 모든 Site 접근 가능
    if (user.role === 'ADMIN' || user.role === 'DM' || user.role === 'CRA') {
      return next();
    }

    // Site ID 추출 (URL 파라미터 또는 쿼리)
    const siteId = c.req.param('siteId') || c.req.query('siteId');

    if (!siteId) {
      return next(); // Site ID가 없으면 다른 곳에서 처리
    }

    // Site-User 매핑 확인
    const siteUser = await c.env.DB.prepare(`
      SELECT id FROM site_users WHERE site_id = ? AND user_id = ?
    `).bind(siteId, user.userId).first();

    if (!siteUser) {
      return c.json({ 
        success: false, 
        error: '해당 기관에 접근 권한이 없습니다.' 
      }, 403);
    }

    return next();
  };
}

/**
 * Study 접근 권한 확인
 * - 사용자가 해당 Study의 Site에 할당되어 있는지 확인
 */
export async function checkStudyAccess(
  db: D1Database,
  userId: string,
  role: UserRole,
  studyId: string
): Promise<boolean> {
  // ADMIN, DM, CRA는 모든 Study 접근 가능
  if (role === 'ADMIN' || role === 'DM' || role === 'CRA') {
    return true;
  }

  // 해당 Study의 Site에 할당되어 있는지 확인
  const result = await db.prepare(`
    SELECT su.id FROM site_users su
    JOIN sites s ON su.site_id = s.id
    WHERE s.study_id = ? AND su.user_id = ?
    LIMIT 1
  `).bind(studyId, userId).first();

  return !!result;
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
  // ADMIN, DM, CRA는 모든 Subject 접근 가능
  if (role === 'ADMIN' || role === 'DM' || role === 'CRA') {
    return true;
  }

  // 해당 Subject의 Site에 할당되어 있는지 확인
  const result = await db.prepare(`
    SELECT su.id FROM site_users su
    JOIN subjects subj ON su.site_id = subj.site_id
    WHERE subj.id = ? AND su.user_id = ?
    LIMIT 1
  `).bind(subjectId, userId).first();

  return !!result;
}
