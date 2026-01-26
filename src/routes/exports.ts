// Data Export Routes
// CSV/Excel 데이터 내보내기 API
// Created: 2026-01-26

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';
import { requireRole, hasPermission } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * CSV 문자열 이스케이프
 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 배열을 CSV 문자열로 변환
 */
function toCSV(headers: string[], rows: any[][]): string {
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map(row => row.map(escapeCSV).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * JSON 데이터를 플랫 형식으로 변환
 */
function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const flattened: Record<string, any> = {};
  
  for (const key in obj) {
    const newKey = prefix ? `${prefix}_${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(flattened, flattenObject(obj[key], newKey));
    } else {
      flattened[newKey] = obj[key];
    }
  }
  
  return flattened;
}

// =====================================================
// EXPORT ENDPOINTS
// =====================================================

// GET /api/exports/subjects - Subject 데이터 내보내기
app.get('/subjects', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { study_id, site_id, status, format = 'csv' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Subject 데이터 조회
    let query = `
      SELECT 
        s.id,
        s.subject_number,
        s.screening_number,
        s.status,
        s.randomization_number,
        s.randomized_date,
        s.screening_date,
        s.enrolled_date,
        s.withdrawn_date,
        s.withdrawal_reason,
        s.created_at,
        s.updated_at,
        site.site_number,
        site.name as site_name,
        study.protocol_number
      FROM subjects s
      JOIN sites site ON s.site_id = site.id
      JOIN studies study ON site.study_id = study.id
      WHERE study.id = ?
    `;
    const params: any[] = [study_id];

    if (site_id) {
      query += ' AND s.site_id = ?';
      params.push(site_id);
    }

    if (status) {
      query += ' AND s.status = ?';
      params.push(status);
    }

    query += ' ORDER BY site.site_number, s.subject_number';

    const subjects = await c.env.DB.prepare(query).bind(...params).all();

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'subjects',
      recordId: 'bulk',
      newValue: JSON.stringify({ count: subjects.results?.length || 0, format, filters: { study_id, site_id, status } })
    });

    if (format === 'json') {
      return c.json({
        export_date: now(),
        study_id,
        total_records: subjects.results?.length || 0,
        data: subjects.results
      });
    }

    // CSV 형식
    const headers = [
      'Subject Number', 'Screening Number', 'Status', 'Randomization Number',
      'Randomization Date', 'Screening Date', 'Enrollment Date',
      'Withdrawal Date', 'Withdrawal Reason', 'Site Number', 'Site Name',
      'Protocol Number', 'Created At', 'Updated At'
    ];

    const rows = (subjects.results as any[]).map(s => [
      s.subject_number, s.screening_number, s.status, s.randomization_number,
      s.randomized_date, s.screening_date, s.enrolled_date,
      s.withdrawn_date, s.withdrawal_reason, s.site_number, s.site_name,
      s.protocol_number, s.created_at, s.updated_at
    ]);

    const csv = toCSV(headers, rows);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="subjects_${study_id}_${now().split('T')[0]}.csv"`
      }
    });
  } catch (error: any) {
    console.error('Export subjects error:', error);
    return c.json({ error: '데이터 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/exports/crf-data - CRF 데이터 내보내기
app.get('/crf-data', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { study_id, site_id, subject_id, form_code, format = 'csv' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // CRF 데이터 조회 (pivot 형태)
    let query = `
      SELECT 
        s.subject_number,
        v.visit_name,
        v.visit_number,
        v.actual_date as visit_date,
        ci.form_code,
        ci.status as crf_status,
        cd.field_code,
        cd.field_value,
        cd.updated_at as data_updated_at,
        site.site_number
      FROM crf_data cd
      JOIN crf_instances ci ON cd.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `;
    const params: any[] = [study_id];

    if (site_id) {
      query += ' AND site.id = ?';
      params.push(site_id);
    }

    if (subject_id) {
      query += ' AND s.id = ?';
      params.push(subject_id);
    }

    if (form_code) {
      query += ' AND ci.form_code = ?';
      params.push(form_code);
    }

    query += ' ORDER BY s.subject_number, v.visit_number, ci.form_code, cd.field_code';

    const crfData = await c.env.DB.prepare(query).bind(...params).all();

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'crf_data',
      recordId: 'bulk',
      newValue: JSON.stringify({ count: crfData.results?.length || 0, format, filters: { study_id, site_id, subject_id, form_code } })
    });

    if (format === 'json') {
      return c.json({
        export_date: now(),
        study_id,
        total_records: crfData.results?.length || 0,
        data: crfData.results
      });
    }

    // CSV 형식 (Long format)
    const headers = [
      'Site Number', 'Subject Number', 'Visit Number', 'Visit Name', 'Visit Date',
      'Form Code', 'CRF Status', 'Field Code', 'Field Value', 'Data Updated At'
    ];

    const rows = (crfData.results as any[]).map(r => [
      r.site_number, r.subject_number, r.visit_number, r.visit_name, r.visit_date,
      r.form_code, r.crf_status, r.field_code, r.field_value, r.data_updated_at
    ]);

    const csv = toCSV(headers, rows);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="crf_data_${study_id}_${now().split('T')[0]}.csv"`
      }
    });
  } catch (error: any) {
    console.error('Export CRF data error:', error);
    return c.json({ error: '데이터 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/exports/crf-wide - CRF 데이터 (Wide format)
app.get('/crf-wide', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { study_id, form_code, format = 'csv' } = c.req.query();

    if (!study_id || !form_code) {
      return c.json({ error: 'study_id와 form_code가 필요합니다.' }, 400);
    }

    // 해당 Form의 필드 정의 조회
    const fieldDefs = await c.env.DB.prepare(`
      SELECT field_code, field_name, field_order
      FROM field_definitions
      WHERE form_definition_id IN (
        SELECT id FROM form_definitions WHERE study_id = ? AND form_code = ?
      )
      ORDER BY field_order
    `).bind(study_id, form_code).all();

    const fieldCodes = (fieldDefs.results as any[]).map(f => f.field_code);
    const fieldLabels = (fieldDefs.results as any[]).map(f => f.field_name || f.field_code);

    // CRF 인스턴스별로 데이터 조회
    const instances = await c.env.DB.prepare(`
      SELECT 
        ci.id as crf_instance_id,
        s.subject_number,
        v.visit_name,
        v.visit_number,
        v.actual_date as visit_date,
        ci.status as crf_status,
        site.site_number
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ? AND ci.form_code = ?
      ORDER BY site.site_number, s.subject_number, v.visit_number
    `).bind(study_id, form_code).all();

    // 각 인스턴스의 데이터 조회 및 Wide format으로 변환
    const wideData: any[] = [];
    for (const inst of instances.results as any[]) {
      const data = await c.env.DB.prepare(`
        SELECT field_code, field_value
        FROM crf_data
        WHERE crf_instance_id = ?
      `).bind(inst.crf_instance_id).all();

      const dataMap: Record<string, string> = {};
      for (const d of data.results as any[]) {
        dataMap[d.field_code] = d.field_value;
      }

      const row: any = {
        site_number: inst.site_number,
        subject_number: inst.subject_number,
        visit_number: inst.visit_number,
        visit_name: inst.visit_name,
        visit_date: inst.visit_date,
        crf_status: inst.crf_status
      };

      for (const fieldCode of fieldCodes) {
        row[fieldCode] = dataMap[fieldCode] || '';
      }

      wideData.push(row);
    }

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'crf_data',
      recordId: 'bulk_wide',
      newValue: JSON.stringify({ count: wideData.length, format, form_code })
    });

    if (format === 'json') {
      return c.json({
        export_date: now(),
        study_id,
        form_code,
        total_records: wideData.length,
        fields: fieldLabels,
        data: wideData
      });
    }

    // CSV 형식
    const headers = ['Site Number', 'Subject Number', 'Visit Number', 'Visit Name', 'Visit Date', 'CRF Status', ...fieldLabels];
    const rows = wideData.map(row => [
      row.site_number,
      row.subject_number,
      row.visit_number,
      row.visit_name,
      row.visit_date,
      row.crf_status,
      ...fieldCodes.map(fc => row[fc])
    ]);

    const csv = toCSV(headers, rows);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${form_code}_${study_id}_${now().split('T')[0]}.csv"`
      }
    });
  } catch (error: any) {
    console.error('Export CRF wide error:', error);
    return c.json({ error: '데이터 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/exports/queries - Query 데이터 내보내기
app.get('/queries', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { study_id, status, format = 'csv' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Query 데이터 조회
    const queries = await c.env.DB.prepare(`
      SELECT 
        q.id,
        q.field_code,
        q.status,
        q.priority,
        q.category,
        q.query_text,
        q.created_at,
        q.due_date,
        s.subject_number,
        v.visit_name,
        ci.form_code,
        site.site_number,
        creator.name as created_by_name,
        creator.role as created_by_role
      FROM queries q
      JOIN crf_instances ci ON q.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      JOIN users creator ON q.created_by = creator.id
      WHERE site.study_id = ?
      ${status ? 'AND q.status = ?' : ''}
      ORDER BY q.created_at DESC
    `).bind(...(status ? [study_id, status] : [study_id])).all();

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'queries',
      recordId: 'bulk',
      newValue: JSON.stringify({ count: queries.results?.length || 0, format, status })
    });

    if (format === 'json') {
      return c.json({
        export_date: now(),
        study_id,
        total_records: queries.results?.length || 0,
        data: queries.results
      });
    }

    // CSV 형식
    const headers = [
      'Query ID', 'Site Number', 'Subject Number', 'Visit Name', 'Form Code',
      'Field Code', 'Status', 'Priority', 'Category', 'Query Text',
      'Created By', 'Created At', 'Due Date'
    ];

    const rows = (queries.results as any[]).map(q => [
      q.id, q.site_number, q.subject_number, q.visit_name, q.form_code,
      q.field_code, q.status, q.priority, q.category, q.query_text,
      `${q.created_by_name} (${q.created_by_role})`, q.created_at, q.due_date
    ]);

    const csv = toCSV(headers, rows);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="queries_${study_id}_${now().split('T')[0]}.csv"`
      }
    });
  } catch (error: any) {
    console.error('Export queries error:', error);
    return c.json({ error: '데이터 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/exports/audit-trail - Audit Trail 내보내기
app.get('/audit-trail', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    const { study_id, start_date, end_date, format = 'csv' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    let query = `
      SELECT 
        id, user_id, user_name, user_role, timestamp,
        action, table_name, record_id, field_name,
        old_value, new_value, reason_for_change,
        ip_address, session_id
      FROM audit_logs
      WHERE study_id = ?
    `;
    const params: any[] = [study_id];

    if (start_date) {
      query += ' AND timestamp >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND timestamp <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY timestamp DESC LIMIT 10000';

    const auditLogs = await c.env.DB.prepare(query).bind(...params).all();

    // 감사 로그 (이 내보내기 작업 자체 기록)
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'audit_logs',
      recordId: 'bulk',
      newValue: JSON.stringify({ count: auditLogs.results?.length || 0, format, start_date, end_date })
    });

    if (format === 'json') {
      return c.json({
        export_date: now(),
        study_id,
        total_records: auditLogs.results?.length || 0,
        data: auditLogs.results
      });
    }

    // CSV 형식
    const headers = [
      'ID', 'Timestamp', 'User Name', 'User Role', 'Action',
      'Table Name', 'Record ID', 'Field Name', 'Old Value', 'New Value',
      'Reason', 'IP Address', 'Session ID'
    ];

    const rows = (auditLogs.results as any[]).map(a => [
      a.id, a.timestamp, a.user_name, a.user_role, a.action,
      a.table_name, a.record_id, a.field_name, a.old_value, a.new_value,
      a.reason_for_change, a.ip_address, a.session_id
    ]);

    const csv = toCSV(headers, rows);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit_trail_${study_id}_${now().split('T')[0]}.csv"`
      }
    });
  } catch (error: any) {
    console.error('Export audit trail error:', error);
    return c.json({ error: '데이터 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/exports/summary - 내보내기 가능한 데이터 요약
app.get('/summary', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // 각 테이블의 레코드 수 조회
    const subjectCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM subjects s
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first<{ count: number }>();

    const visitCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM visits v
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first<{ count: number }>();

    const crfCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first<{ count: number }>();

    const crfDataCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM crf_data cd
      JOIN crf_instances ci ON cd.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first<{ count: number }>();

    const queryCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM queries q
      JOIN crf_instances ci ON q.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first<{ count: number }>();

    const auditCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM audit_logs WHERE study_id = ?
    `).bind(study_id).first<{ count: number }>();

    // 사용 가능한 Form 목록
    const forms = await c.env.DB.prepare(`
      SELECT DISTINCT form_code, form_name FROM form_definitions WHERE study_id = ?
    `).bind(study_id).all();

    return c.json({
      study_id,
      available_exports: [
        { type: 'subjects', description: 'Subject 등록 데이터', record_count: subjectCount?.count || 0 },
        { type: 'crf-data', description: 'CRF 데이터 (Long format)', record_count: crfDataCount?.count || 0 },
        { type: 'crf-wide', description: 'CRF 데이터 (Wide format by Form)', forms: forms.results || [] },
        { type: 'queries', description: 'Query 데이터', record_count: queryCount?.count || 0 },
        { type: 'audit-trail', description: 'Audit Trail', record_count: auditCount?.count || 0 }
      ],
      totals: {
        subjects: subjectCount?.count || 0,
        visits: visitCount?.count || 0,
        crf_instances: crfCount?.count || 0,
        crf_data_points: crfDataCount?.count || 0,
        queries: queryCount?.count || 0,
        audit_records: auditCount?.count || 0
      }
    });
  } catch (error: any) {
    console.error('Export summary error:', error);
    return c.json({ error: '요약 조회 실패', details: error?.message }, 500);
  }
});

export default app;
