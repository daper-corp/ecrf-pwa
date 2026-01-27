// Study Routes
// 임상시험 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables, Study, StudyStatus, StudyPhase } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, checkStudyAccess } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const studies = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/studies
 * Study 목록 조회
 */
studies.get('/', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let query = `SELECT * FROM studies WHERE 1=1`;
    const params: (string | number)[] = [];

    // 상태 필터
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    // 권한에 따른 필터링 (ADMIN, DM, CRA는 모든 Study 조회 가능)
    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      query += ` AND id IN (
        SELECT DISTINCT s.study_id FROM sites s
        JOIN site_users su ON s.id = su.site_id
        WHERE su.user_id = ?
      )`;
      params.push(user.userId);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // Count query
    let countQuery = `SELECT COUNT(*) as total FROM studies WHERE 1=1`;
    const countParams: (string | number)[] = [];
    
    if (status) {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    }

    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      countQuery += ` AND id IN (
        SELECT DISTINCT s.study_id FROM sites s
        JOIN site_users su ON s.id = su.site_id
        WHERE su.user_id = ?
      )`;
      countParams.push(user.userId);
    }

    const [studiesResult, countResult] = await Promise.all([
      c.env.DB.prepare(query).bind(...params).all<Study>(),
      c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>(),
    ]);

    return c.json({
      success: true,
      data: studiesResult.results,
      pagination: {
        total: countResult?.total ?? 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Get studies error:', error);
    return c.json({ success: false, error: 'Study 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/studies/:id
 * Study 상세 조회
 */
studies.get('/:id', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');

    // 접근 권한 확인
    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, studyId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Study에 접근 권한이 없습니다.' }, 403);
    }

    const study = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    // Visit Schedule 조회
    const visitSchedules = await c.env.DB.prepare(`
      SELECT * FROM visit_schedules WHERE study_id = ? ORDER BY visit_number
    `).bind(studyId).all();

    // Form Definitions 조회
    const formDefinitions = await c.env.DB.prepare(`
      SELECT * FROM form_definitions WHERE study_id = ? ORDER BY form_order
    `).bind(studyId).all();

    // Sites 수 조회
    const sitesCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM sites WHERE study_id = ?
    `).bind(studyId).first<{ count: number }>();

    // Subjects 수 조회
    const subjectsCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM subjects WHERE site_id IN (
        SELECT id FROM sites WHERE study_id = ?
      )
    `).bind(studyId).first<{ count: number }>();

    return c.json({
      success: true,
      data: {
        ...study,
        visitSchedules: visitSchedules.results,
        formDefinitions: formDefinitions.results,
        sitesCount: sitesCount?.count ?? 0,
        subjectsCount: subjectsCount?.count ?? 0,
      },
    });
  } catch (error) {
    console.error('Get study error:', error);
    return c.json({ success: false, error: 'Study 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/studies
 * Study 생성
 */
studies.post('/', requireAuth, requirePermission('MANAGE_STUDY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const body = await c.req.json();
    const { 
      protocol_number, 
      title, 
      short_title, 
      version = '1.0',
      phase,
      sponsor,
      therapeutic_area,
      irb_approval_number,
      irb_approval_date,
      study_start_date,
      description,
    } = body;

    if (!protocol_number || !title) {
      return c.json({ success: false, error: '프로토콜 번호와 제목은 필수입니다.' }, 400);
    }

    // 프로토콜 번호 중복 확인
    const existing = await c.env.DB.prepare(`
      SELECT id FROM studies WHERE protocol_number = ?
    `).bind(protocol_number).first();

    if (existing) {
      return c.json({ success: false, error: '이미 존재하는 프로토콜 번호입니다.' }, 400);
    }

    const studyId = generateId('study');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO studies (
        id, protocol_number, title, short_title, version, phase, status,
        sponsor, therapeutic_area, irb_approval_number, irb_approval_date, study_start_date,
        description, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      studyId, protocol_number, title, short_title ?? null, version, phase ?? null,
      sponsor ?? null, therapeutic_area ?? null, irb_approval_number ?? null, irb_approval_date ?? null,
      study_start_date ?? null, description ?? null, user.userId, timestamp, timestamp
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId,
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'CREATE',
      tableName: 'studies',
      recordId: studyId,
    });

    const study = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    return c.json({
      success: true,
      data: study,
    }, 201);
  } catch (error) {
    console.error('Create study error:', error);
    return c.json({ success: false, error: 'Study 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/studies/:id
 * Study 수정
 */
studies.put('/:id', requireAuth, requirePermission('MANAGE_STUDY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const body = await c.req.json();

    // 기존 Study 조회
    const existingStudy = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    if (!existingStudy) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    // LOCKED 상태면 수정 불가
    if (existingStudy.status === 'LOCKED') {
      return c.json({ success: false, error: '잠금된 Study는 수정할 수 없습니다.' }, 400);
    }

    const { 
      title, 
      short_title, 
      version,
      phase,
      status,
      sponsor,
      therapeutic_area,
      irb_approval_number,
      irb_approval_date,
      irb_expiry_date,
      study_start_date,
      study_end_date,
      description,
      reason_for_change,
    } = body;

    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE studies SET
        title = COALESCE(?, title),
        short_title = COALESCE(?, short_title),
        version = COALESCE(?, version),
        phase = COALESCE(?, phase),
        status = COALESCE(?, status),
        sponsor = COALESCE(?, sponsor),
        therapeutic_area = COALESCE(?, therapeutic_area),
        irb_approval_number = COALESCE(?, irb_approval_number),
        irb_approval_date = COALESCE(?, irb_approval_date),
        irb_expiry_date = COALESCE(?, irb_expiry_date),
        study_start_date = COALESCE(?, study_start_date),
        study_end_date = COALESCE(?, study_end_date),
        description = COALESCE(?, description),
        updated_at = ?
      WHERE id = ?
    `).bind(
      title ?? null, short_title ?? null, version ?? null, phase ?? null,
      status ?? null, sponsor ?? null, therapeutic_area ?? null, irb_approval_number ?? null,
      irb_approval_date ?? null, irb_expiry_date ?? null,
      study_start_date ?? null, study_end_date ?? null, description ?? null,
      timestamp, studyId
    ).run();

    // Audit Log (변경된 필드 기록)
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId,
    };

    const fieldsToCheck = [
      'title', 'short_title', 'version', 'phase', 'status', 'sponsor', 'therapeutic_area',
      'irb_approval_number', 'irb_approval_date', 'irb_expiry_date',
      'study_start_date', 'study_end_date', 'description'
    ];

    for (const field of fieldsToCheck) {
      const oldValue = (existingStudy as any)[field];
      const newValue = (body as any)[field];
      
      if (newValue !== undefined && newValue !== oldValue) {
        await createAuditLog(c.env.DB, auditContext, {
          action: 'UPDATE',
          tableName: 'studies',
          recordId: studyId,
          fieldName: field,
          oldValue: oldValue?.toString() ?? null,
          newValue: newValue?.toString() ?? null,
          reasonForChange: reason_for_change,
        });
      }
    }

    const updatedStudy = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    return c.json({
      success: true,
      data: updatedStudy,
    });
  } catch (error) {
    console.error('Update study error:', error);
    return c.json({ success: false, error: 'Study 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/studies/:id/lock
 * Study Lock
 */
studies.post('/:id/lock', requireAuth, requirePermission('LOCK_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const body = await c.req.json();
    const { reason } = body;

    const study = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    if (study.status === 'LOCKED') {
      return c.json({ success: false, error: '이미 잠금된 Study입니다.' }, 400);
    }

    const timestamp = now();

    // Study 상태 변경
    await c.env.DB.prepare(`
      UPDATE studies SET status = 'LOCKED', updated_at = ? WHERE id = ?
    `).bind(timestamp, studyId).run();

    // Data Lock 레코드 생성
    await c.env.DB.prepare(`
      INSERT INTO data_locks (id, lock_type, record_id, locked_by, locked_at, lock_reason)
      VALUES (?, 'STUDY', ?, ?, ?, ?)
    `).bind(generateId('lock'), studyId, user.userId, timestamp, reason ?? null).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId,
    }, {
      action: 'LOCK',
      tableName: 'studies',
      recordId: studyId,
      fieldName: 'status',
      oldValue: study.status,
      newValue: 'LOCKED',
      reasonForChange: reason,
    });

    return c.json({
      success: true,
      message: 'Study가 잠금되었습니다.',
    });
  } catch (error) {
    console.error('Lock study error:', error);
    return c.json({ success: false, error: 'Study 잠금 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/studies/:id/unlock
 * Study Unlock (잠금 해제)
 */
studies.post('/:id/unlock', requireAuth, requirePermission('LOCK_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const body = await c.req.json();
    const { reason } = body;

    if (!reason || reason.trim().length < 10) {
      return c.json({ success: false, error: '잠금 해제 사유는 최소 10자 이상 입력해야 합니다.' }, 400);
    }

    const study = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(studyId).first<Study>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    if (study.status !== 'LOCKED') {
      return c.json({ success: false, error: '잠금되지 않은 Study입니다.' }, 400);
    }

    const timestamp = now();
    const previousStatus = 'ACTIVE'; // 잠금 해제 시 ACTIVE 상태로 복원

    // Study 상태 변경
    await c.env.DB.prepare(`
      UPDATE studies SET status = ?, updated_at = ? WHERE id = ?
    `).bind(previousStatus, timestamp, studyId).run();

    // Data Lock 레코드 업데이트 (해제)
    await c.env.DB.prepare(`
      UPDATE data_locks 
      SET unlocked_by = ?, unlocked_at = ?, unlock_reason = ?
      WHERE record_id = ? AND lock_type = 'STUDY' AND unlocked_at IS NULL
    `).bind(user.userId, timestamp, reason, studyId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId,
    }, {
      action: 'UNLOCK',
      tableName: 'studies',
      recordId: studyId,
      fieldName: 'status',
      oldValue: 'LOCKED',
      newValue: previousStatus,
      reasonForChange: reason,
    });

    return c.json({
      success: true,
      message: 'Study 잠금이 해제되었습니다.',
    });
  } catch (error) {
    console.error('Unlock study error:', error);
    return c.json({ success: false, error: 'Study 잠금 해제 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/studies/:id/stats
 * Study 통계 조회
 */
studies.get('/:id/stats', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');

    // 접근 권한 확인
    const hasAccess = await checkStudyAccess(c.env.DB, user.userId, user.role, studyId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Study에 접근 권한이 없습니다.' }, 403);
    }

    // 통계 쿼리들
    const [
      sitesStats,
      subjectsStats,
      crfStats,
      queriesStats,
    ] = await Promise.all([
      // Sites 통계
      c.env.DB.prepare(`
        SELECT status, COUNT(*) as count FROM sites WHERE study_id = ? GROUP BY status
      `).bind(studyId).all(),
      
      // Subjects 통계
      c.env.DB.prepare(`
        SELECT status, COUNT(*) as count FROM subjects 
        WHERE site_id IN (SELECT id FROM sites WHERE study_id = ?)
        GROUP BY status
      `).bind(studyId).all(),
      
      // CRF 통계
      c.env.DB.prepare(`
        SELECT status, COUNT(*) as count FROM crf_instances
        WHERE visit_id IN (
          SELECT v.id FROM visits v
          JOIN subjects s ON v.subject_id = s.id
          JOIN sites si ON s.site_id = si.id
          WHERE si.study_id = ?
        )
        GROUP BY status
      `).bind(studyId).all(),
      
      // Query 통계
      c.env.DB.prepare(`
        SELECT status, COUNT(*) as count FROM queries
        WHERE crf_instance_id IN (
          SELECT ci.id FROM crf_instances ci
          JOIN visits v ON ci.visit_id = v.id
          JOIN subjects s ON v.subject_id = s.id
          JOIN sites si ON s.site_id = si.id
          WHERE si.study_id = ?
        )
        GROUP BY status
      `).bind(studyId).all(),
    ]);

    return c.json({
      success: true,
      data: {
        sites: sitesStats.results,
        subjects: subjectsStats.results,
        crfs: crfStats.results,
        queries: queriesStats.results,
      },
    });
  } catch (error) {
    console.error('Get study stats error:', error);
    return c.json({ success: false, error: 'Study 통계 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/studies/:id/visit-schedules
 * Visit Schedule 목록 조회
 */
studies.get('/:id/visit-schedules', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');

    const visitSchedules = await c.env.DB.prepare(`
      SELECT * FROM visit_schedules WHERE study_id = ? ORDER BY visit_number
    `).bind(studyId).all();

    return c.json({
      success: true,
      data: visitSchedules.results,
    });
  } catch (error) {
    console.error('Get visit schedules error:', error);
    return c.json({ success: false, error: 'Visit Schedule 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/studies/:id/visit-schedules
 * Visit Schedule 생성
 */
studies.post('/:id/visit-schedules', requireAuth, requirePermission('MANAGE_STUDY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const body = await c.req.json();
    const { visit_name, visit_number, target_day, visit_window_before, visit_window_after, is_required, description } = body;

    if (!visit_name || visit_number === undefined) {
      return c.json({ success: false, error: '방문명과 방문 번호는 필수입니다.' }, 400);
    }

    // Study 확인
    const study = await c.env.DB.prepare(`
      SELECT id, status FROM studies WHERE id = ?
    `).bind(studyId).first<{ id: string; status: string }>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    if (study.status === 'LOCKED') {
      return c.json({ success: false, error: '잠금된 Study에는 방문 일정을 추가할 수 없습니다.' }, 400);
    }

    // 중복 방문 번호 확인
    const existing = await c.env.DB.prepare(`
      SELECT id FROM visit_schedules WHERE study_id = ? AND visit_number = ?
    `).bind(studyId, visit_number).first();

    if (existing) {
      return c.json({ success: false, error: '이미 존재하는 방문 번호입니다.' }, 400);
    }

    const vsId = generateId('vs');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO visit_schedules (
        id, study_id, visit_name, visit_number, target_day,
        visit_window_before, visit_window_after, is_required, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      vsId, studyId, visit_name, visit_number, target_day ?? 0,
      visit_window_before ?? 0, visit_window_after ?? 0, 
      is_required ? 1 : 0, description ?? null, timestamp
    ).run();

    const newSchedule = await c.env.DB.prepare(`
      SELECT * FROM visit_schedules WHERE id = ?
    `).bind(vsId).first();

    return c.json({ success: true, data: newSchedule }, 201);
  } catch (error) {
    console.error('Create visit schedule error:', error);
    return c.json({ success: false, error: 'Visit Schedule 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/studies/:id/visit-schedules/:vsId
 * Visit Schedule 수정
 */
studies.put('/:id/visit-schedules/:vsId', requireAuth, requirePermission('MANAGE_STUDY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const vsId = c.req.param('vsId');
    const body = await c.req.json();
    const { visit_name, target_day, visit_window_before, visit_window_after, is_required, description } = body;

    // Study 확인
    const study = await c.env.DB.prepare(`
      SELECT id, status FROM studies WHERE id = ?
    `).bind(studyId).first<{ id: string; status: string }>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    if (study.status === 'LOCKED') {
      return c.json({ success: false, error: '잠금된 Study의 방문 일정은 수정할 수 없습니다.' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE visit_schedules SET
        visit_name = COALESCE(?, visit_name),
        target_day = COALESCE(?, target_day),
        visit_window_before = COALESCE(?, visit_window_before),
        visit_window_after = COALESCE(?, visit_window_after),
        is_required = COALESCE(?, is_required),
        description = COALESCE(?, description)
      WHERE id = ? AND study_id = ?
    `).bind(
      visit_name, target_day, visit_window_before, visit_window_after,
      is_required !== undefined ? (is_required ? 1 : 0) : null, description,
      vsId, studyId
    ).run();

    const updated = await c.env.DB.prepare(`
      SELECT * FROM visit_schedules WHERE id = ?
    `).bind(vsId).first();

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update visit schedule error:', error);
    return c.json({ success: false, error: 'Visit Schedule 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * DELETE /api/studies/:id/visit-schedules/:vsId
 * Visit Schedule 삭제
 */
studies.delete('/:id/visit-schedules/:vsId', requireAuth, requirePermission('MANAGE_STUDY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const studyId = c.req.param('id');
    const vsId = c.req.param('vsId');

    // Study 확인
    const study = await c.env.DB.prepare(`
      SELECT id, status FROM studies WHERE id = ?
    `).bind(studyId).first<{ id: string; status: string }>();

    if (!study) {
      return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    if (study.status === 'LOCKED') {
      return c.json({ success: false, error: '잠금된 Study의 방문 일정은 삭제할 수 없습니다.' }, 400);
    }

    // 해당 Visit Schedule이 사용중인지 확인
    const usedCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM visits WHERE visit_schedule_id = ?
    `).bind(vsId).first<{ count: number }>();

    if (usedCount && usedCount.count > 0) {
      return c.json({ success: false, error: '이미 사용 중인 방문 일정은 삭제할 수 없습니다.' }, 400);
    }

    await c.env.DB.prepare(`
      DELETE FROM visit_schedules WHERE id = ? AND study_id = ?
    `).bind(vsId, studyId).run();

    return c.json({ success: true, message: '방문 일정이 삭제되었습니다.' });
  } catch (error) {
    console.error('Delete visit schedule error:', error);
    return c.json({ success: false, error: 'Visit Schedule 삭제 중 오류가 발생했습니다.' }, 500);
  }
});

export default studies;
