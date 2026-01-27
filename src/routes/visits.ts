// Visit & CRF Routes
// 방문 및 CRF 데이터 관련 API 라우트

import { Hono } from 'hono';
import type { Bindings, Variables, Visit, CRFInstance, CRFData } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, checkSubjectAccess } from '../middleware/rbac';
import { createAuditLog, createBulkAuditLogs, type AuditContext } from '../services/audit.service';
import { validateField } from '../services/validation.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const visits = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/subjects/:subjectId/visits
 * Subject의 Visit 목록 조회
 */
visits.get('/', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const subjectId = c.req.param('subjectId');

    // 접근 권한 확인
    const hasAccess = await checkSubjectAccess(c.env.DB, user.userId, user.role, subjectId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Subject에 접근 권한이 없습니다.' }, 403);
    }

    const visitsResult = await c.env.DB.prepare(`
      SELECT v.*, vs.target_day, vs.visit_window_before, vs.visit_window_after
      FROM visits v
      LEFT JOIN visit_schedules vs ON v.visit_schedule_id = vs.id
      WHERE v.subject_id = ?
      ORDER BY v.visit_number
    `).bind(subjectId).all();

    // 각 Visit의 CRF 상태 집계
    const visitsWithCrf = await Promise.all(
      visitsResult.results.map(async (visit: any) => {
        const crfInstances = await c.env.DB.prepare(`
          SELECT id, form_name, form_code, status, signed_at, locked_at
          FROM crf_instances WHERE visit_id = ?
          ORDER BY form_code
        `).bind(visit.id).all();

        const queryCount = await c.env.DB.prepare(`
          SELECT COUNT(*) as count FROM queries 
          WHERE crf_instance_id IN (SELECT id FROM crf_instances WHERE visit_id = ?)
          AND status = 'OPEN'
        `).bind(visit.id).first<{ count: number }>();

        return {
          ...visit,
          crfInstances: crfInstances.results,
          openQueryCount: queryCount?.count ?? 0,
        };
      })
    );

    return c.json({
      success: true,
      data: visitsWithCrf,
    });
  } catch (error) {
    console.error('Get visits error:', error);
    return c.json({ success: false, error: 'Visit 목록 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/visits/:id
 * Visit 상세 조회 (CRF 데이터 포함)
 */
visits.get('/:id', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const visitId = c.req.param('id');

    const visit = await c.env.DB.prepare(`
      SELECT v.*, s.subject_number, s.site_id, si.study_id
      FROM visits v
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE v.id = ?
    `).bind(visitId).first();

    if (!visit) {
      return c.json({ success: false, error: 'Visit를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkSubjectAccess(c.env.DB, user.userId, user.role, (visit as any).subject_id);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Visit에 접근 권한이 없습니다.' }, 403);
    }

    // CRF Instances
    const crfInstances = await c.env.DB.prepare(`
      SELECT * FROM crf_instances WHERE visit_id = ? ORDER BY form_code
    `).bind(visitId).all();

    // 각 CRF의 데이터
    const crfWithData = await Promise.all(
      crfInstances.results.map(async (crf: any) => {
        const crfData = await c.env.DB.prepare(`
          SELECT cd.*, fd.field_name, fd.field_type, fd.is_required, fd.options, fd.validation_rules
          FROM crf_data cd
          LEFT JOIN field_definitions fd ON cd.field_definition_id = fd.id
          WHERE cd.crf_instance_id = ?
          ORDER BY fd.field_order
        `).bind(crf.id).all();

        const queries = await c.env.DB.prepare(`
          SELECT * FROM queries WHERE crf_instance_id = ? ORDER BY created_at DESC
        `).bind(crf.id).all();

        return {
          ...crf,
          data: crfData.results,
          queries: queries.results,
        };
      })
    );

    // Form Definitions (아직 생성되지 않은 CRF용)
    const formDefinitions = await c.env.DB.prepare(`
      SELECT * FROM form_definitions 
      WHERE study_id = ? 
      AND (visit_schedule_id IS NULL OR visit_schedule_id = ?)
      ORDER BY form_order
    `).bind((visit as any).study_id, (visit as any).visit_schedule_id).all();

    return c.json({
      success: true,
      data: {
        ...visit,
        crfInstances: crfWithData,
        availableForms: formDefinitions.results,
      },
    });
  } catch (error) {
    console.error('Get visit error:', error);
    return c.json({ success: false, error: 'Visit 조회 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/subjects/:subjectId/visits
 * 새 Visit 생성
 */
visits.post('/', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const subjectId = c.req.param('subjectId');
    const body = await c.req.json();
    const { visit_schedule_id, visit_name, visit_number, scheduled_date, actual_date, notes } = body;

    if (!visit_name || visit_number === undefined) {
      return c.json({ success: false, error: 'visit_name과 visit_number는 필수입니다.' }, 400);
    }

    // Subject 확인
    const subject = await c.env.DB.prepare(`
      SELECT s.*, si.study_id FROM subjects s
      JOIN sites si ON s.site_id = si.id
      WHERE s.id = ?
    `).bind(subjectId).first<any>();

    if (!subject) {
      return c.json({ success: false, error: 'Subject를 찾을 수 없습니다.' }, 404);
    }

    // 접근 권한 확인
    const hasAccess = await checkSubjectAccess(c.env.DB, user.userId, user.role, subjectId);
    if (!hasAccess) {
      return c.json({ success: false, error: '해당 Subject에 접근 권한이 없습니다.' }, 403);
    }

    const visitId = generateId('visit');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO visits (
        id, subject_id, visit_schedule_id, visit_name, visit_number, 
        scheduled_date, actual_date, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?)
    `).bind(
      visitId, subjectId, visit_schedule_id ?? null, visit_name, visit_number,
      scheduled_date ?? null, actual_date ?? null, notes ?? null, timestamp, timestamp
    ).run();

    // Visit에 해당하는 CRF 인스턴스 생성 (visit_schedule이 있는 경우)
    if (visit_schedule_id) {
      const formDefs = await c.env.DB.prepare(`
        SELECT * FROM form_definitions 
        WHERE visit_schedule_id = ? OR (study_id = ? AND visit_schedule_id IS NULL)
        ORDER BY form_order
      `).bind(visit_schedule_id, subject.study_id).all();

      for (const form of formDefs.results as any[]) {
        const crfId = generateId('crf');
        await c.env.DB.prepare(`
          INSERT INTO crf_instances (
            id, visit_id, form_definition_id, form_name, form_code, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'NOT_STARTED', ?, ?)
        `).bind(crfId, visitId, form.id, form.form_name, form.form_code, timestamp, timestamp).run();
      }
    }

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
      action: 'CREATE',
      tableName: 'visits',
      recordId: visitId,
    });

    const newVisit = await c.env.DB.prepare(`SELECT * FROM visits WHERE id = ?`).bind(visitId).first();

    return c.json({ success: true, data: newVisit }, 201);
  } catch (error) {
    console.error('Create visit error:', error);
    return c.json({ success: false, error: 'Visit 생성 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * PUT /api/visits/:id
 * Visit 수정 (날짜, 상태 등)
 */
visits.put('/:id', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const visitId = c.req.param('id');
    const body = await c.req.json();

    const existingVisit = await c.env.DB.prepare(`
      SELECT v.*, s.site_id, si.study_id FROM visits v
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE v.id = ?
    `).bind(visitId).first<Visit & { site_id: string; study_id: string }>();

    if (!existingVisit) {
      return c.json({ success: false, error: 'Visit를 찾을 수 없습니다.' }, 404);
    }

    const { actual_date, status, not_done_reason, notes, reason_for_change } = body;
    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE visits SET
        actual_date = COALESCE(?, actual_date),
        status = COALESCE(?, status),
        not_done_reason = COALESCE(?, not_done_reason),
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ?
    `).bind(
      actual_date ?? null, status ?? null, not_done_reason ?? null, 
      notes ?? null, timestamp, visitId
    ).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: existingVisit.study_id,
      siteId: existingVisit.site_id,
      subjectId: existingVisit.subject_id,
    };

    const fieldsToCheck = ['actual_date', 'status', 'not_done_reason', 'notes'];
    for (const field of fieldsToCheck) {
      const oldValue = (existingVisit as any)[field];
      const newValue = (body as any)[field];
      
      if (newValue !== undefined && newValue !== oldValue) {
        await createAuditLog(c.env.DB, auditContext, {
          action: 'UPDATE',
          tableName: 'visits',
          recordId: visitId,
          fieldName: field,
          oldValue: oldValue?.toString() ?? null,
          newValue: newValue?.toString() ?? null,
          reasonForChange: reason_for_change,
        });
      }
    }

    const updatedVisit = await c.env.DB.prepare(`
      SELECT * FROM visits WHERE id = ?
    `).bind(visitId).first<Visit>();

    return c.json({
      success: true,
      data: updatedVisit,
    });
  } catch (error) {
    console.error('Update visit error:', error);
    return c.json({ success: false, error: 'Visit 수정 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/visits/:id/crf
 * CRF 데이터 저장
 */
visits.post('/:id/crf', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const visitId = c.req.param('id');
    const body = await c.req.json();
    const { form_code, data, reason_for_change } = body;

    if (!form_code || !data) {
      return c.json({ success: false, error: 'form_code와 data는 필수입니다.' }, 400);
    }

    // Visit 확인
    const visit = await c.env.DB.prepare(`
      SELECT v.*, s.site_id, si.study_id FROM visits v
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE v.id = ?
    `).bind(visitId).first<Visit & { site_id: string; study_id: string }>();

    if (!visit) {
      return c.json({ success: false, error: 'Visit를 찾을 수 없습니다.' }, 404);
    }

    // Form Definition 확인
    const formDef = await c.env.DB.prepare(`
      SELECT * FROM form_definitions WHERE study_id = ? AND form_code = ?
    `).bind(visit.study_id, form_code).first();

    if (!formDef) {
      return c.json({ success: false, error: '해당 CRF 폼을 찾을 수 없습니다.' }, 404);
    }

    // Field Definitions
    const fieldDefs = await c.env.DB.prepare(`
      SELECT * FROM field_definitions WHERE form_definition_id = ?
    `).bind((formDef as any).id).all();

    const timestamp = now();

    // CRF Instance 생성 또는 조회
    let crfInstance = await c.env.DB.prepare(`
      SELECT * FROM crf_instances WHERE visit_id = ? AND form_code = ?
    `).bind(visitId, form_code).first<CRFInstance>();

    const isNew = !crfInstance;

    if (!crfInstance) {
      const crfId = generateId('crf');
      await c.env.DB.prepare(`
        INSERT INTO crf_instances (
          id, visit_id, form_definition_id, form_name, form_code, status,
          data_entry_by, data_entry_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `).bind(
        crfId, visitId, (formDef as any).id, (formDef as any).form_name, form_code,
        user.userId, timestamp, timestamp, timestamp
      ).run();
      
      crfInstance = await c.env.DB.prepare(`
        SELECT * FROM crf_instances WHERE id = ?
      `).bind(crfId).first<CRFInstance>();
    }

    if (!crfInstance) {
      return c.json({ success: false, error: 'CRF 생성에 실패했습니다.' }, 500);
    }

    // 잠금 상태 확인
    if (crfInstance.status === 'LOCKED' || crfInstance.status === 'FROZEN') {
      return c.json({ success: false, error: '잠금된 CRF는 수정할 수 없습니다.' }, 400);
    }

    // Audit Context
    const { ipAddress, userAgent } = getClientInfo(c);
    const auditContext: AuditContext = {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: visit.study_id,
      siteId: visit.site_id,
      subjectId: visit.subject_id,
    };

    // 데이터 저장 및 검증
    const validationResults = [];

    for (const [fieldCode, fieldValue] of Object.entries(data)) {
      const fieldDef = fieldDefs.results.find((fd: any) => fd.field_code === fieldCode);
      
      // 기존 데이터 조회
      const existingData = await c.env.DB.prepare(`
        SELECT * FROM crf_data WHERE crf_instance_id = ? AND field_code = ?
      `).bind(crfInstance.id, fieldCode).first<CRFData>();

      // 검증
      let validationStatus = 'VALID';
      let validationMessage = null;
      
      if (fieldDef) {
        const validationResult = validateField(fieldDef as any, fieldValue as string);
        validationStatus = validationResult.status;
        validationMessage = validationResult.message;
        validationResults.push(validationResult);
      }

      if (existingData) {
        // 업데이트
        const oldValue = existingData.field_value;
        
        if (oldValue !== fieldValue) {
          await c.env.DB.prepare(`
            UPDATE crf_data SET
              field_value = ?,
              validation_status = ?,
              validation_message = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
            fieldValue as string ?? null, validationStatus, validationMessage,
            timestamp, existingData.id
          ).run();

          // Audit Log
          await createAuditLog(c.env.DB, auditContext, {
            action: 'UPDATE',
            tableName: 'crf_data',
            recordId: existingData.id,
            fieldName: fieldCode,
            oldValue: oldValue,
            newValue: fieldValue as string,
            reasonForChange: reason_for_change,
          });
        }
      } else {
        // 새로 생성
        const dataId = generateId('data');
        await c.env.DB.prepare(`
          INSERT INTO crf_data (
            id, crf_instance_id, field_definition_id, field_code, field_value,
            validation_status, validation_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          dataId, crfInstance.id, fieldDef ? (fieldDef as any).id : null, fieldCode,
          fieldValue as string ?? null, validationStatus, validationMessage,
          timestamp, timestamp
        ).run();

        // Audit Log
        await createAuditLog(c.env.DB, auditContext, {
          action: 'CREATE',
          tableName: 'crf_data',
          recordId: dataId,
          fieldName: fieldCode,
          newValue: fieldValue as string,
        });
      }
    }

    // CRF Instance 업데이트
    await c.env.DB.prepare(`
      UPDATE crf_instances SET
        data_entry_by = ?,
        data_entry_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(user.userId, timestamp, timestamp, crfInstance.id).run();

    // Visit 상태 업데이트
    if (visit.status === 'SCHEDULED') {
      await c.env.DB.prepare(`
        UPDATE visits SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?
      `).bind(timestamp, visitId).run();
    }

    // 응답
    const hasErrors = validationResults.some(r => r.status === 'ERROR');
    const hasWarnings = validationResults.some(r => r.status === 'WARNING');

    return c.json({
      success: true,
      data: {
        crfInstanceId: crfInstance.id,
        isNew,
        validationResults,
        hasErrors,
        hasWarnings,
      },
    });
  } catch (error) {
    console.error('Save CRF error:', error);
    return c.json({ success: false, error: 'CRF 저장 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/visits/:id/crf/:formCode/complete
 * CRF 완료 처리
 */
visits.post('/:id/crf/:formCode/complete', requireAuth, requirePermission('WRITE_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const visitId = c.req.param('id');
    const formCode = c.req.param('formCode');

    const crfInstance = await c.env.DB.prepare(`
      SELECT ci.*, v.subject_id, s.site_id, si.study_id
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE ci.visit_id = ? AND ci.form_code = ?
    `).bind(visitId, formCode).first<CRFInstance & { subject_id: string; site_id: string; study_id: string }>();

    if (!crfInstance) {
      return c.json({ success: false, error: 'CRF를 찾을 수 없습니다.' }, 404);
    }

    // 필수 필드 검증
    const requiredFields = await c.env.DB.prepare(`
      SELECT fd.field_code, fd.field_name FROM field_definitions fd
      WHERE fd.form_definition_id = ? AND fd.is_required = 1
    `).bind(crfInstance.form_definition_id).all();

    const crfData = await c.env.DB.prepare(`
      SELECT field_code, field_value FROM crf_data WHERE crf_instance_id = ?
    `).bind(crfInstance.id).all();

    const dataMap = new Map(crfData.results.map((d: any) => [d.field_code, d.field_value]));
    const missingFields = requiredFields.results.filter(
      (f: any) => !dataMap.has(f.field_code) || dataMap.get(f.field_code) === null || dataMap.get(f.field_code) === ''
    );

    if (missingFields.length > 0) {
      return c.json({
        success: false,
        error: '필수 필드가 누락되었습니다.',
        missingFields: missingFields.map((f: any) => f.field_name),
      }, 400);
    }

    // Error 상태 검증
    const errorFields = await c.env.DB.prepare(`
      SELECT field_code FROM crf_data 
      WHERE crf_instance_id = ? AND validation_status = 'ERROR'
    `).bind(crfInstance.id).all();

    if (errorFields.results.length > 0) {
      return c.json({
        success: false,
        error: '오류가 있는 필드를 수정해주세요.',
        errorFields: errorFields.results.map((f: any) => f.field_code),
      }, 400);
    }

    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE crf_instances SET status = 'COMPLETE', updated_at = ? WHERE id = ?
    `).bind(timestamp, crfInstance.id).run();

    // Audit Log
    const { ipAddress, userAgent } = getClientInfo(c);
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: crfInstance.study_id,
      siteId: crfInstance.site_id,
      subjectId: crfInstance.subject_id,
    }, {
      action: 'UPDATE',
      tableName: 'crf_instances',
      recordId: crfInstance.id,
      fieldName: 'status',
      oldValue: crfInstance.status,
      newValue: 'COMPLETE',
    });

    return c.json({
      success: true,
      message: 'CRF가 완료 처리되었습니다.',
    });
  } catch (error) {
    console.error('Complete CRF error:', error);
    return c.json({ success: false, error: 'CRF 완료 처리 중 오류가 발생했습니다.' }, 500);
  }
});

export default visits;
