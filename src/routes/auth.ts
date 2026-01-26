// Authentication Routes
// 인증 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { login, logout, changePassword, createUser, getUsers } from '../services/auth.service';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * POST /api/auth/login
 * 로그인
 */
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json({ success: false, error: '이메일과 비밀번호를 입력해주세요.' }, 400);
    }

    const { ipAddress, userAgent } = getClientInfo(c);
    const result = await login(c.env.DB, email, password, ipAddress ?? undefined, userAgent ?? undefined);

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 401);
    }

    return c.json({
      success: true,
      data: {
        token: result.token,
        user: result.user,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, error: '로그인 처리 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/auth/logout
 * 로그아웃
 */
auth.post('/logout', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    const sessionId = c.get('sessionId');

    if (!user || !sessionId) {
      return c.json({ success: false, error: '세션 정보가 없습니다.' }, 400);
    }

    const { ipAddress, userAgent } = getClientInfo(c);
    await logout(c.env.DB, sessionId, user, ipAddress ?? undefined, userAgent ?? undefined);

    return c.json({ success: true, message: '로그아웃되었습니다.' });
  } catch (error) {
    console.error('Logout error:', error);
    return c.json({ success: false, error: '로그아웃 처리 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/auth/me
 * 현재 사용자 정보 조회
 */
auth.get('/me', requireAuth, async (c) => {
  const user = getAuthUser(c);

  if (!user) {
    return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);
  }

  // DB에서 최신 사용자 정보 조회
  const dbUser = await c.env.DB.prepare(`
    SELECT id, email, name, role, status, last_login_at, created_at
    FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!dbUser) {
    return c.json({ success: false, error: '사용자를 찾을 수 없습니다.' }, 404);
  }

  // 사용자에게 할당된 Site 정보
  const sites = await c.env.DB.prepare(`
    SELECT s.id, s.site_number, s.name, s.study_id, su.is_primary
    FROM site_users su
    JOIN sites s ON su.site_id = s.id
    WHERE su.user_id = ?
  `).bind(user.userId).all();

  return c.json({
    success: true,
    data: {
      user: dbUser,
      sites: sites.results,
    },
  });
});

/**
 * POST /api/auth/change-password
 * 비밀번호 변경
 */
auth.post('/change-password', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    
    if (!user) {
      return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);
    }

    const body = await c.req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return c.json({ success: false, error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' }, 400);
    }

    const result = await changePassword(c.env.DB, user.userId, currentPassword, newPassword);

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }

    return c.json({ 
      success: true, 
      message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.' 
    });
  } catch (error) {
    console.error('Change password error:', error);
    return c.json({ success: false, error: '비밀번호 변경 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/auth/users
 * 사용자 생성 (관리자 전용)
 */
auth.post('/users', requireAuth, requireRole('ADMIN'), async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, name, role } = body;

    if (!email || !password || !name || !role) {
      return c.json({ success: false, error: '모든 필드를 입력해주세요.' }, 400);
    }

    const validRoles = ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'CRA', 'DM'];
    if (!validRoles.includes(role)) {
      return c.json({ success: false, error: '유효하지 않은 역할입니다.' }, 400);
    }

    const result = await createUser(c.env.DB, { email, password, name, role });

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }

    // password_hash 제외하고 반환
    const { password_hash, ...userWithoutPassword } = result.user!;

    return c.json({
      success: true,
      data: userWithoutPassword,
    }, 201);
  } catch (error) {
    console.error('Create user error:', error);
    return c.json({ success: false, error: '사용자 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/auth/users
 * 사용자 목록 조회 (관리자 전용)
 */
auth.get('/users', requireAuth, requireRole('ADMIN'), async (c) => {
  try {
    const role = c.req.query('role');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const result = await getUsers(c.env.DB, {
      role: role as any,
      status,
      limit,
      offset,
    });

    return c.json({
      success: true,
      data: result.users,
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return c.json({ success: false, error: '사용자 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

export default auth;
