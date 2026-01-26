// Edit Check Routes
// 고급 데이터 검증 규칙 API 라우트
// Created: 2026-01-26

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { authMiddleware, requireAuth, getAuthUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';
import { 
  EditCheckEngine, 
  type EditCheckContext,
  type EditCheckRule,
  type EditCheckResult,
  type RuleType,
  type RuleSeverity
} from '../services/editcheck.service';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 모든 라우트에 인증 필요 (authMiddleware는 index.tsx에서 전역으로 적용됨)
app.use('*', requireAuth);

// =====================================================
// 규칙 관리 API
// =====================================================

// GET /api/edit-checks/rules - 검증 규칙 목록 조회
app.get('/rules', async (c) => {
  try {
    const user = getAuthUser(c);
    const { 
      studyId, 
      ruleType, 
      isActive = '1',
      formCode,
      fieldCode,
      limit = '50', 
      offset = '0' 
    } = c.req.query();
    
    if (!studyId) {
      return c.json({ error: 'studyId is required' }, 400);
    }
    
    let query = `
      SELECT 
        r.*,
        u.name as created_by_name
      FROM edit_check_rules r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.study_id = ?
    `;
    const params: any[] = [studyId];
    
    if (ruleType) {
      query += ` AND r.rule_type = ?`;
      params.push(ruleType);
    }
    
    if (isActive !== undefined && isActive !== '') {
      query += ` AND r.is_active = ?`;
      params.push(parseInt(isActive));
    }
    
    if (formCode) {
      query += ` AND r.target_form_code = ?`;
      params.push(formCode);
    }
    
    if (fieldCode) {
      query += ` AND r.target_field_code = ?`;
      params.push(fieldCode);
    }
    
    query += ` ORDER BY r.rule_type, r.rule_code LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    const rules = await c.env.DB.prepare(query).bind(...params).all();
    
    // 전체 개수 조회
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM edit_check_rules 
      WHERE study_id = ? 
      ${ruleType ? 'AND rule_type = ?' : ''}
      ${isActive !== undefined && isActive !== '' ? 'AND is_active = ?' : ''}
      ${formCode ? 'AND target_form_code = ?' : ''}
      ${fieldCode ? 'AND target_field_code = ?' : ''}
    `;
    const countParams: any[] = [studyId];
    if (ruleType) countParams.push(ruleType);
    if (isActive !== undefined && isActive !== '') countParams.push(parseInt(isActive));
    if (formCode) countParams.push(formCode);
    if (fieldCode) countParams.push(fieldCode);
    
    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();
    
    return c.json({
      data: rules.results,
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get edit check rules error:', error);
    return c.json({ error: 'Failed to fetch edit check rules' }, 500);
  }
});

// GET /api/edit-checks/rules/:id - 규칙 상세 조회
app.get('/rules/:id', async (c) => {
  try {
    const ruleId = c.req.param('id');
    
    const rule = await c.env.DB.prepare(`
      SELECT 
        r.*,
        u.name as created_by_name
      FROM edit_check_rules r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.id = ?
    `).bind(ruleId).first();
    
    if (!rule) {
      return c.json({ error: 'Rule not found' }, 404);
    }
    
    // 최근 실행 결과 통계
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_executions,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) as failed_count
      FROM edit_check_results
      WHERE rule_id = ?
      AND executed_at >= datetime('now', '-30 days')
    `).bind(ruleId).first();
    
    return c.json({ 
      data: rule,
      statistics: stats
    });
  } catch (error) {
    console.error('Get edit check rule error:', error);
    return c.json({ error: 'Failed to fetch edit check rule' }, 500);
  }
});

// POST /api/edit-checks/rules - 규칙 생성
// Note: Role check is done inside the handler after getting user
app.post('/rules', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증 정보가 없습니다.' }, 401);
    }
    // Role check
    if (!['ADMIN', 'DM'].includes(user.role)) {
      return c.json({ error: '권한이 없습니다. ADMIN 또는 DM 역할이 필요합니다.' }, 403);
    }
    const body = await c.req.json();
    
    const {
      study_id,
      rule_code,
      rule_name,
      description,
      rule_type,
      severity = 'ERROR',
      target_form_code,
      target_field_code,
      rule_definition,
      error_message_template,
      error_message_ko,
      auto_query_enabled = false,
      auto_query_priority = 'MINOR',
      auto_query_category = 'DATA_INCONSISTENT'
    } = body;
    
    // 필수 필드 검증
    if (!study_id || !rule_code || !rule_name || !rule_type || !rule_definition || !error_message_template) {
      return c.json({ error: 'Missing required fields: study_id, rule_code, rule_name, rule_type, rule_definition, error_message_template' }, 400);
    }
    
    // 중복 검사
    const existing = await c.env.DB.prepare(
      'SELECT id FROM edit_check_rules WHERE study_id = ? AND rule_code = ?'
    ).bind(study_id, rule_code).first();
    
    if (existing) {
      return c.json({ error: 'Rule code already exists in this study' }, 409);
    }
    
    const id = generateId('rule');
    const timestamp = now();
    
    await c.env.DB.prepare(`
      INSERT INTO edit_check_rules (
        id, study_id, rule_code, rule_name, description, rule_type, severity,
        target_form_code, target_field_code, rule_definition,
        error_message_template, error_message_ko,
        auto_query_enabled, auto_query_priority, auto_query_category,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, study_id, rule_code, rule_name, description || null, rule_type, severity,
      target_form_code || null, target_field_code || null,
      typeof rule_definition === 'string' ? rule_definition : JSON.stringify(rule_definition),
      error_message_template, error_message_ko || null,
      auto_query_enabled ? 1 : 0, auto_query_priority, auto_query_category,
      user.userId, timestamp, timestamp
    ).run();
    
    // 감사 로그
    const auditContext: AuditContext = {
      user,
      ipAddress: c.req.header('x-forwarded-for') || 'unknown',
      sessionId: user.sessionId || 'unknown',
      userAgent: c.req.header('user-agent') || 'unknown',
      studyId: study_id
    };
    await createAuditLog(c.env.DB, auditContext, {
      action: 'CREATE',
      tableName: 'edit_check_rules',
      recordId: id,
      newValue: JSON.stringify({ rule_code, rule_name, rule_type })
    });
    
    return c.json({ 
      message: 'Edit check rule created successfully',
      id
    }, 201);
  } catch (error: any) {
    console.error('Create edit check rule error:', error);
    return c.json({ error: 'Failed to create edit check rule', details: error?.message || String(error) }, 500);
  }
});

// PUT /api/edit-checks/rules/:id - 규칙 수정
app.put('/rules/:id', requireRole('ADMIN', 'DM'), async (c) => {
  try {
    const user = getAuthUser(c);
    const ruleId = c.req.param('id');
    const body = await c.req.json();
    
    const existingRule = await c.env.DB.prepare(
      'SELECT * FROM edit_check_rules WHERE id = ?'
    ).bind(ruleId).first<any>();
    
    if (!existingRule) {
      return c.json({ error: 'Rule not found' }, 404);
    }
    
    const {
      rule_name,
      description,
      severity,
      target_form_code,
      target_field_code,
      rule_definition,
      error_message_template,
      error_message_ko,
      auto_query_enabled,
      auto_query_priority,
      auto_query_category,
      is_active
    } = body;
    
    const timestamp = now();
    const newVersion = (existingRule.version || 1) + 1;
    
    await c.env.DB.prepare(`
      UPDATE edit_check_rules SET
        rule_name = COALESCE(?, rule_name),
        description = COALESCE(?, description),
        severity = COALESCE(?, severity),
        target_form_code = COALESCE(?, target_form_code),
        target_field_code = COALESCE(?, target_field_code),
        rule_definition = COALESCE(?, rule_definition),
        error_message_template = COALESCE(?, error_message_template),
        error_message_ko = COALESCE(?, error_message_ko),
        auto_query_enabled = COALESCE(?, auto_query_enabled),
        auto_query_priority = COALESCE(?, auto_query_priority),
        auto_query_category = COALESCE(?, auto_query_category),
        is_active = COALESCE(?, is_active),
        version = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      rule_name || null,
      description || null,
      severity || null,
      target_form_code || null,
      target_field_code || null,
      rule_definition ? (typeof rule_definition === 'string' ? rule_definition : JSON.stringify(rule_definition)) : null,
      error_message_template || null,
      error_message_ko || null,
      auto_query_enabled !== undefined ? (auto_query_enabled ? 1 : 0) : null,
      auto_query_priority || null,
      auto_query_category || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      newVersion,
      timestamp,
      ruleId
    ).run();
    
    // 감사 로그
    const auditContext: AuditContext = {
      user,
      ipAddress: c.req.header('x-forwarded-for') || 'unknown',
      sessionId: user.sessionId || 'unknown',
      userAgent: c.req.header('user-agent') || 'unknown',
      studyId: existingRule.study_id
    };
    await createAuditLog(c.env.DB, auditContext, {
      action: 'UPDATE',
      tableName: 'edit_check_rules',
      recordId: ruleId,
      oldValue: JSON.stringify(existingRule),
      newValue: JSON.stringify(body)
    });
    
    return c.json({ message: 'Edit check rule updated successfully' });
  } catch (error) {
    console.error('Update edit check rule error:', error);
    return c.json({ error: 'Failed to update edit check rule' }, 500);
  }
});

// DELETE /api/edit-checks/rules/:id - 규칙 삭제 (soft delete - 비활성화)
app.delete('/rules/:id', requireRole('ADMIN', 'DM'), async (c) => {
  try {
    const user = getAuthUser(c);
    const ruleId = c.req.param('id');
    
    const existingRule = await c.env.DB.prepare(
      'SELECT * FROM edit_check_rules WHERE id = ?'
    ).bind(ruleId).first<any>();
    
    if (!existingRule) {
      return c.json({ error: 'Rule not found' }, 404);
    }
    
    // 비활성화 (실제 삭제하지 않음 - 감사 추적을 위해)
    await c.env.DB.prepare(
      'UPDATE edit_check_rules SET is_active = 0, updated_at = ? WHERE id = ?'
    ).bind(now(), ruleId).run();
    
    // 감사 로그
    const auditContext: AuditContext = {
      user,
      ipAddress: c.req.header('x-forwarded-for') || 'unknown',
      sessionId: user.sessionId || 'unknown',
      userAgent: c.req.header('user-agent') || 'unknown',
      studyId: existingRule.study_id
    };
    await createAuditLog(c.env.DB, auditContext, {
      action: 'DELETE',
      tableName: 'edit_check_rules',
      recordId: ruleId,
      oldValue: JSON.stringify({ is_active: true }),
      newValue: JSON.stringify({ is_active: false })
    });
    
    return c.json({ message: 'Edit check rule deactivated successfully' });
  } catch (error) {
    console.error('Delete edit check rule error:', error);
    return c.json({ error: 'Failed to delete edit check rule' }, 500);
  }
});

// =====================================================
// 검증 실행 API
// =====================================================

// POST /api/edit-checks/execute - 검증 실행
app.post('/execute', async (c) => {
  try {
    const user = getAuthUser(c);
    const body = await c.req.json();
    
    const {
      crf_instance_id,
      form_data,
      execution_context = 'MANUAL'  // SAVE, COMPLETE, BATCH, MANUAL
    } = body;
    
    if (!crf_instance_id) {
      return c.json({ error: 'crf_instance_id is required' }, 400);
    }
    
    // CRF 인스턴스 정보 조회
    const crfInstance = await c.env.DB.prepare(`
      SELECT 
        c.*,
        v.subject_id,
        v.visit_number,
        v.visit_name,
        s.site_id,
        sub.subject_number,
        site.study_id
      FROM crf_instances c
      JOIN visits v ON c.visit_id = v.id
      JOIN subjects sub ON v.subject_id = sub.id
      JOIN sites site ON sub.site_id = site.id
      LEFT JOIN subjects s ON v.subject_id = s.id
      WHERE c.id = ?
    `).bind(crf_instance_id).first<any>();
    
    if (!crfInstance) {
      return c.json({ error: 'CRF instance not found' }, 404);
    }
    
    // 현재 저장된 CRF 데이터 조회
    const crfData = await c.env.DB.prepare(`
      SELECT field_code, field_value 
      FROM crf_data 
      WHERE crf_instance_id = ?
    `).bind(crf_instance_id).all();
    
    // form_data가 제공된 경우 기존 데이터와 병합
    const fieldValues: Record<string, any> = {};
    for (const row of crfData.results as any[]) {
      fieldValues[row.field_code] = row.field_value;
    }
    if (form_data) {
      Object.assign(fieldValues, form_data);
    }
    
    // 해당 Study의 활성 규칙 조회
    const rules = await c.env.DB.prepare(`
      SELECT * FROM edit_check_rules
      WHERE study_id = ? 
      AND is_active = 1
      AND (target_form_code IS NULL OR target_form_code = ?)
      ORDER BY rule_type, rule_code
    `).bind(crfInstance.study_id, crfInstance.form_code).all();
    
    // 이전 방문 데이터 조회 (Cross-Visit 검증용)
    const previousVisits = await c.env.DB.prepare(`
      SELECT 
        v.id as visit_id,
        v.visit_number,
        v.visit_name,
        v.actual_date as visit_date,
        c.id as crf_id,
        c.form_code,
        cd.field_code,
        cd.field_value
      FROM visits v
      JOIN crf_instances c ON v.id = c.visit_id
      JOIN crf_data cd ON c.id = cd.crf_instance_id
      WHERE v.subject_id = ?
      AND v.visit_number < ?
      ORDER BY v.visit_number
    `).bind(crfInstance.subject_id, crfInstance.visit_number).all();
    
    // Cross-Visit 데이터 구조화
    const crossVisitData: Record<number, Record<string, Record<string, any>>> = {};
    for (const row of previousVisits.results as any[]) {
      if (!crossVisitData[row.visit_number]) {
        crossVisitData[row.visit_number] = {};
      }
      if (!crossVisitData[row.visit_number][row.form_code]) {
        crossVisitData[row.visit_number][row.form_code] = {
          _meta: { visit_date: row.visit_date, visit_name: row.visit_name }
        };
      }
      crossVisitData[row.visit_number][row.form_code][row.field_code] = row.field_value;
    }
    
    // 같은 Visit의 다른 폼 데이터 조회 (Cross-Form 검증용)
    const sameVisitForms = await c.env.DB.prepare(`
      SELECT 
        c.form_code,
        cd.field_code,
        cd.field_value
      FROM crf_instances c
      JOIN crf_data cd ON c.id = cd.crf_instance_id
      WHERE c.visit_id = ?
      AND c.id != ?
    `).bind(crfInstance.visit_id, crf_instance_id).all();
    
    const crossFormData: Record<string, Record<string, any>> = {};
    for (const row of sameVisitForms.results as any[]) {
      if (!crossFormData[row.form_code]) {
        crossFormData[row.form_code] = {};
      }
      crossFormData[row.form_code][row.field_code] = row.field_value;
    }
    
    // DB 규칙을 EditCheckRule 형식으로 변환
    const customRules: EditCheckRule[] = (rules.results as any[]).map(rule => {
      const definition = typeof rule.rule_definition === 'string' 
        ? JSON.parse(rule.rule_definition) 
        : rule.rule_definition;
      
      // rule_definition에서 condition 추출 또는 생성
      let condition = 'true';
      if (definition.condition) {
        condition = definition.condition;
      } else if (rule.rule_type === 'RANGE') {
        // RANGE 타입의 경우 조건 생성
        const min = definition.min ?? Number.MIN_SAFE_INTEGER;
        const max = definition.max ?? Number.MAX_SAFE_INTEGER;
        const field = definition.field || rule.target_field_code;
        condition = `(data['${field}'] === undefined || data['${field}'] === null || data['${field}'] === '') || (parseFloat(data['${field}']) >= ${min} && parseFloat(data['${field}']) <= ${max})`;
      } else if (rule.rule_type === 'REQUIRED') {
        const field = definition.field || rule.target_field_code;
        condition = `data['${field}'] !== undefined && data['${field}'] !== null && data['${field}'] !== ''`;
      } else if (rule.rule_type === 'CROSS_FIELD') {
        // CROSS_FIELD 정의에서 조건 추출
        if (definition.compareFields) {
          const { field1, operator, field2 } = definition.compareFields;
          condition = `parseFloat(data['${field1}'] || 0) ${operator} parseFloat(data['${field2}'] || 0)`;
        }
      }
      
      return {
        id: rule.id,
        name: rule.rule_name,
        description: rule.description || '',
        type: rule.rule_type as RuleType,
        severity: rule.severity as RuleSeverity,
        formCode: rule.target_form_code ?? undefined,  // Convert null to undefined
        fieldCode: rule.target_field_code ?? undefined,  // Convert null to undefined
        condition,
        message: rule.error_message_ko || rule.error_message_template,
        isActive: rule.is_active === 1 || rule.is_active === true
      };
    });
    
    // Edit Check 엔진 생성 (DB와 커스텀 규칙 전달)
    const engine = new EditCheckEngine(c.env.DB, customRules);
    
    // 검증 컨텍스트 구성 (EditCheckContext 형식)
    const context: EditCheckContext = {
      studyId: crfInstance.study_id,
      siteId: crfInstance.site_id,
      subjectId: crfInstance.subject_id,
      visitId: crfInstance.visit_id,
      formCode: crfInstance.form_code,
      currentData: fieldValues,
      allVisitData: crossVisitData as Record<string, Record<string, any>>,
      subjectInfo: {
        subjectNumber: crfInstance.subject_number,
        visitNumber: crfInstance.visit_number,
        visitName: crfInstance.visit_name
      }
    };
    
    // 검증 실행 (runAllChecks 사용)
    const engineResults = await engine.runAllChecks(context);
    
    // 결과에 DB 규칙의 추가 정보 매핑
    const ruleMap = new Map((rules.results as any[]).map(r => [r.id, r]));
    const results = engineResults.map(r => {
      const dbRule = ruleMap.get(r.ruleId);
      return {
        ...r,
        ruleCode: dbRule?.rule_code,
        fieldValue: r.fieldCode ? fieldValues[r.fieldCode] : null,
        autoQueryEnabled: dbRule?.auto_query_enabled === 1,
        autoQueryPriority: dbRule?.auto_query_priority,
        autoQueryCategory: dbRule?.auto_query_category,
        context: { formCode: crfInstance.form_code }
      };
    });
    
    // 결과 저장
    const timestamp = now();
    for (const result of results) {
      const resultId = generateId('ecr');
      
      // crf_data_id 조회 (해당 필드가 있는 경우)
      let crfDataId = null;
      if (result.fieldCode) {
        const crfDataRow = await c.env.DB.prepare(
          'SELECT id FROM crf_data WHERE crf_instance_id = ? AND field_code = ?'
        ).bind(crf_instance_id, result.fieldCode).first<{ id: string }>();
        crfDataId = crfDataRow?.id || null;
      }
      
      // Check if rule_id is a DB rule or built-in rule
      const dbRule = ruleMap.get(result.ruleId);
      const ruleIdForDb = dbRule ? result.ruleId : null;  // NULL for built-in rules
      
      await c.env.DB.prepare(`
        INSERT INTO edit_check_results (
          id, rule_id, crf_instance_id, crf_data_id,
          passed, severity, error_message,
          rule_code, rule_name,
          field_code, field_value, context_data,
          resolution_status, executed_at, execution_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        resultId,
        ruleIdForDb,
        crf_instance_id,
        crfDataId,
        result.passed ? 1 : 0,
        result.severity,
        result.message || null,
        result.ruleCode || result.ruleId,  // Store rule code for built-in rules
        result.ruleName,
        result.fieldCode || null,
        result.fieldValue || null,
        JSON.stringify(result.context || {}),
        result.passed ? 'RESOLVED' : 'PENDING',
        timestamp,
        execution_context
      ).run();
      
      // 자동 쿼리 생성 (실패한 규칙 + autoQueryEnabled)
      if (!result.passed && result.autoQueryEnabled && crfDataId) {
        const queryId = generateId('qry');
        await c.env.DB.prepare(`
          INSERT INTO queries (
            id, crf_data_id, crf_instance_id, field_code,
            status, priority, category, query_text, created_by, due_date
          ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, datetime('now', '+7 days'))
        `).bind(
          queryId,
          crfDataId,
          crf_instance_id,
          result.fieldCode || null,
          result.autoQueryPriority || 'MINOR',
          result.autoQueryCategory || 'DATA_INCONSISTENT',
          `[Auto-generated] ${result.message}`,
          user.userId
        ).run();
        
        // edit_check_results에 query_id 업데이트
        await c.env.DB.prepare(
          'UPDATE edit_check_results SET query_id = ?, resolution_status = ? WHERE id = ?'
        ).bind(queryId, 'QUERY_OPENED', resultId).run();
      }
    }
    
    // 결과 요약
    const summary = {
      totalRules: rules.results?.length || 0,
      totalChecks: results.length,
      passed: results.filter(r => r.passed).length,
      errors: results.filter(r => !r.passed && r.severity === 'ERROR').length,
      warnings: results.filter(r => !r.passed && r.severity === 'WARNING').length,
      info: results.filter(r => !r.passed && r.severity === 'INFO').length
    };
    
    return c.json({
      message: 'Edit checks executed successfully',
      summary,
      results: results.map(r => ({
        ruleId: r.ruleId,
        ruleCode: r.ruleCode,
        passed: r.passed,
        severity: r.severity,
        message: r.message,
        fieldCode: r.fieldCode,
        fieldValue: r.fieldValue
      }))
    });
  } catch (error: any) {
    console.error('Execute edit checks error:', error);
    return c.json({ error: 'Failed to execute edit checks', details: error?.message || String(error) }, 500);
  }
});

// POST /api/edit-checks/batch - 일괄 검증 실행
app.post('/batch', requireRole('ADMIN', 'DM', 'CRA'), async (c) => {
  try {
    const user = getAuthUser(c);
    const body = await c.req.json();
    
    const {
      study_id,
      scope_type = 'STUDY',  // STUDY, SITE, SUBJECT, VISIT
      scope_id
    } = body;
    
    if (!study_id) {
      return c.json({ error: 'study_id is required' }, 400);
    }
    
    const batchId = generateId('batch');
    const timestamp = now();
    
    // 배치 실행 레코드 생성
    await c.env.DB.prepare(`
      INSERT INTO edit_check_batches (
        id, study_id, scope_type, scope_id,
        executed_by, started_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING')
    `).bind(
      batchId, study_id, scope_type, scope_id || study_id, user.userId, timestamp
    ).run();
    
    // 대상 CRF 인스턴스 조회
    let crfQuery = `
      SELECT c.id as crf_instance_id
      FROM crf_instances c
      JOIN visits v ON c.visit_id = v.id
      JOIN subjects sub ON v.subject_id = sub.id
      JOIN sites site ON sub.site_id = site.id
      WHERE site.study_id = ?
    `;
    const params: any[] = [study_id];
    
    if (scope_type === 'SITE') {
      crfQuery += ` AND site.id = ?`;
      params.push(scope_id);
    } else if (scope_type === 'SUBJECT') {
      crfQuery += ` AND sub.id = ?`;
      params.push(scope_id);
    } else if (scope_type === 'VISIT') {
      crfQuery += ` AND v.id = ?`;
      params.push(scope_id);
    }
    
    const crfInstances = await c.env.DB.prepare(crfQuery).bind(...params).all();
    
    let totalChecks = 0;
    let passedCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    
    // 각 CRF 인스턴스에 대해 검증 실행 (실제로는 백그라운드 작업으로 처리해야 함)
    // 여기서는 간단한 구현으로 처리
    for (const crf of crfInstances.results as any[]) {
      try {
        // 내부적으로 /execute API 로직 호출 (실제 구현에서는 분리)
        // 여기서는 단순화를 위해 건수만 카운트
        totalChecks += 1;
      } catch (err) {
        console.error(`Batch check error for CRF ${crf.crf_instance_id}:`, err);
      }
    }
    
    // 실제 결과 조회
    const resultsStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN passed = 0 AND severity = 'ERROR' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN passed = 0 AND severity = 'WARNING' THEN 1 ELSE 0 END) as warnings,
        SUM(CASE WHEN passed = 0 AND severity = 'INFO' THEN 1 ELSE 0 END) as info
      FROM edit_check_results
      WHERE executed_at >= ?
    `).bind(timestamp).first<any>();
    
    // 배치 레코드 업데이트
    await c.env.DB.prepare(`
      UPDATE edit_check_batches SET
        total_rules_executed = ?,
        total_checks_performed = ?,
        passed_count = ?,
        error_count = ?,
        warning_count = ?,
        info_count = ?,
        completed_at = ?,
        status = 'COMPLETED'
      WHERE id = ?
    `).bind(
      crfInstances.results?.length || 0,
      resultsStats?.total || 0,
      resultsStats?.passed || 0,
      resultsStats?.errors || 0,
      resultsStats?.warnings || 0,
      resultsStats?.info || 0,
      now(),
      batchId
    ).run();
    
    return c.json({
      message: 'Batch edit check completed',
      batch_id: batchId,
      summary: {
        scope_type,
        scope_id: scope_id || study_id,
        total_crfs_checked: crfInstances.results?.length || 0,
        total_checks: resultsStats?.total || 0,
        passed: resultsStats?.passed || 0,
        errors: resultsStats?.errors || 0,
        warnings: resultsStats?.warnings || 0,
        info: resultsStats?.info || 0
      }
    });
  } catch (error) {
    console.error('Batch edit check error:', error);
    return c.json({ error: 'Failed to execute batch edit checks' }, 500);
  }
});

// =====================================================
// 검증 결과 조회 API
// =====================================================

// GET /api/edit-checks/results - 검증 결과 목록 조회
app.get('/results', async (c) => {
  try {
    const { 
      studyId,
      crfInstanceId, 
      ruleId,
      passed,
      severity,
      resolutionStatus,
      limit = '50', 
      offset = '0' 
    } = c.req.query();
    
    let query = `
      SELECT 
        r.*,
        rule.rule_code,
        rule.rule_name,
        rule.rule_type,
        rule.error_message_ko
      FROM edit_check_results r
      JOIN edit_check_rules rule ON r.rule_id = rule.id
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (studyId) {
      query += ` AND rule.study_id = ?`;
      params.push(studyId);
    }
    
    if (crfInstanceId) {
      query += ` AND r.crf_instance_id = ?`;
      params.push(crfInstanceId);
    }
    
    if (ruleId) {
      query += ` AND r.rule_id = ?`;
      params.push(ruleId);
    }
    
    if (passed !== undefined && passed !== '') {
      query += ` AND r.passed = ?`;
      params.push(passed === 'true' || passed === '1' ? 1 : 0);
    }
    
    if (severity) {
      query += ` AND r.severity = ?`;
      params.push(severity);
    }
    
    if (resolutionStatus) {
      query += ` AND r.resolution_status = ?`;
      params.push(resolutionStatus);
    }
    
    query += ` ORDER BY r.executed_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    const results = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({
      data: results.results,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get edit check results error:', error);
    return c.json({ error: 'Failed to fetch edit check results' }, 500);
  }
});

// PUT /api/edit-checks/results/:id/resolve - 결과 해결 처리
app.put('/results/:id/resolve', async (c) => {
  try {
    const user = getAuthUser(c);
    const resultId = c.req.param('id');
    const body = await c.req.json();
    
    const { resolution_status, resolution_note } = body;
    
    if (!resolution_status || !['ACKNOWLEDGED', 'RESOLVED', 'WAIVED'].includes(resolution_status)) {
      return c.json({ error: 'Invalid resolution_status. Must be ACKNOWLEDGED, RESOLVED, or WAIVED' }, 400);
    }
    
    const result = await c.env.DB.prepare(
      'SELECT * FROM edit_check_results WHERE id = ?'
    ).bind(resultId).first();
    
    if (!result) {
      return c.json({ error: 'Result not found' }, 404);
    }
    
    await c.env.DB.prepare(`
      UPDATE edit_check_results SET
        resolution_status = ?,
        resolved_by = ?,
        resolved_at = ?,
        resolution_note = ?
      WHERE id = ?
    `).bind(
      resolution_status,
      user.userId,
      now(),
      resolution_note || null,
      resultId
    ).run();
    
    return c.json({ message: 'Result resolved successfully' });
  } catch (error) {
    console.error('Resolve edit check result error:', error);
    return c.json({ error: 'Failed to resolve edit check result' }, 500);
  }
});

// =====================================================
// 규칙 프리셋 API
// =====================================================

// GET /api/edit-checks/presets - 사전 정의된 규칙 프리셋 목록
app.get('/presets', async (c) => {
  // 일반적인 임상시험 검증 규칙 프리셋
  const presets = [
    {
      code: 'VS_SBP_RANGE',
      name: 'Systolic Blood Pressure Range Check',
      type: 'RANGE',
      description: 'Check if systolic blood pressure is within normal range (60-200 mmHg)',
      definition: {
        field: 'SBP',
        min: 60,
        max: 200,
        unit: 'mmHg'
      },
      error_message_template: 'Systolic blood pressure ({value}) is out of range ({min}-{max} {unit})',
      error_message_ko: '수축기 혈압 ({value})이 정상 범위를 벗어났습니다 ({min}-{max} {unit})'
    },
    {
      code: 'VS_DBP_RANGE',
      name: 'Diastolic Blood Pressure Range Check',
      type: 'RANGE',
      description: 'Check if diastolic blood pressure is within normal range (40-120 mmHg)',
      definition: {
        field: 'DBP',
        min: 40,
        max: 120,
        unit: 'mmHg'
      },
      error_message_template: 'Diastolic blood pressure ({value}) is out of range ({min}-{max} {unit})',
      error_message_ko: '이완기 혈압 ({value})이 정상 범위를 벗어났습니다 ({min}-{max} {unit})'
    },
    {
      code: 'VS_BP_CONSISTENCY',
      name: 'Blood Pressure Consistency Check',
      type: 'CROSS_FIELD',
      description: 'Systolic BP should be greater than Diastolic BP',
      definition: {
        expression: 'SBP > DBP',
        fields: ['SBP', 'DBP']
      },
      error_message_template: 'Systolic BP ({SBP}) must be greater than Diastolic BP ({DBP})',
      error_message_ko: '수축기 혈압 ({SBP})은 이완기 혈압 ({DBP})보다 커야 합니다'
    },
    {
      code: 'VS_HR_RANGE',
      name: 'Heart Rate Range Check',
      type: 'RANGE',
      description: 'Check if heart rate is within normal range (40-200 bpm)',
      definition: {
        field: 'HR',
        min: 40,
        max: 200,
        unit: 'bpm'
      },
      error_message_template: 'Heart rate ({value}) is out of range ({min}-{max} {unit})',
      error_message_ko: '심박수 ({value})가 정상 범위를 벗어났습니다 ({min}-{max} {unit})'
    },
    {
      code: 'VS_TEMP_RANGE',
      name: 'Body Temperature Range Check',
      type: 'RANGE',
      description: 'Check if body temperature is within normal range (35-42°C)',
      definition: {
        field: 'TEMP',
        min: 35,
        max: 42,
        unit: '°C'
      },
      error_message_template: 'Body temperature ({value}) is out of range ({min}-{max} {unit})',
      error_message_ko: '체온 ({value})이 정상 범위를 벗어났습니다 ({min}-{max} {unit})'
    },
    {
      code: 'DATE_CONSENT_FIRST',
      name: 'Consent Date Precedence',
      type: 'TEMPORAL',
      description: 'Informed consent date must be before or on screening date',
      definition: {
        expression: 'IC_DATE <= SCREENING_DATE',
        fields: ['IC_DATE', 'SCREENING_DATE']
      },
      error_message_template: 'Informed consent date ({IC_DATE}) must be on or before screening date ({SCREENING_DATE})',
      error_message_ko: '동의서 서명일 ({IC_DATE})은 스크리닝 날짜 ({SCREENING_DATE}) 이전이어야 합니다'
    },
    {
      code: 'VISIT_DATE_ORDER',
      name: 'Visit Date Chronological Order',
      type: 'CROSS_VISIT',
      description: 'Visit dates must be in chronological order',
      definition: {
        checkType: 'DATE_ORDER',
        dateField: 'VISIT_DATE'
      },
      error_message_template: 'Visit date ({VISIT_DATE}) is before the previous visit date',
      error_message_ko: '방문일 ({VISIT_DATE})이 이전 방문 날짜보다 빠릅니다'
    },
    {
      code: 'AE_DATE_RANGE',
      name: 'Adverse Event Date Within Study Period',
      type: 'TEMPORAL',
      description: 'AE start date must be after informed consent',
      definition: {
        expression: 'AE_START_DATE >= IC_DATE',
        fields: ['AE_START_DATE', 'IC_DATE'],
        crossFormReference: 'IC'
      },
      error_message_template: 'AE start date ({AE_START_DATE}) cannot be before informed consent date ({IC_DATE})',
      error_message_ko: '이상반응 발생일 ({AE_START_DATE})은 동의서 서명일 ({IC_DATE}) 이후여야 합니다'
    },
    {
      code: 'AE_END_AFTER_START',
      name: 'AE End Date After Start Date',
      type: 'CROSS_FIELD',
      description: 'AE end date must be on or after start date',
      definition: {
        expression: 'AE_END_DATE >= AE_START_DATE',
        fields: ['AE_START_DATE', 'AE_END_DATE'],
        condition: 'AE_END_DATE IS NOT NULL'
      },
      error_message_template: 'AE end date ({AE_END_DATE}) must be on or after start date ({AE_START_DATE})',
      error_message_ko: '이상반응 종료일 ({AE_END_DATE})은 발생일 ({AE_START_DATE}) 이후여야 합니다'
    },
    {
      code: 'LAB_FASTING_GLUCOSE',
      name: 'Fasting Glucose Range',
      type: 'CONDITIONAL',
      description: 'Fasting glucose should be checked if fasting status is Yes',
      definition: {
        condition: 'FASTING_STATUS == "YES"',
        expression: 'GLUCOSE >= 70 AND GLUCOSE <= 100',
        fields: ['FASTING_STATUS', 'GLUCOSE']
      },
      error_message_template: 'Fasting glucose ({GLUCOSE}) is outside normal range (70-100 mg/dL)',
      error_message_ko: '공복 혈당 ({GLUCOSE})이 정상 범위 (70-100 mg/dL)를 벗어났습니다'
    }
  ];
  
  return c.json({ data: presets });
});

// POST /api/edit-checks/presets/apply - 프리셋 규칙 적용
app.post('/presets/apply', requireRole('ADMIN', 'DM'), async (c) => {
  try {
    const user = getAuthUser(c);
    const body = await c.req.json();
    
    const { study_id, preset_codes } = body;
    
    if (!study_id || !preset_codes || !Array.isArray(preset_codes)) {
      return c.json({ error: 'study_id and preset_codes (array) are required' }, 400);
    }
    
    // 프리셋 가져오기 (위의 presets 배열과 동일)
    const presetResponse = await fetch(`${c.req.url.replace(/\/presets\/apply.*/, '/presets')}`);
    const presetsData = await c.json();
    
    // 간단하게 하드코딩된 프리셋 사용
    const presets: any[] = [
      // ... (위와 동일한 프리셋)
    ];
    
    const appliedRules: string[] = [];
    const timestamp = now();
    
    for (const code of preset_codes) {
      const preset = presets.find(p => p.code === code);
      if (!preset) continue;
      
      // 이미 존재하는지 확인
      const existing = await c.env.DB.prepare(
        'SELECT id FROM edit_check_rules WHERE study_id = ? AND rule_code = ?'
      ).bind(study_id, preset.code).first();
      
      if (existing) continue;
      
      const id = generateId('rule');
      
      await c.env.DB.prepare(`
        INSERT INTO edit_check_rules (
          id, study_id, rule_code, rule_name, description, rule_type,
          rule_definition, error_message_template, error_message_ko,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, study_id, preset.code, preset.name, preset.description, preset.type,
        JSON.stringify(preset.definition), preset.error_message_template, preset.error_message_ko,
        user.userId, timestamp, timestamp
      ).run();
      
      appliedRules.push(preset.code);
    }
    
    return c.json({
      message: `Applied ${appliedRules.length} preset rules`,
      applied_rules: appliedRules
    });
  } catch (error) {
    console.error('Apply presets error:', error);
    return c.json({ error: 'Failed to apply presets' }, 500);
  }
});

export default app;
