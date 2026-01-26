// Audit Trail Service
// 21 CFR Part 11 준수를 위한 감사 추적 서비스

import type { AuditAction, AuditLog, AuthPayload, Bindings } from '../types';
import { generateAuditId } from '../utils/id';
import { now } from '../utils/date';

export interface AuditContext {
  user: AuthPayload;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  studyId?: string;
  siteId?: string;
  subjectId?: string;
}

export interface AuditEntry {
  action: AuditAction;
  tableName: string;
  recordId: string;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string | null;
  reasonForChange?: string;
}

/**
 * 감사 로그 생성
 */
export async function createAuditLog(
  db: D1Database,
  context: AuditContext,
  entry: AuditEntry
): Promise<void> {
  const auditLog: AuditLog = {
    id: generateAuditId(),
    user_id: context.user.userId,
    user_name: context.user.name,
    user_role: context.user.role,
    timestamp: now(),
    action: entry.action,
    table_name: entry.tableName,
    record_id: entry.recordId,
    field_name: entry.fieldName ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    reason_for_change: entry.reasonForChange ?? null,
    ip_address: context.ipAddress ?? null,
    session_id: context.sessionId ?? null,
    user_agent: context.userAgent ?? null,
    study_id: context.studyId ?? null,
    site_id: context.siteId ?? null,
    subject_id: context.subjectId ?? null,
  };

  await db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, user_name, user_role, timestamp, action,
      table_name, record_id, field_name, old_value, new_value,
      reason_for_change, ip_address, session_id, user_agent,
      study_id, site_id, subject_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    auditLog.id,
    auditLog.user_id,
    auditLog.user_name,
    auditLog.user_role,
    auditLog.timestamp,
    auditLog.action,
    auditLog.table_name,
    auditLog.record_id,
    auditLog.field_name,
    auditLog.old_value,
    auditLog.new_value,
    auditLog.reason_for_change,
    auditLog.ip_address,
    auditLog.session_id,
    auditLog.user_agent,
    auditLog.study_id,
    auditLog.site_id,
    auditLog.subject_id
  ).run();
}

/**
 * 다중 필드 변경 감사 로그 생성
 */
export async function createBulkAuditLogs(
  db: D1Database,
  context: AuditContext,
  tableName: string,
  recordId: string,
  changes: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }>,
  reasonForChange?: string
): Promise<void> {
  for (const change of changes) {
    if (change.oldValue !== change.newValue) {
      await createAuditLog(db, context, {
        action: 'UPDATE',
        tableName,
        recordId,
        fieldName: change.fieldName,
        oldValue: change.oldValue,
        newValue: change.newValue,
        reasonForChange,
      });
    }
  }
}

/**
 * 특정 레코드의 변경 이력 조회
 */
export async function getRecordHistory(
  db: D1Database,
  tableName: string,
  recordId: string
): Promise<AuditLog[]> {
  const result = await db.prepare(`
    SELECT * FROM audit_logs
    WHERE table_name = ? AND record_id = ?
    ORDER BY timestamp DESC
  `).bind(tableName, recordId).all<AuditLog>();

  return result.results;
}

/**
 * 특정 필드의 변경 이력 조회
 */
export async function getFieldHistory(
  db: D1Database,
  tableName: string,
  recordId: string,
  fieldName: string
): Promise<AuditLog[]> {
  const result = await db.prepare(`
    SELECT * FROM audit_logs
    WHERE table_name = ? AND record_id = ? AND field_name = ?
    ORDER BY timestamp DESC
  `).bind(tableName, recordId, fieldName).all<AuditLog>();

  return result.results;
}

/**
 * 사용자별 활동 로그 조회
 */
export async function getUserActivityLogs(
  db: D1Database,
  userId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    actions?: AuditAction[];
    limit?: number;
    offset?: number;
  }
): Promise<{ logs: AuditLog[]; total: number }> {
  let query = `SELECT * FROM audit_logs WHERE user_id = ?`;
  let countQuery = `SELECT COUNT(*) as total FROM audit_logs WHERE user_id = ?`;
  const params: (string | number)[] = [userId];

  if (options?.startDate) {
    query += ` AND timestamp >= ?`;
    countQuery += ` AND timestamp >= ?`;
    params.push(options.startDate);
  }

  if (options?.endDate) {
    query += ` AND timestamp <= ?`;
    countQuery += ` AND timestamp <= ?`;
    params.push(options.endDate);
  }

  if (options?.actions && options.actions.length > 0) {
    const placeholders = options.actions.map(() => '?').join(',');
    query += ` AND action IN (${placeholders})`;
    countQuery += ` AND action IN (${placeholders})`;
    params.push(...options.actions);
  }

  query += ` ORDER BY timestamp DESC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const countResult = await db.prepare(countQuery).bind(...params.slice(0, -2)).first<{ total: number }>();
  const logsResult = await db.prepare(query).bind(...params).all<AuditLog>();

  return {
    logs: logsResult.results,
    total: countResult?.total ?? 0,
  };
}

/**
 * Study별 감사 로그 조회
 */
export async function getStudyAuditLogs(
  db: D1Database,
  studyId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ logs: AuditLog[]; total: number }> {
  let query = `SELECT * FROM audit_logs WHERE study_id = ?`;
  let countQuery = `SELECT COUNT(*) as total FROM audit_logs WHERE study_id = ?`;
  const params: (string | number)[] = [studyId];

  if (options?.startDate) {
    query += ` AND timestamp >= ?`;
    countQuery += ` AND timestamp >= ?`;
    params.push(options.startDate);
  }

  if (options?.endDate) {
    query += ` AND timestamp <= ?`;
    countQuery += ` AND timestamp <= ?`;
    params.push(options.endDate);
  }

  query += ` ORDER BY timestamp DESC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const countResult = await db.prepare(countQuery).bind(...params.slice(0, -2)).first<{ total: number }>();
  const logsResult = await db.prepare(query).bind(...params).all<AuditLog>();

  return {
    logs: logsResult.results,
    total: countResult?.total ?? 0,
  };
}

/**
 * 로그인/로그아웃 감사 로그 생성
 */
export async function logAuthEvent(
  db: D1Database,
  action: 'LOGIN' | 'LOGOUT',
  user: { userId: string; name: string; role: string },
  ipAddress?: string,
  userAgent?: string,
  sessionId?: string
): Promise<void> {
  const auditLog = {
    id: generateAuditId(),
    user_id: user.userId,
    user_name: user.name,
    user_role: user.role,
    timestamp: now(),
    action,
    table_name: 'sessions',
    record_id: sessionId ?? user.userId,
    ip_address: ipAddress ?? null,
    session_id: sessionId ?? null,
    user_agent: userAgent ?? null,
  };

  await db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, user_name, user_role, timestamp, action,
      table_name, record_id, ip_address, session_id, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    auditLog.id,
    auditLog.user_id,
    auditLog.user_name,
    auditLog.user_role,
    auditLog.timestamp,
    auditLog.action,
    auditLog.table_name,
    auditLog.record_id,
    auditLog.ip_address,
    auditLog.session_id,
    auditLog.user_agent
  ).run();
}
