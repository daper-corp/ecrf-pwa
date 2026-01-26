// Authentication Service
// 사용자 인증 및 세션 관리

import type { User, Session, AuthPayload, UserRole } from '../types';
import { hashPassword, verifyPassword, hashToken, validatePasswordPolicy } from '../utils/crypto';
import { generateId, generateSessionId } from '../utils/id';
import { now, addMinutes, isExpired } from '../utils/date';
import { logAuthEvent } from './audit.service';

const SESSION_TIMEOUT_MINUTES = 30;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

export interface LoginResult {
  success: boolean;
  token?: string;
  user?: Omit<User, 'password_hash'>;
  error?: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
  iat: number;
  exp: number;
}

/**
 * 사용자 로그인
 */
export async function login(
  db: D1Database,
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> {
  // 사용자 조회
  const user = await db.prepare(`
    SELECT * FROM users WHERE email = ?
  `).bind(email).first<User>();

  if (!user) {
    return { success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
  }

  // 계정 잠금 확인
  if (user.status === 'LOCKED') {
    if (user.locked_until && !isExpired(user.locked_until)) {
      return { success: false, error: '계정이 잠금 상태입니다. 잠시 후 다시 시도해주세요.' };
    }
    // 잠금 시간이 지났으면 잠금 해제
    await db.prepare(`
      UPDATE users SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?
    `).bind(now(), user.id).run();
    user.status = 'ACTIVE';
    user.failed_login_attempts = 0;
  }

  if (user.status !== 'ACTIVE') {
    return { success: false, error: '비활성화된 계정입니다.' };
  }

  // 비밀번호 검증
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    // 실패 횟수 증가
    const newAttempts = user.failed_login_attempts + 1;
    
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      // 계정 잠금
      const lockUntil = addMinutes(new Date(), LOCKOUT_DURATION_MINUTES).toISOString();
      await db.prepare(`
        UPDATE users SET 
          failed_login_attempts = ?,
          status = 'LOCKED',
          locked_until = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(newAttempts, lockUntil, now(), user.id).run();
      
      return { 
        success: false, 
        error: `로그인 ${MAX_LOGIN_ATTEMPTS}회 실패로 계정이 잠금되었습니다.` 
      };
    }

    await db.prepare(`
      UPDATE users SET failed_login_attempts = ?, updated_at = ?
      WHERE id = ?
    `).bind(newAttempts, now(), user.id).run();

    return { 
      success: false, 
      error: `이메일 또는 비밀번호가 올바르지 않습니다. (${newAttempts}/${MAX_LOGIN_ATTEMPTS})` 
    };
  }

  // 로그인 성공 - 실패 횟수 초기화
  await db.prepare(`
    UPDATE users SET 
      failed_login_attempts = 0,
      last_login_at = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(now(), now(), user.id).run();

  // 세션 생성
  const sessionId = generateSessionId();
  const expiresAt = addMinutes(new Date(), SESSION_TIMEOUT_MINUTES).toISOString();
  const tokenHash = await hashToken(sessionId);

  await db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(sessionId, user.id, tokenHash, ipAddress ?? null, userAgent ?? null, expiresAt, now()).run();

  // JWT 페이로드 생성 (실제로는 JWT 라이브러리 사용)
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  };

  // 간단한 토큰 생성 (실제로는 JWT 사용)
  const token = btoa(JSON.stringify(payload));

  // 감사 로그
  await logAuthEvent(db, 'LOGIN', {
    userId: user.id,
    name: user.name,
    role: user.role,
  }, ipAddress, userAgent, sessionId);

  // password_hash 제외하고 반환
  const { password_hash, ...userWithoutPassword } = user;

  return {
    success: true,
    token,
    user: userWithoutPassword,
  };
}

/**
 * 로그아웃
 */
export async function logout(
  db: D1Database,
  sessionId: string,
  user: AuthPayload,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  // 세션 삭제
  await db.prepare(`
    DELETE FROM sessions WHERE id = ?
  `).bind(sessionId).run();

  // 감사 로그
  await logAuthEvent(db, 'LOGOUT', {
    userId: user.userId,
    name: user.name,
    role: user.role,
  }, ipAddress, userAgent, sessionId);
}

/**
 * 세션 검증
 */
export async function validateSession(
  db: D1Database,
  sessionId: string
): Promise<{ valid: boolean; user?: User }> {
  const session = await db.prepare(`
    SELECT s.*, u.* FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).bind(sessionId).first<Session & User>();

  if (!session) {
    return { valid: false };
  }

  if (isExpired(session.expires_at)) {
    // 만료된 세션 삭제
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
    return { valid: false };
  }

  return { valid: true, user: session };
}

/**
 * 세션 연장
 */
export async function extendSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  const newExpiresAt = addMinutes(new Date(), SESSION_TIMEOUT_MINUTES).toISOString();
  
  await db.prepare(`
    UPDATE sessions SET expires_at = ? WHERE id = ?
  `).bind(newExpiresAt, sessionId).run();
}

/**
 * 토큰 파싱 (간단한 구현)
 */
export function parseToken(token: string): TokenPayload | null {
  try {
    const payload = JSON.parse(atob(token));
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * 사용자 생성 (관리자용)
 */
export async function createUser(
  db: D1Database,
  data: {
    email: string;
    password: string;
    name: string;
    role: UserRole;
  }
): Promise<{ success: boolean; user?: User; error?: string }> {
  // 비밀번호 정책 검증
  const passwordValidation = validatePasswordPolicy(data.password);
  if (!passwordValidation.valid) {
    return { 
      success: false, 
      error: passwordValidation.errors.join(' ') 
    };
  }

  // 이메일 중복 확인
  const existing = await db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).bind(data.email).first();

  if (existing) {
    return { success: false, error: '이미 존재하는 이메일입니다.' };
  }

  const userId = generateId('usr');
  const passwordHash = await hashPassword(data.password);

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, status, password_changed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
  `).bind(userId, data.email, passwordHash, data.name, data.role, now(), now(), now()).run();

  // 비밀번호 히스토리 저장
  await db.prepare(`
    INSERT INTO password_history (id, user_id, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(generateId('pwh'), userId, passwordHash, now()).run();

  const user = await db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).bind(userId).first<User>();

  return { success: true, user: user! };
}

/**
 * 비밀번호 변경
 */
export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).bind(userId).first<User>();

  if (!user) {
    return { success: false, error: '사용자를 찾을 수 없습니다.' };
  }

  // 현재 비밀번호 확인
  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    return { success: false, error: '현재 비밀번호가 올바르지 않습니다.' };
  }

  // 새 비밀번호 정책 검증
  const passwordValidation = validatePasswordPolicy(newPassword);
  if (!passwordValidation.valid) {
    return { 
      success: false, 
      error: passwordValidation.errors.join(' ') 
    };
  }

  // 이전 비밀번호 재사용 확인
  const history = await db.prepare(`
    SELECT password_hash FROM password_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).bind(userId).all<{ password_hash: string }>();

  for (const record of history.results) {
    if (await verifyPassword(newPassword, record.password_hash)) {
      return { 
        success: false, 
        error: '최근 사용한 비밀번호는 재사용할 수 없습니다.' 
      };
    }
  }

  // 비밀번호 업데이트
  const newPasswordHash = await hashPassword(newPassword);
  
  await db.prepare(`
    UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(newPasswordHash, now(), now(), userId).run();

  // 비밀번호 히스토리 저장
  await db.prepare(`
    INSERT INTO password_history (id, user_id, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(generateId('pwh'), userId, newPasswordHash, now()).run();

  // 모든 세션 무효화
  await db.prepare(`
    DELETE FROM sessions WHERE user_id = ?
  `).bind(userId).run();

  return { success: true };
}

/**
 * 사용자 목록 조회
 */
export async function getUsers(
  db: D1Database,
  options?: {
    role?: UserRole;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ users: Omit<User, 'password_hash'>[]; total: number }> {
  let query = `SELECT id, email, name, role, status, failed_login_attempts, locked_until, 
               password_changed_at, last_login_at, two_factor_enabled, created_at, updated_at FROM users WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as total FROM users WHERE 1=1`;
  const filterParams: (string | number)[] = [];
  const queryParams: (string | number)[] = [];

  if (options?.role) {
    query += ` AND role = ?`;
    countQuery += ` AND role = ?`;
    filterParams.push(options.role);
    queryParams.push(options.role);
  }

  if (options?.status) {
    query += ` AND status = ?`;
    countQuery += ` AND status = ?`;
    filterParams.push(options.status);
    queryParams.push(options.status);
  }

  query += ` ORDER BY created_at DESC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    queryParams.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET ?`;
    queryParams.push(options.offset);
  }

  // Count query uses only filter params (no LIMIT/OFFSET)
  let countResult: { total: number } | null = null;
  if (filterParams.length > 0) {
    countResult = await db.prepare(countQuery).bind(...filterParams).first<{ total: number }>();
  } else {
    countResult = await db.prepare(countQuery).first<{ total: number }>();
  }
  
  // Users query uses all params including LIMIT/OFFSET
  let usersResult;
  if (queryParams.length > 0) {
    usersResult = await db.prepare(query).bind(...queryParams).all<Omit<User, 'password_hash'>>();
  } else {
    usersResult = await db.prepare(query).all<Omit<User, 'password_hash'>>();
  }

  return {
    users: usersResult.results,
    total: countResult?.total ?? 0,
  };
}
