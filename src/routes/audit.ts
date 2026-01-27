// Audit Trail API Routes
// 21 CFR Part 11 준수 감사 추적 API
// Created: 2026-01-27

import { Hono } from 'hono';
import type { Bindings, Variables, AuditLog, AuditAction, AuditCategory, AuditSeverity } from '../types';
import { getAuthUser } from '../middleware/auth';
import { hasPermission } from '../middleware/rbac';
import { now } from '../utils/date';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * 액션에 따른 카테고리 결정
 */
function getActionCategory(action: AuditAction): AuditCategory {
  const categoryMap: Record<string, AuditCategory> = {
    // 인증
    'LOGIN': 'AUTHENTICATION',
    'LOGIN_FAILED': 'AUTHENTICATION',
    'LOGOUT': 'AUTHENTICATION',
    'PASSWORD_CHANGE': 'AUTHENTICATION',
    'PASSWORD_RESET': 'AUTHENTICATION',
    '2FA_ENABLED': 'AUTHENTICATION',
    '2FA_DISABLED': 'AUTHENTICATION',
    '2FA_VERIFIED': 'AUTHENTICATION',
    '2FA_FAILED': 'AUTHENTICATION',
    'SESSION_TIMEOUT': 'AUTHENTICATION',
    // 권한
    'USER_CREATE': 'AUTHORIZATION',
    'USER_UPDATE': 'AUTHORIZATION',
    'USER_DEACTIVATE': 'AUTHORIZATION',
    'USER_ACTIVATE': 'AUTHORIZATION',
    'ROLE_CHANGE': 'AUTHORIZATION',
    'PERMISSION_GRANT': 'AUTHORIZATION',
    'PERMISSION_REVOKE': 'AUTHORIZATION',
    // 데이터 입력
    'CREATE': 'DATA_ENTRY',
    'CRF_SAVE': 'DATA_ENTRY',
    'CRF_SUBMIT': 'DATA_ENTRY',
    // 데이터 수정
    'UPDATE': 'DATA_MODIFICATION',
    'DELETE': 'DATA_MODIFICATION',
    // 데이터 조회
    'READ': 'DATA_ACCESS',
    // 서명
    'SIGN': 'SIGNATURE',
    'SIGN_REJECTED': 'SIGNATURE',
    'COUNTERSIGN': 'SIGNATURE',
    // 워크플로우
    'LOCK': 'WORKFLOW',
    'UNLOCK': 'WORKFLOW',
    'FREEZE': 'WORKFLOW',
    'UNFREEZE': 'WORKFLOW',
    'CRF_VERIFY': 'WORKFLOW',
    'CRF_REVIEW': 'WORKFLOW',
    'CRF_APPROVE': 'WORKFLOW',
    'CRF_REJECT': 'WORKFLOW',
    // Query
    'QUERY_OPEN': 'QUERY',
    'QUERY_ANSWER': 'QUERY',
    'QUERY_CLOSE': 'QUERY',
    'QUERY_REOPEN': 'QUERY',
    'QUERY_CANCEL': 'QUERY',
    // 내보내기
    'EXPORT': 'EXPORT',
    'PRINT': 'EXPORT',
    'DOWNLOAD': 'EXPORT',
    // 관리
    'STUDY_CREATE': 'ADMINISTRATION',
    'STUDY_UPDATE': 'ADMINISTRATION',
    'STUDY_LOCK': 'ADMINISTRATION',
    'STUDY_CLOSE': 'ADMINISTRATION',
    'SITE_ACTIVATE': 'ADMINISTRATION',
    'SITE_DEACTIVATE': 'ADMINISTRATION',
    'SUBJECT_ENROLL': 'ADMINISTRATION',
    'SUBJECT_RANDOMIZE': 'ADMINISTRATION',
    'SUBJECT_WITHDRAW': 'ADMINISTRATION',
    'SUBJECT_COMPLETE': 'ADMINISTRATION',
    // 시스템
    'SYSTEM_CONFIG': 'SYSTEM',
    'BACKUP': 'SYSTEM',
    'RESTORE': 'SYSTEM',
    'SYNC': 'SYSTEM',
    'CONFLICT_RESOLVE': 'SYSTEM',
  };
  return categoryMap[action] || 'SYSTEM';
}

/**
 * 액션에 따른 심각도 결정
 */
function getActionSeverity(action: AuditAction): AuditSeverity {
  const criticalActions = ['DELETE', 'UNLOCK', 'UNFREEZE', 'PASSWORD_RESET', 'RESTORE', 'CONFLICT_RESOLVE'];
  const warningActions = ['LOGIN_FAILED', '2FA_FAILED', 'SIGN_REJECTED', 'CRF_REJECT', 'QUERY_REOPEN'];
  const errorActions = ['SESSION_TIMEOUT'];
  
  if (criticalActions.includes(action)) return 'CRITICAL';
  if (errorActions.includes(action)) return 'ERROR';
  if (warningActions.includes(action)) return 'WARNING';
  return 'INFO';
}

/**
 * 액션 한글 라벨
 */
function getActionLabel(action: AuditAction): string {
  const labels: Record<string, string> = {
    'CREATE': '생성',
    'READ': '조회',
    'UPDATE': '수정',
    'DELETE': '삭제',
    'LOGIN': '로그인',
    'LOGIN_FAILED': '로그인 실패',
    'LOGOUT': '로그아웃',
    'PASSWORD_CHANGE': '비밀번호 변경',
    'PASSWORD_RESET': '비밀번호 재설정',
    '2FA_ENABLED': '2FA 활성화',
    '2FA_DISABLED': '2FA 비활성화',
    '2FA_VERIFIED': '2FA 인증 성공',
    '2FA_FAILED': '2FA 인증 실패',
    'SESSION_TIMEOUT': '세션 만료',
    'SIGN': '전자 서명',
    'SIGN_REJECTED': '서명 거부',
    'COUNTERSIGN': '추가 서명',
    'LOCK': '잠금',
    'UNLOCK': '잠금 해제',
    'FREEZE': '동결',
    'UNFREEZE': '동결 해제',
    'QUERY_OPEN': 'Query 생성',
    'QUERY_ANSWER': 'Query 응답',
    'QUERY_CLOSE': 'Query 종료',
    'QUERY_REOPEN': 'Query 재개',
    'QUERY_CANCEL': 'Query 취소',
    'CRF_SAVE': 'CRF 저장',
    'CRF_SUBMIT': 'CRF 제출',
    'CRF_VERIFY': 'SDV 검증',
    'CRF_REVIEW': 'CRF 리뷰',
    'CRF_APPROVE': 'CRF 승인',
    'CRF_REJECT': 'CRF 반려',
    'EXPORT': '데이터 내보내기',
    'PRINT': '인쇄',
    'DOWNLOAD': '다운로드',
    'USER_CREATE': '사용자 생성',
    'USER_UPDATE': '사용자 수정',
    'USER_DEACTIVATE': '사용자 비활성화',
    'USER_ACTIVATE': '사용자 활성화',
    'ROLE_CHANGE': '역할 변경',
    'PERMISSION_GRANT': '권한 부여',
    'PERMISSION_REVOKE': '권한 회수',
    'STUDY_CREATE': '연구 생성',
    'STUDY_UPDATE': '연구 수정',
    'STUDY_LOCK': '연구 잠금',
    'STUDY_CLOSE': '연구 종료',
    'SITE_ACTIVATE': '기관 활성화',
    'SITE_DEACTIVATE': '기관 비활성화',
    'SUBJECT_ENROLL': '피험자 등록',
    'SUBJECT_RANDOMIZE': '무작위 배정',
    'SUBJECT_WITHDRAW': '피험자 철회',
    'SUBJECT_COMPLETE': '피험자 완료',
    'SYSTEM_CONFIG': '시스템 설정',
    'BACKUP': '백업',
    'RESTORE': '복원',
    'SYNC': '동기화',
    'CONFLICT_RESOLVE': '충돌 해결',
  };
  return labels[action] || action;
}

/**
 * 테이블 이름 한글 라벨
 */
function getTableLabel(tableName: string): string {
  const labels: Record<string, string> = {
    'users': '사용자',
    'studies': '연구',
    'sites': '기관',
    'subjects': '피험자',
    'visits': '방문',
    'crf_instances': 'CRF',
    'crf_data': 'CRF 데이터',
    'queries': 'Query',
    'signatures': '전자 서명',
    'sessions': '세션',
    'audit_logs': '감사 로그',
    'form_definitions': 'CRF 정의',
    'field_definitions': '필드 정의',
    'visit_schedules': '방문 일정',
    'data_locks': '데이터 잠금',
  };
  return labels[tableName] || tableName;
}

// =====================================================
// API ENDPOINTS
// =====================================================

// GET /api/audit/logs - 감사 로그 조회 (고급 필터링)
app.get('/logs', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    // Query parameters
    const {
      studyId,
      siteId,
      subjectId,
      userId,
      action,
      category,
      severity,
      tableName,
      recordId,
      startDate,
      endDate,
      search,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      page = '1',
      pageSize = '50',
    } = c.req.query();

    const limit = Math.min(parseInt(pageSize) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    // Build query
    let whereClause = '1=1';
    const params: (string | number)[] = [];

    if (studyId) {
      whereClause += ' AND study_id = ?';
      params.push(studyId);
    }

    if (siteId) {
      whereClause += ' AND site_id = ?';
      params.push(siteId);
    }

    if (subjectId) {
      whereClause += ' AND subject_id = ?';
      params.push(subjectId);
    }

    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    if (action) {
      const actions = action.split(',');
      whereClause += ` AND action IN (${actions.map(() => '?').join(',')})`;
      params.push(...actions);
    }

    if (tableName) {
      whereClause += ' AND table_name = ?';
      params.push(tableName);
    }

    if (recordId) {
      whereClause += ' AND record_id = ?';
      params.push(recordId);
    }

    if (startDate) {
      whereClause += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND timestamp <= ?';
      params.push(endDate);
    }

    if (search) {
      whereClause += ' AND (user_name LIKE ? OR record_id LIKE ? OR old_value LIKE ? OR new_value LIKE ? OR reason_for_change LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}
    `).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;

    // Get logs with sorting
    const validSortColumns = ['timestamp', 'action', 'user_name', 'table_name'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'timestamp';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const logsResult = await c.env.DB.prepare(`
      SELECT * FROM audit_logs 
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    // Enrich logs with labels
    const enrichedLogs = (logsResult.results || []).map((log: any) => ({
      ...log,
      action_label: getActionLabel(log.action),
      table_label: getTableLabel(log.table_name),
      category: getActionCategory(log.action),
      severity: getActionSeverity(log.action),
    }));

    return c.json({
      success: true,
      data: enrichedLogs,
      pagination: {
        page: parseInt(page) || 1,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filters: {
        studyId,
        siteId,
        subjectId,
        userId,
        action,
        tableName,
        startDate,
        endDate,
      },
    });
  } catch (error: any) {
    console.error('Audit logs error:', error);
    return c.json({ success: false, error: '감사 로그 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/logs/:id - 특정 감사 로그 상세 조회
app.get('/logs/:id', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    const logId = c.req.param('id');

    const log = await c.env.DB.prepare(`
      SELECT * FROM audit_logs WHERE id = ?
    `).bind(logId).first();

    if (!log) {
      return c.json({ success: false, error: '감사 로그를 찾을 수 없습니다.' }, 404);
    }

    // Get related context
    let studyInfo = null;
    let siteInfo = null;
    let subjectInfo = null;
    let userInfo = null;

    if ((log as any).study_id) {
      studyInfo = await c.env.DB.prepare(`
        SELECT id, protocol_number, title FROM studies WHERE id = ?
      `).bind((log as any).study_id).first();
    }

    if ((log as any).site_id) {
      siteInfo = await c.env.DB.prepare(`
        SELECT id, site_number, name FROM sites WHERE id = ?
      `).bind((log as any).site_id).first();
    }

    if ((log as any).subject_id) {
      subjectInfo = await c.env.DB.prepare(`
        SELECT id, subject_number, screening_number FROM subjects WHERE id = ?
      `).bind((log as any).subject_id).first();
    }

    userInfo = await c.env.DB.prepare(`
      SELECT id, email, name, role FROM users WHERE id = ?
    `).bind((log as any).user_id).first();

    return c.json({
      success: true,
      data: {
        ...log,
        action_label: getActionLabel((log as any).action),
        table_label: getTableLabel((log as any).table_name),
        category: getActionCategory((log as any).action),
        severity: getActionSeverity((log as any).action),
        context: {
          study: studyInfo,
          site: siteInfo,
          subject: subjectInfo,
          user: userInfo,
        },
      },
    });
  } catch (error: any) {
    console.error('Audit log detail error:', error);
    return c.json({ success: false, error: '감사 로그 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/record/:tableName/:recordId - 특정 레코드의 변경 이력
app.get('/record/:tableName/:recordId', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    const tableName = c.req.param('tableName');
    const recordId = c.req.param('recordId');

    const logs = await c.env.DB.prepare(`
      SELECT * FROM audit_logs 
      WHERE table_name = ? AND record_id = ?
      ORDER BY timestamp DESC
      LIMIT 500
    `).bind(tableName, recordId).all();

    // Group by field for field-level history
    const fieldHistory: Record<string, any[]> = {};
    for (const log of logs.results as any[]) {
      if (log.field_name) {
        if (!fieldHistory[log.field_name]) {
          fieldHistory[log.field_name] = [];
        }
        fieldHistory[log.field_name].push({
          ...log,
          action_label: getActionLabel(log.action),
        });
      }
    }

    return c.json({
      success: true,
      data: {
        tableName,
        tableLabel: getTableLabel(tableName),
        recordId,
        totalChanges: logs.results?.length || 0,
        history: (logs.results || []).map((log: any) => ({
          ...log,
          action_label: getActionLabel(log.action),
          category: getActionCategory(log.action),
          severity: getActionSeverity(log.action),
        })),
        fieldHistory,
      },
    });
  } catch (error: any) {
    console.error('Record history error:', error);
    return c.json({ success: false, error: '레코드 이력 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/user/:userId - 특정 사용자의 활동 로그
app.get('/user/:userId', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    const targetUserId = c.req.param('userId');
    const { startDate, endDate, page = '1', pageSize = '50' } = c.req.query();

    const limit = Math.min(parseInt(pageSize) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    let whereClause = 'user_id = ?';
    const params: (string | number)[] = [targetUserId];

    if (startDate) {
      whereClause += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND timestamp <= ?';
      params.push(endDate);
    }

    // Get user info
    const targetUser = await c.env.DB.prepare(`
      SELECT id, email, name, role, status, created_at, last_login FROM users WHERE id = ?
    `).bind(targetUserId).first();

    // Count total
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}
    `).bind(...params).first<{ total: number }>();

    // Get logs
    const logsResult = await c.env.DB.prepare(`
      SELECT * FROM audit_logs 
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    // Get activity summary
    const activitySummary = await c.env.DB.prepare(`
      SELECT action, COUNT(*) as count
      FROM audit_logs
      WHERE user_id = ?
      GROUP BY action
      ORDER BY count DESC
    `).bind(targetUserId).all();

    return c.json({
      success: true,
      data: {
        user: targetUser,
        activitySummary: (activitySummary.results || []).map((item: any) => ({
          action: item.action,
          action_label: getActionLabel(item.action),
          count: item.count,
        })),
        logs: (logsResult.results || []).map((log: any) => ({
          ...log,
          action_label: getActionLabel(log.action),
          table_label: getTableLabel(log.table_name),
          category: getActionCategory(log.action),
          severity: getActionSeverity(log.action),
        })),
        pagination: {
          page: parseInt(page) || 1,
          pageSize: limit,
          total: countResult?.total || 0,
          totalPages: Math.ceil((countResult?.total || 0) / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('User activity error:', error);
    return c.json({ success: false, error: '사용자 활동 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/statistics - 감사 로그 통계
app.get('/statistics', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'VIEW_AUDIT')) {
      return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
    }

    const { studyId, startDate, endDate, period = '7d' } = c.req.query();

    // Calculate date range
    let fromDate: string;
    const toDate = endDate || now();
    
    if (startDate) {
      fromDate = startDate;
    } else {
      const periodMap: Record<string, number> = {
        '24h': 1,
        '7d': 7,
        '30d': 30,
        '90d': 90,
      };
      const days = periodMap[period] || 7;
      const from = new Date();
      from.setDate(from.getDate() - days);
      fromDate = from.toISOString();
    }

    let studyFilter = '';
    const params: string[] = [fromDate, toDate];

    if (studyId) {
      studyFilter = 'AND study_id = ?';
      params.push(studyId);
    }

    // Total counts by action
    const actionCounts = await c.env.DB.prepare(`
      SELECT action, COUNT(*) as count
      FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ? ${studyFilter}
      GROUP BY action
      ORDER BY count DESC
    `).bind(...params).all();

    // Total counts by category
    const categoryCounts: Record<string, number> = {};
    for (const item of actionCounts.results as any[]) {
      const category = getActionCategory(item.action);
      categoryCounts[category] = (categoryCounts[category] || 0) + item.count;
    }

    // Active users
    const activeUsers = await c.env.DB.prepare(`
      SELECT user_id, user_name, user_role, COUNT(*) as activity_count
      FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ? ${studyFilter}
      GROUP BY user_id, user_name, user_role
      ORDER BY activity_count DESC
      LIMIT 10
    `).bind(...params).all();

    // Recent critical events
    const criticalActions = ['DELETE', 'UNLOCK', 'UNFREEZE', 'PASSWORD_RESET', 'RESTORE', 'LOGIN_FAILED', '2FA_FAILED'];
    const criticalEvents = await c.env.DB.prepare(`
      SELECT *
      FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ? ${studyFilter}
        AND action IN (${criticalActions.map(() => '?').join(',')})
      ORDER BY timestamp DESC
      LIMIT 20
    `).bind(...params, ...criticalActions).all();

    // Daily activity trend
    const dailyActivity = await c.env.DB.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ? ${studyFilter}
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).bind(...params).all();

    // Table activity
    const tableActivity = await c.env.DB.prepare(`
      SELECT table_name, COUNT(*) as count
      FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ? ${studyFilter}
      GROUP BY table_name
      ORDER BY count DESC
      LIMIT 10
    `).bind(...params).all();

    return c.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        summary: {
          totalEvents: actionCounts.results?.reduce((sum: number, item: any) => sum + item.count, 0) || 0,
          uniqueUsers: activeUsers.results?.length || 0,
          criticalEvents: criticalEvents.results?.length || 0,
        },
        actionBreakdown: (actionCounts.results || []).map((item: any) => ({
          action: item.action,
          action_label: getActionLabel(item.action),
          count: item.count,
          category: getActionCategory(item.action),
          severity: getActionSeverity(item.action),
        })),
        categoryBreakdown: Object.entries(categoryCounts).map(([category, count]) => ({
          category,
          count,
        })).sort((a, b) => b.count - a.count),
        tableBreakdown: (tableActivity.results || []).map((item: any) => ({
          table_name: item.table_name,
          table_label: getTableLabel(item.table_name),
          count: item.count,
        })),
        activeUsers: activeUsers.results,
        criticalEvents: (criticalEvents.results || []).map((log: any) => ({
          ...log,
          action_label: getActionLabel(log.action),
          severity: getActionSeverity(log.action),
        })),
        dailyTrend: dailyActivity.results,
      },
    });
  } catch (error: any) {
    console.error('Audit statistics error:', error);
    return c.json({ success: false, error: '통계 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/export - 감사 로그 내보내기
app.get('/export', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ success: false, error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { studyId, startDate, endDate, format = 'csv' } = c.req.query();

    if (!studyId) {
      return c.json({ success: false, error: 'studyId가 필요합니다.' }, 400);
    }

    let whereClause = 'study_id = ?';
    const params: string[] = [studyId];

    if (startDate) {
      whereClause += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND timestamp <= ?';
      params.push(endDate);
    }

    const logs = await c.env.DB.prepare(`
      SELECT * FROM audit_logs
      WHERE ${whereClause}
      ORDER BY timestamp ASC
      LIMIT 50000
    `).bind(...params).all();

    // Generate CSV
    const headers = [
      'Log ID', 'Timestamp', 'User ID', 'User Name', 'User Role',
      'Action', 'Action Category', 'Severity', 'Table', 'Record ID',
      'Field Name', 'Old Value', 'New Value', 'Reason for Change',
      'IP Address', 'Session ID', 'Study ID', 'Site ID', 'Subject ID'
    ];

    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = (logs.results || []).map((log: any) => [
      log.id,
      log.timestamp,
      log.user_id,
      log.user_name,
      log.user_role,
      log.action,
      getActionCategory(log.action),
      getActionSeverity(log.action),
      log.table_name,
      log.record_id,
      log.field_name || '',
      log.old_value || '',
      log.new_value || '',
      log.reason_for_change || '',
      log.ip_address || '',
      log.session_id || '',
      log.study_id || '',
      log.site_id || '',
      log.subject_id || '',
    ]);

    const csv = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\r\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit_trail_${studyId}_${now().split('T')[0]}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('Audit export error:', error);
    return c.json({ success: false, error: '감사 로그 내보내기 실패', details: error?.message }, 500);
  }
});

// GET /api/audit/actions - 사용 가능한 액션 목록
app.get('/actions', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const actions = [
    'CREATE', 'READ', 'UPDATE', 'DELETE',
    'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET',
    '2FA_ENABLED', '2FA_DISABLED', '2FA_VERIFIED', '2FA_FAILED', 'SESSION_TIMEOUT',
    'SIGN', 'SIGN_REJECTED', 'COUNTERSIGN',
    'LOCK', 'UNLOCK', 'FREEZE', 'UNFREEZE',
    'QUERY_OPEN', 'QUERY_ANSWER', 'QUERY_CLOSE', 'QUERY_REOPEN', 'QUERY_CANCEL',
    'CRF_SAVE', 'CRF_SUBMIT', 'CRF_VERIFY', 'CRF_REVIEW', 'CRF_APPROVE', 'CRF_REJECT',
    'EXPORT', 'PRINT', 'DOWNLOAD',
    'USER_CREATE', 'USER_UPDATE', 'USER_DEACTIVATE', 'USER_ACTIVATE',
    'ROLE_CHANGE', 'PERMISSION_GRANT', 'PERMISSION_REVOKE',
    'STUDY_CREATE', 'STUDY_UPDATE', 'STUDY_LOCK', 'STUDY_CLOSE',
    'SITE_ACTIVATE', 'SITE_DEACTIVATE',
    'SUBJECT_ENROLL', 'SUBJECT_RANDOMIZE', 'SUBJECT_WITHDRAW', 'SUBJECT_COMPLETE',
    'SYSTEM_CONFIG', 'BACKUP', 'RESTORE', 'SYNC', 'CONFLICT_RESOLVE',
  ];

  return c.json({
    success: true,
    data: actions.map(action => ({
      value: action,
      label: getActionLabel(action as AuditAction),
      category: getActionCategory(action as AuditAction),
      severity: getActionSeverity(action as AuditAction),
    })),
  });
});

// GET /api/audit/tables - 테이블 목록
app.get('/tables', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const tables = [
    'users', 'studies', 'sites', 'subjects', 'visits',
    'crf_instances', 'crf_data', 'queries', 'signatures',
    'sessions', 'form_definitions', 'field_definitions',
    'visit_schedules', 'data_locks', 'audit_logs',
  ];

  return c.json({
    success: true,
    data: tables.map(table => ({
      value: table,
      label: getTableLabel(table),
    })),
  });
});

export default app;
