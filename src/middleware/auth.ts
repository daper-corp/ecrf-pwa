// Authentication Middleware
// 인증 및 세션 검증 미들웨어

import { Context, Next } from 'hono';
import type { Bindings, Variables, AuthPayload } from '../types';
import { parseToken, validateSession, extendSession } from '../services/auth.service';

/**
 * 인증 미들웨어
 * - Authorization 헤더에서 Bearer 토큰 추출
 * - 토큰 검증 및 세션 확인
 * - 유효한 경우 사용자 정보를 context에 저장
 */
export async function authMiddleware(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    c.set('user', null);
    c.set('sessionId', null);
    return next();
  }

  const token = authHeader.slice(7); // "Bearer " 제거
  const payload = parseToken(token);

  if (!payload) {
    c.set('user', null);
    c.set('sessionId', null);
    return next();
  }

  // 토큰 만료 확인
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    c.set('user', null);
    c.set('sessionId', null);
    return next();
  }

  // 세션 검증
  const { valid, user } = await validateSession(c.env.DB, payload.sessionId);

  if (!valid || !user) {
    c.set('user', null);
    c.set('sessionId', null);
    return next();
  }

  // 세션 연장
  await extendSession(c.env.DB, payload.sessionId);

  // 사용자 정보 저장
  const authPayload: AuthPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sessionId: payload.sessionId,
    iat: payload.iat,
    exp: payload.exp,
  };

  c.set('user', authPayload);
  c.set('sessionId', payload.sessionId);

  return next();
}

/**
 * 인증 필수 미들웨어
 * - 인증되지 않은 요청은 401 반환
 */
export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) {
  const user = c.get('user');

  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  return next();
}

/**
 * 인증 사용자 정보 가져오기 헬퍼
 */
export function getAuthUser(c: Context<{ Bindings: Bindings; Variables: Variables }>): AuthPayload | null {
  return c.get('user');
}

/**
 * 클라이언트 정보 추출 헬퍼
 */
export function getClientInfo(c: Context): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress = c.req.header('CF-Connecting-IP') || 
                    c.req.header('X-Forwarded-For')?.split(',')[0].trim() || 
                    null;
  const userAgent = c.req.header('User-Agent') || null;
  
  return { ipAddress, userAgent };
}
