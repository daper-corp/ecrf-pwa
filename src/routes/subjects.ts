// Subject Routes
// 피험자 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables, Subject, SubjectStatus } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, checkSubjectAccess } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId, generateSubjectId, generateScreeningNumber } from '../utils/id';
import { now } from '../utils/date';

const subjects = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/sites/:siteId/subjects
 * Site의 Subject 목록 조회
 */
subjects.get('/', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('siteId');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    // Site 확인 및 Study ID 가져오기
    const site = await c.env.DB.prepare(`
      SELECT id, study_id FROM sites WHERE id = ?
    `).bind(siteId).first<{ id: string; study_id: string }>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    // 권한 확인 (Site 사용자 또는 관리자/DM/CRA)
    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      const siteUser = await c.env.DB.prepare(`
        SELECT id FROM site_users WHERE site_id = ? AND user_id = ?
      `).bind(siteId, user.userId).first();

      if (!siteUser) {
        return c.json({ success: false, error: '해당 Site에 접근 권한이 없습니다.' }, 403);
      }
    }

    let query = `SELECT * FROM subjects WHERE site_id = ?`;
    const params: (string | number)[] = [siteId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY subject_number LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const countQuery = status 
      ? `SELECT COUNT(*) as total FROM subjects WHERE site_id = ? AND status = ?`
      : `SELECT COUNT(*) as total FROM subjects WHERE site_id = ?`;

    const [subjectsResult, countResult] = await Promise.all([
      c.env.DB.prepare(query).bind(...params).all<Subject>(),
      c.env.DB.prepare(countQuery).bind(...(status ? [siteId, status] : [siteId])).first<{ total: number }>(),
    ]);

    return c.json({
      success: true,
      data: subjectsResult.results,
      pagination: {
        total: countResult?.total ?? 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Get subjects error:', error);
    return c.json({ success: false, error: 'Subject 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/subjects/:id
 * Subject 상세 조회
 */
subjects.get('/:id', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const subjectId = c.req.param('id');

    const subject = await c.env.DB.prepare(`
      SELECT s.*, si.site_number, si.name as site_name, si.study_id
      FROM subjects s
      JOIN sites si ON s.site_id = si.id
      WHERE s.id = ?
    `).bind(subjectId).first();

    if (!subject) {
      return c.json({ success: false, error: 'Subject를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkSubjectAccess(c.env.DB, user.userId, user.role, subjectId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Subject에 접근 권한이 없습니다.' }, 403);
    }

    // Visit 목록
    const visits = await c.env.DB.prepare(`
      SELECT v.*, vs.visit_name as schedule_name, vs.target_day
      FROM visits v
      LEFT JOIN visit_schedules vs ON v.visit_schedule_id = vs.id
      WHERE v.subject_id = ?
      ORDER BY v.visit_number
    `).bind(subjectId).all();

    // 각 Visit의 CRF 완료 상태
    const visitsWithCrf = await Promise.all(
      visits.results.map(async (visit: any) => {
        const crfStats = await c.env.DB.prepare(`
          SELECT status, COUNT(*) as count 
          FROM crf_instances WHERE visit_id = ?
          GROUP BY status
        `).bind(visit.id).all();
        
        return {
          ...visit,
          crfStats: crfStats.results,
        };
      })
    );

    return c.json({
      success: true,
      data: {
        ...subject,
        visits: visitsWithCrf,
      },
    });
  } catch (error) {
    console.error('Get subject error:', error);
    return c.json({ success: false, error: 'Subject 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/sites/:siteId/subjects
 * Subject 등록
 */
subjects.post('/', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const siteId = c.req.param('siteId');
    const body = await c.req.json();
    const { initials, screening_date, notes } = body;

    // Site 확인
    const site = await c.env.DB.prepare(`
      SELECT id, study_id, site_number, status FROM sites WHERE id = ?
    `).bind(siteId).first<{ id: string; study_id: string; site_number: string; status: string }>();

    if (!site) {
      return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
    }

    if (site.status !== 'ACTIVE') {
      return c.json({ success: false, error: '활성화되지 않은 Site에는 피험자를 등록할 수 없습니다.' }, 400);
    }

    // 권한 확인
    if (!['ADMIN', 'DM'].includes(user.role)) {
      const siteUser = await c.env.DB.prepare(`
        SELECT id FROM site_users WHERE site_id = ? AND user_id = ?
      `).bind(siteId, user.userId).first();

      if (!siteUser) {
        return c.json({ success: false, error: '해당 Site에 접근 권한이 없습니다.' }, 403);
      }
    }

    // Subject 번호 자동 생성 - 가장 큰 번호 기준으로 다음 번호 계산
    const maxSubject = await c.env.DB.prepare(`
      SELECT subject_number FROM subjects WHERE site_id = ?
      ORDER BY CAST(SUBSTR(subject_number, INSTR(subject_number, '-') + 1) AS INTEGER) DESC LIMIT 1
    `).bind(siteId).first<{ subject_number: string }>();

    let nextSeq = 1;
    if (maxSubject) {
      const parts = maxSubject.subject_number.split('-');
      nextSeq = parseInt(parts[parts.length - 1] || '0') + 1;
    }

    const subjectNumber = generateSubjectId(site.site_number, nextSeq);
    const screeningNumber = generateScreeningNumber('SCR', nextSeq);
    const subjectId = generateId('subj');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO subjects (
        id, site_id, subject_number, screening_number, initials, 
        status, screening_date, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'SCREENING', ?, ?, ?, ?, ?)
    `).bind(
      subjectId, siteId, subjectNumber, screeningNumber, initials ?? null,
      screening_date ?? timestamp.split('T')[0], notes ?? null, 
      user.userId, timestamp, timestamp
    ).run();

    // Visit Schedule에서 기본 Visit 생성
    const visitSchedules = await c.env.DB.prepare(`
      SELECT * FROM visit_schedules WHERE study_id = ? ORDER BY visit_number
    `).bind(site.study_id).all();

    for (const vs of visitSchedules.results as any[]) {
      const visitId = generateId('visit');
      await c.env.DB.prepare(`
        INSERT INTO visits (
          id, subject_id, visit_schedule_id, visit_name, visit_number, 
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)
      `).bind(
        visitId, subjectId, vs.id, vs.visit_name, vs.visit_number,
        timestamp, timestamp
      ).run();
    }

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: site.study_id,
      siteId,
      subjectId,
    }, {
      action: 'CREATE',
      tableName: 'subjects',
      recordId: subjectId,
    });

    const subject = await c.env.DB.prepare(`
      SELECT * FROM subjects WHERE id = ?
    `).bind(subjectId).first<Subject>();

    return c.json({
      success: true,
      data: subject,
    }, 201);
  } catch (error) {
    console.error('Create subject error:', error);
    return c.json({ success: false, error: 'Subject 등록 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/subjects/:id
 * Subject 수정
 */
subjects.put('/:id', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const subjectId = c.req.param('id');
    const body = await c.req.json();

    const existingSubject = await c.env.DB.prepare(`
      SELECT s.*, si.study_id FROM subjects s
      JOIN sites si ON s.site_id = si.id
      WHERE s.id = ?
    `).bind(subjectId).first<Subject & { study_id: string }>();

    if (!existingSubject) {
      return c.json({ success: false, error: 'Subject를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkSubjectAccess(c.env.DB, user.userId, user.role, subjectId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Subject에 접근 권한이 없습니다.' }, 403);
    }

    const { 
      initials, status, randomization_number, enrolled_date, 
      randomized_date, completed_date, notes, reason_for_change 
    } = body;

    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE subjects SET
        initials = COALESCE(?, initials),
        status = COALESCE(?, status),
        randomization_number = COALESCE(?, randomization_number),
        enrolled_date = COALESCE(?, enrolled_date),
        randomized_date = COALESCE(?, randomized_date),
        completed_date = COALESCE(?, completed_date),
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ?
    `).bind(
      initials ?? null, status ?? null, randomization_number ?? null,
      enrolled_date ?? null, randomized_date ?? null, completed_date ?? null,
      notes ?? null, timestamp, subjectId
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: existingSubject.study_id,
      siteId: existingSubject.site_id,
      subjectId,
    };

    const fieldsToCheck = ['initials', 'status', 'randomization_number', 'enrolled_date', 'randomized_date', 'completed_date', 'notes'];
    for (const field of fieldsToCheck) {
      const oldValue = (existingSubject as any)[field];
      const newValue = (body as any)[field];
      
      if (newValue !== undefined && newValue !== oldValue) {
        await createAuditLog(c.env.DB, auditContext, {
          action: 'UPDATE',
          tableName: 'subjects',
          recordId: subjectId,
          fieldName: field,
          oldValue: oldValue?.toString() ?? null,
          newValue: newValue?.toString() ?? null,
          reasonForChange: reason_for_change,
        });
      }
    }

    const updatedSubject = await c.env.DB.prepare(`
      SELECT * FROM subjects WHERE id = ?
    `).bind(subjectId).first<Subject>();

    return c.json({
      success: true,
      data: updatedSubject,
    });
  } catch (error) {
    console.error('Update subject error:', error);
    return c.json({ success: false, error: 'Subject 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/subjects/:id/withdraw
 * Subject 중도탈락 처리
 */
subjects.post('/:id/withdraw', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const subjectId = c.req.param('id');
    const body = await c.req.json();
    const { withdrawal_reason, withdrawal_initiated_by } = body;

    if (!withdrawal_reason) {
      return c.json({ success: false, error: '중도탈락 사유는 필수입니다.' }, 400);
    }

    const subject = await c.env.DB.prepare(`
      SELECT s.*, si.study_id FROM subjects s
      JOIN sites si ON s.site_id = si.id
      WHERE s.id = ?
    `).bind(subjectId).first<Subject & { study_id: string }>();

    if (!subject) {
      return c.json({ success: false, error: 'Subject를 찾을 수 없습니다.' }, 404);
    }

    if (['COMPLETED', 'WITHDRAWN', 'SCREEN_FAILED'].includes(subject.status)) {
      return c.json({ success: false, error: '이미 종료된 피험자입니다.' }, 400);
    }

    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE subjects SET
        status = 'WITHDRAWN',
        withdrawn_date = ?,
        withdrawal_reason = ?,
        withdrawal_initiated_by = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      timestamp.split('T')[0], withdrawal_reason, 
      withdrawal_initiated_by ?? 'INVESTIGATOR', timestamp, subjectId
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: subject.study_id,
      siteId: subject.site_id,
      subjectId,
    }, {
      action: 'UPDATE',
      tableName: 'subjects',
      recordId: subjectId,
      fieldName: 'status',
      oldValue: subject.status,
      newValue: 'WITHDRAWN',
      reasonForChange: withdrawal_reason,
    });

    return c.json({
      success: true,
      message: '피험자가 중도탈락 처리되었습니다.',
    });
  } catch (error) {
    console.error('Withdraw subject error:', error);
    return c.json({ success: false, error: '중도탈락 처리 중 오류가 발생했습니다.' }, 500);
  }
});

export default subjects;
