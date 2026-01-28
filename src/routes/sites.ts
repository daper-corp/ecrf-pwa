// Site Routes
// 연구기관 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables, Site } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, checkStudyAccess } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const sites = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/studies/:studyId/sites
 * Study의 Site 목록 조회
 */
sites.get('/', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('studyId');
    const status = c.req.query('status');

    // 접근 권한 확인
    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, studyId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Study에 접근 권한이 없습니다.' }, 403);
    }

    let query = `SELECT * FROM sites WHERE study_id = ?`;
    const params: string[] = [studyId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    // Site별 권한 필터 (PI, SUB_INV, CRC는 할당된 Site만)
    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      query += ` AND id IN (SELECT site_id FROM site_users WHERE user_id = ?)`;
      params.push(user.userId);
    }

    query += ` ORDER BY site_number`;

    const sitesResult = await c.env.DB.prepare(query).bind(...params).all<Site>();

    // 각 Site의 Subject 수 추가
    const sitesWithCount = await Promise.all(
      sitesResult.results.map(async (site) => {
        const subjectCount = await c.env.DB.prepare(`
          SELECT COUNT(*) as count FROM subjects WHERE site_id = ?
        `).bind(site.id).first<{ count: number }>();
        
        return {
          ...site,
          subject_count: subjectCount?.count ?? 0,
        };
      })
    );

    return c.json({
      success: true,
      data: sitesWithCount,
    });
  } catch (error) {
    console.error('Get sites error:', error);
    return c.json({ success: false, error: 'Site 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/sites/:id
 * Site 상세 조회
 */
sites.get('/:id', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');

    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, site.study_id);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Site에 접근 권한이 없습니다.' }, 403);
    }

    // Site 사용자 목록
    const siteUsers = await c.env.DB.prepare(`
      SELECT su.*, u.name, u.email, u.role 
      FROM site_users su
      JOIN users u ON su.user_id = u.id
      WHERE su.site_id = ?
    `).bind(siteId).all();

    // Subject 통계
    const subjectStats = await c.env.DB.prepare(`
      SELECT status, COUNT(*) as count 
      FROM subjects WHERE site_id = ?
      GROUP BY status
    `).bind(siteId).all();

    return c.json({
      success: true,
      data: {
        ...site,
        users: siteUsers.results,
        subjectStats: subjectStats.results,
      },
    });
  } catch (error) {
    console.error('Get site error:', error);
    return c.json({ success: false, error: 'Site 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/studies/:studyId/sites
 * Site 생성
 */
sites.post('/', requireAuth, requirePermission('MANAGE_SITE'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('studyId');
    const body = await c.req.json();
    const { site_number, name, address, city, country, pi_name, pi_email, phone } = body;

    if (!site_number || !name) {
      return c.json({ success: false, error: 'Site 번호와 이름은 필수입니다.' }, 400);
    }

    // Study 존재 확인
    const study = await c.env.DB.prepare(`
      SELECT id, status FROM studies WHERE id = ?
    `).bind(studyId).first();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    // Site 번호 중복 확인
    const existing = await c.env.DB.prepare(`
      SELECT id FROM sites WHERE study_id = ? AND site_number = ?
    `).bind(studyId, site_number).first();

    if (existing) {
      return c.json({ success: false, error: '이미 존재하는 Site 번호입니다.' }, 400);
    }

    const siteId = generateId('site');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO sites (
        id, study_id, site_number, name, address, city, country,
        pi_name, pi_email, phone, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).bind(
      siteId, studyId, site_number, name, 
      address ?? null, city ?? null, country ?? 'KR',
      pi_name ?? null, pi_email ?? null, phone ?? null,
      timestamp, timestamp
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId,
      siteId,
    }, {
      action: 'CREATE',
      tableName: 'sites',
      recordId: siteId,
    });

    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    return c.json({
      success: true,
      data: site,
    }, 201);
  } catch (error) {
    console.error('Create site error:', error);
    return c.json({ success: false, error: 'Site 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/sites/:id
 * Site 수정
 */
sites.put('/:id', requireAuth, requirePermission('MANAGE_SITE'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');
    const body = await c.req.json();

    const existingSite = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!existingSite) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    const { 
      name, address, city, country, pi_name, pi_email, phone, 
      status, activation_date, closure_date, reason_for_change 
    } = body;

    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE sites SET
        name = COALESCE(?, name),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        pi_name = COALESCE(?, pi_name),
        pi_email = COALESCE(?, pi_email),
        phone = COALESCE(?, phone),
        status = COALESCE(?, status),
        activation_date = COALESCE(?, activation_date),
        closure_date = COALESCE(?, closure_date),
        updated_at = ?
      WHERE id = ?
    `).bind(
      name ?? null, address ?? null, city ?? null, country ?? null,
      pi_name ?? null, pi_email ?? null, phone ?? null,
      status ?? null, activation_date ?? null, closure_date ?? null,
      timestamp, siteId
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: existingSite.study_id,
      siteId,
    };

    const fieldsToCheck = ['name', 'address', 'city', 'country', 'pi_name', 'pi_email', 'phone', 'status'];
    for (const field of fieldsToCheck) {
      const oldValue = (existingSite as any)[field];
      const newValue = (body as any)[field];
      
      if (newValue !== undefined && newValue !== oldValue) {
        await createAuditLog(c.env.DB, auditContext, {
          action: 'UPDATE',
          tableName: 'sites',
          recordId: siteId,
          fieldName: field,
          oldValue: oldValue?.toString() ?? null,
          newValue: newValue?.toString() ?? null,
          reasonForChange: reason_for_change,
        });
      }
    }

    const updatedSite = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    return c.json({
      success: true,
      data: updatedSite,
    });
  } catch (error) {
    console.error('Update site error:', error);
    return c.json({ success: false, error: 'Site 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/sites/:id/users
 * Site에 사용자 할당 (PI, SUB_INV, CRC)
 */
sites.post('/:id/users', requireAuth, requirePermission('ASSIGN_SITE_USERS'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');
    const body = await c.req.json();
    const { user_id, is_primary } = body;

    if (!user_id) {
      return c.json({ success: false, error: '사용자 ID는 필수입니다.' }, 400);
    }

    // Site 확인
    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    // 사용자 확인
    const targetUser = await c.env.DB.prepare(`
      SELECT id, name, email, role, status FROM users WHERE id = ?
    `).bind(user_id).first<{ id: string; name: string; email: string; role: string; status: string }>();

    if (!targetUser) {
      return c.json({ success: false, error: '사용자를 찾을 수 없습니다.' }, 404);
    }

    if (targetUser.status !== 'ACTIVE') {
      return c.json({ success: false, error: '비활성 상태의 사용자는 할당할 수 없습니다.' }, 400);
    }

    // PI, SUB_INV, CRC만 Site에 할당 가능 (DM/CRA는 Study에 할당)
    if (!['PI', 'SUB_INV', 'CRC'].includes(targetUser.role)) {
      return c.json({ 
        success: false, 
        error: 'Site에는 PI, Sub-Investigator, CRC 역할의 사용자만 할당할 수 있습니다. DM/CRA는 Study에 할당해주세요.' 
      }, 400);
    }

    // 이미 할당되어 있는지 확인
    const existing = await c.env.DB.prepare(`
      SELECT id FROM site_users WHERE site_id = ? AND user_id = ?
    `).bind(siteId, user_id).first();

    if (existing) {
      return c.json({ success: false, error: '이미 할당된 사용자입니다.' }, 400);
    }

    const siteUserId = generateId('su');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO site_users (id, site_id, user_id, is_primary, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(siteUserId, siteId, user_id, is_primary ? 1 : 0, timestamp).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: site.study_id,
      siteId,
    }, {
      action: 'CREATE',
      tableName: 'site_users',
      recordId: siteUserId,
      newValue: `User ${user_id} assigned to Site ${siteId}`,
    });

    return c.json({
      success: true,
      message: '사용자가 Site에 할당되었습니다.',
    }, 201);
  } catch (error) {
    console.error('Assign site user error:', error);
    return c.json({ success: false, error: '사용자 할당 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/sites/:id/users
 * Site에 할당된 사용자 목록 조회
 */
sites.get('/:id/users', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');

    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, site.study_id);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Site에 접근 권한이 없습니다.' }, 403);
    }

    const siteUsers = await c.env.DB.prepare(`
      SELECT 
        su.id, su.site_id, su.user_id, su.is_primary, su.assigned_at,
        u.email, u.name, u.role, u.status as user_status
      FROM site_users su
      JOIN users u ON su.user_id = u.id
      WHERE su.site_id = ?
      ORDER BY su.is_primary DESC, u.role, u.name
    `).bind(siteId).all();

    return c.json({
      success: true,
      data: siteUsers.results,
    });
  } catch (error) {
    console.error('Get site users error:', error);
    return c.json({ success: false, error: 'Site 사용자 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/sites/:id/assignable-users
 * Site에 할당 가능한 사용자 목록 조회 (PI, SUB_INV, CRC 역할만)
 */
sites.get('/:id/assignable-users', requireAuth, requirePermission('ASSIGN_SITE_USERS'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');

    // PI, SUB_INV, CRC 역할의 활성 사용자 중 아직 해당 Site에 할당되지 않은 사용자
    const users = await c.env.DB.prepare(`
      SELECT id, email, name, role
      FROM users
      WHERE role IN ('PI', 'SUB_INV', 'CRC')
        AND status = 'ACTIVE'
        AND id NOT IN (
          SELECT user_id FROM site_users WHERE site_id = ?
        )
      ORDER BY role, name
    `).bind(siteId).all();

    return c.json({
      success: true,
      data: users.results,
    });
  } catch (error) {
    console.error('Get assignable users error:', error);
    return c.json({ success: false, error: '할당 가능한 사용자 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/sites/:id/users/:siteUserId
 * Site 사용자 정보 수정 (주담당 여부 등)
 */
sites.put('/:id/users/:siteUserId', requireAuth, requirePermission('ASSIGN_SITE_USERS'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');
    const siteUserId = c.req.param('siteUserId');
    const body = await c.req.json();
    const { is_primary } = body;

    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    await c.env.DB.prepare(`
      UPDATE site_users SET is_primary = ? WHERE id = ? AND site_id = ?
    `).bind(is_primary ? 1 : 0, siteUserId, siteId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: site.study_id,
      siteId,
    }, {
      action: 'UPDATE',
      tableName: 'site_users',
      recordId: siteUserId,
      newValue: JSON.stringify({ is_primary }),
    });

    return c.json({
      success: true,
      message: '사용자 정보가 수정되었습니다.',
    });
  } catch (error) {
    console.error('Update site user error:', error);
    return c.json({ success: false, error: '사용자 정보 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * DELETE /api/sites/:id/users/:userId
 * Site에서 사용자 제거
 */
sites.delete('/:id/users/:userId', requireAuth, requirePermission('ASSIGN_SITE_USERS'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('id');
    const targetUserId = c.req.param('userId');

    const site = await c.env.DB.prepare(`
      SELECT * FROM sites WHERE id = ?
    `).bind(siteId).first<Site>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    await c.env.DB.prepare(`
      DELETE FROM site_users WHERE site_id = ? AND user_id = ?
    `).bind(siteId, targetUserId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: site.study_id,
      siteId,
    }, {
      action: 'DELETE',
      tableName: 'site_users',
      recordId: `${siteId}-${targetUserId}`,
      oldValue: `User ${targetUserId} removed from Site ${siteId}`,
    });

    return c.json({
      success: true,
      message: '사용자가 Site에서 제거되었습니다.',
    });
  } catch (error) {
    console.error('Remove site user error:', error);
    return c.json({ success: false, error: '사용자 제거 중 오류가 발생했습니다.' }, 500);
  }
});

export default sites;
