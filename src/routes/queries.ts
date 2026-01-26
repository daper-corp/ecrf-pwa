// Query Management Routes
// 데이터 질의 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables, Query, QueryResponse } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, hasPermission } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now, addDays, formatDate } from '../utils/date';

const queries = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/queries
 * Query 목록 조회 (필터 지원)
 */
queries.get('/', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const status = c.req.query('status');
    const priority = c.req.query('priority');
    const studyId = c.req.query('studyId');
    const siteId = c.req.query('siteId');
    const subjectId = c.req.query('subjectId');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let query = `
      SELECT q.*, 
        ci.form_code, ci.form_name, ci.visit_id,
        v.visit_name, v.subject_id,
        s.subject_number, s.site_id,
        si.site_number, si.study_id,
        st.protocol_number,
        u.name as created_by_name
      FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      LEFT JOIN studies st ON si.study_id = st.id
      LEFT JOIN users u ON q.created_by = u.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (status) {
      query += ` AND q.status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND q.priority = ?`;
      params.push(priority);
    }

    if (studyId) {
      query += ` AND si.study_id = ?`;
      params.push(studyId);
    }

    if (siteId) {
      query += ` AND s.site_id = ?`;
      params.push(siteId);
    }

    if (subjectId) {
      query += ` AND v.subject_id = ?`;
      params.push(subjectId);
    }

    // 권한별 필터링
    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      query += ` AND s.site_id IN (SELECT site_id FROM site_users WHERE user_id = ?)`;
      params.push(user.userId);
    }

    query += ` ORDER BY 
      CASE q.priority WHEN 'CRITICAL' THEN 1 WHEN 'MAJOR' THEN 2 ELSE 3 END,
      q.created_at DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const queriesResult = await c.env.DB.prepare(query).bind(...params).all();

    // 총 개수
    let countQuery = `
      SELECT COUNT(*) as total FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      WHERE 1=1
    `;
    const countParams: (string | number)[] = [];

    if (status) {
      countQuery += ` AND q.status = ?`;
      countParams.push(status);
    }
    if (priority) {
      countQuery += ` AND q.priority = ?`;
      countParams.push(priority);
    }
    if (studyId) {
      countQuery += ` AND si.study_id = ?`;
      countParams.push(studyId);
    }
    if (siteId) {
      countQuery += ` AND s.site_id = ?`;
      countParams.push(siteId);
    }
    if (subjectId) {
      countQuery += ` AND v.subject_id = ?`;
      countParams.push(subjectId);
    }
    if (!['ADMIN', 'DM', 'CRA'].includes(user.role)) {
      countQuery += ` AND s.site_id IN (SELECT site_id FROM site_users WHERE user_id = ?)`;
      countParams.push(user.userId);
    }

    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();

    return c.json({
      success: true,
      data: queriesResult.results,
      pagination: {
        total: countResult?.total ?? 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Get queries error:', error);
    return c.json({ success: false, error: 'Query 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/queries/:id
 * Query 상세 조회 (응답 포함)
 */
queries.get('/:id', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const queryId = c.req.param('id');

    const query = await c.env.DB.prepare(`
      SELECT q.*, 
        ci.form_code, ci.form_name, ci.visit_id,
        v.visit_name, v.subject_id,
        s.subject_number, s.site_id,
        si.site_number, si.study_id,
        st.protocol_number,
        u.name as created_by_name
      FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      LEFT JOIN studies st ON si.study_id = st.id
      LEFT JOIN users u ON q.created_by = u.id
      WHERE q.id = ?
    `).bind(queryId).first();

    if (!query) {
      return c.json({ success: false, error: 'Query를 찾을 수 없습니다.' }, 404);
    }

    // 응답 목록
    const responses = await c.env.DB.prepare(`
      SELECT qr.*, u.name as responded_by_name, u.role as responded_by_role
      FROM query_responses qr
      JOIN users u ON qr.responded_by = u.id
      WHERE qr.query_id = ?
      ORDER BY qr.responded_at ASC
    `).bind(queryId).all();

    return c.json({
      success: true,
      data: {
        ...query,
        responses: responses.results,
      },
    });
  } catch (error) {
    console.error('Get query error:', error);
    return c.json({ success: false, error: 'Query 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/queries
 * Query 생성
 */
queries.post('/', requireAuth, requirePermission('CREATE_QUERY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const body = await c.req.json();
    const { 
      crf_instance_id, crf_data_id, field_code,
      priority = 'MINOR', category, query_text 
    } = body;

    if (!crf_instance_id || !query_text) {
      return c.json({ success: false, error: 'CRF Instance ID와 Query 내용은 필수입니다.' }, 400);
    }

    // CRF Instance 확인
    const crfInstance = await c.env.DB.prepare(`
      SELECT ci.*, v.subject_id, s.site_id, si.study_id
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE ci.id = ?
    `).bind(crf_instance_id).first();

    if (!crfInstance) {
      return c.json({ success: false, error: 'CRF를 찾을 수 없습니다.' }, 404);
    }

    // 마감일 계산
    const dueDays = priority === 'CRITICAL' ? 1 : priority === 'MAJOR' ? 3 : 7;
    const dueDate = formatDate(addDays(new Date(), dueDays));

    const queryId = generateId('qry');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO queries (
        id, crf_instance_id, crf_data_id, field_code,
        status, priority, category, query_text,
        created_by, created_at, due_date
      ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)
    `).bind(
      queryId, crf_instance_id, crf_data_id ?? null, field_code ?? null,
      priority, category ?? null, query_text,
      user.userId, timestamp, dueDate
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: (crfInstance as any).study_id,
      siteId: (crfInstance as any).site_id,
      subjectId: (crfInstance as any).subject_id,
    }, {
      action: 'QUERY_OPEN',
      tableName: 'queries',
      recordId: queryId,
      newValue: query_text,
    });

    const createdQuery = await c.env.DB.prepare(`
      SELECT * FROM queries WHERE id = ?
    `).bind(queryId).first<Query>();

    return c.json({
      success: true,
      data: createdQuery,
    }, 201);
  } catch (error) {
    console.error('Create query error:', error);
    return c.json({ success: false, error: 'Query 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/queries/:id/answer
 * Query 답변
 */
queries.post('/:id/answer', requireAuth, requirePermission('ANSWER_QUERY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const queryId = c.req.param('id');
    const body = await c.req.json();
    const { response_text } = body;

    if (!response_text) {
      return c.json({ success: false, error: '답변 내용은 필수입니다.' }, 400);
    }

    const query = await c.env.DB.prepare(`
      SELECT q.*, ci.visit_id, v.subject_id, s.site_id, si.study_id
      FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      WHERE q.id = ?
    `).bind(queryId).first<Query & { subject_id: string; site_id: string; study_id: string }>();

    if (!query) {
      return c.json({ success: false, error: 'Query를 찾을 수 없습니다.' }, 404);
    }

    if (query.status === 'CLOSED' || query.status === 'CANCELLED') {
      return c.json({ success: false, error: '종료된 Query에는 답변할 수 없습니다.' }, 400);
    }

    const responseId = generateId('qres');
    const timestamp = now();

    // 응답 저장
    await c.env.DB.prepare(`
      INSERT INTO query_responses (id, query_id, response_text, response_type, responded_by, responded_at)
      VALUES (?, ?, ?, 'ANSWER', ?, ?)
    `).bind(responseId, queryId, response_text, user.userId, timestamp).run();

    // Query 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE queries SET status = 'ANSWERED' WHERE id = ?
    `).bind(queryId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: query.study_id,
      siteId: query.site_id,
      subjectId: query.subject_id,
    }, {
      action: 'QUERY_ANSWER',
      tableName: 'queries',
      recordId: queryId,
      oldValue: query.status,
      newValue: 'ANSWERED',
    });

    return c.json({
      success: true,
      message: 'Query에 답변이 등록되었습니다.',
    });
  } catch (error) {
    console.error('Answer query error:', error);
    return c.json({ success: false, error: 'Query 답변 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/queries/:id/close
 * Query 종료
 */
queries.post('/:id/close', requireAuth, requirePermission('CLOSE_QUERY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const queryId = c.req.param('id');
    const body = await c.req.json();
    const { close_reason } = body;

    const query = await c.env.DB.prepare(`
      SELECT q.*, ci.visit_id, v.subject_id, s.site_id, si.study_id
      FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      WHERE q.id = ?
    `).bind(queryId).first<Query & { subject_id: string; site_id: string; study_id: string }>();

    if (!query) {
      return c.json({ success: false, error: 'Query를 찾을 수 없습니다.' }, 404);
    }

    if (query.status === 'CLOSED') {
      return c.json({ success: false, error: '이미 종료된 Query입니다.' }, 400);
    }

    const timestamp = now();

    // 종료 응답 저장
    if (close_reason) {
      const responseId = generateId('qres');
      await c.env.DB.prepare(`
        INSERT INTO query_responses (id, query_id, response_text, response_type, responded_by, responded_at)
        VALUES (?, ?, ?, 'CLOSE', ?, ?)
      `).bind(responseId, queryId, close_reason, user.userId, timestamp).run();
    }

    // Query 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE queries SET status = 'CLOSED' WHERE id = ?
    `).bind(queryId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: query.study_id,
      siteId: query.site_id,
      subjectId: query.subject_id,
    }, {
      action: 'QUERY_CLOSE',
      tableName: 'queries',
      recordId: queryId,
      oldValue: query.status,
      newValue: 'CLOSED',
      reasonForChange: close_reason,
    });

    return c.json({
      success: true,
      message: 'Query가 종료되었습니다.',
    });
  } catch (error) {
    console.error('Close query error:', error);
    return c.json({ success: false, error: 'Query 종료 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/queries/:id/cancel
 * Query 취소
 */
queries.post('/:id/cancel', requireAuth, requirePermission('CREATE_QUERY'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const queryId = c.req.param('id');
    const body = await c.req.json();
    const { cancel_reason } = body;

    if (!cancel_reason) {
      return c.json({ success: false, error: '취소 사유는 필수입니다.' }, 400);
    }

    const query = await c.env.DB.prepare(`
      SELECT q.*, ci.visit_id, v.subject_id, s.site_id, si.study_id
      FROM queries q
      LEFT JOIN crf_instances ci ON q.crf_instance_id = ci.id
      LEFT JOIN visits v ON ci.visit_id = v.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites si ON s.site_id = si.id
      WHERE q.id = ?
    `).bind(queryId).first<Query & { subject_id: string; site_id: string; study_id: string }>();

    if (!query) {
      return c.json({ success: false, error: 'Query를 찾을 수 없습니다.' }, 404);
    }

    // 본인이 생성한 Query만 취소 가능 (ADMIN, DM 제외)
    if (query.created_by !== user.userId && !['ADMIN', 'DM'].includes(user.role)) {
      return c.json({ success: false, error: '본인이 생성한 Query만 취소할 수 있습니다.' }, 403);
    }

    if (query.status === 'CLOSED' || query.status === 'CANCELLED') {
      return c.json({ success: false, error: '이미 종료된 Query입니다.' }, 400);
    }

    const timestamp = now();

    // 취소 응답 저장
    const responseId = generateId('qres');
    await c.env.DB.prepare(`
      INSERT INTO query_responses (id, query_id, response_text, response_type, responded_by, responded_at)
      VALUES (?, ?, ?, 'CANCEL', ?, ?)
    `).bind(responseId, queryId, cancel_reason, user.userId, timestamp).run();

    // Query 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE queries SET status = 'CANCELLED' WHERE id = ?
    `).bind(queryId).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: query.study_id,
      siteId: query.site_id,
      subjectId: query.subject_id,
    }, {
      action: 'UPDATE',
      tableName: 'queries',
      recordId: queryId,
      fieldName: 'status',
      oldValue: query.status,
      newValue: 'CANCELLED',
      reasonForChange: cancel_reason,
    });

    return c.json({
      success: true,
      message: 'Query가 취소되었습니다.',
    });
  } catch (error) {
    console.error('Cancel query error:', error);
    return c.json({ success: false, error: 'Query 취소 중 오류가 발생했습니다.' }, 500);
  }
});

export default queries;
