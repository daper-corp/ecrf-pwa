// Electronic Signature Routes
// 전자서명 관련 API 라우트 (21 CFR Part 11)

import { Hono } from 'hono';
import type { Bindings, Variables, ElectronicSignature } from '../types';
import { requireAuth, getAuthUser, getClientInfo } from '../middleware/auth';
import { requirePermission, hasPermission } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { verifyPassword, hashData } from '../utils/crypto';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const signatures = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 서명 의미 정의 (법적 문구)
const SIGNATURE_MEANINGS = {
  DATA_ENTRY_COMPLETE: '본인은 이 데이터가 정확하고 완전하게 입력되었음을 확인합니다.',
  DATA_REVIEW_COMPLETE: '본인은 이 데이터를 검토하였으며, 정확하고 완전함을 확인합니다.',
  INVESTIGATOR_APPROVAL: '본인은 책임연구자로서 이 데이터가 프로토콜에 따라 정확하게 수집되었음을 승인합니다.',
  DATA_LOCK: '본인은 이 데이터를 잠금 처리하며, 추가 수정이 필요한 경우 적절한 권한을 가진 담당자의 승인이 필요함을 확인합니다.',
  QUERY_RESOLUTION: '본인은 이 Query에 대한 답변이 정확함을 확인합니다.',
};

/**
 * POST /api/signatures/crf/:crfInstanceId
 * CRF 전자서명
 */
signatures.post('/crf/:crfInstanceId', requireAuth, requirePermission('SIGN_CRF'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const crfInstanceId = c.req.param('crfInstanceId');
    const body = await c.req.json();
    const { password, signature_meaning, signature_reason } = body;

    if (!password) {
      return c.json({ success: false, error: '서명을 위해 비밀번호를 입력해주세요.' }, 400);
    }

    // 사용자 비밀번호 확인
    const dbUser = await c.env.DB.prepare(`
      SELECT password_hash FROM users WHERE id = ?
    `).bind(user.userId).first<{ password_hash: string }>();

    if (!dbUser) {
      return c.json({ success: false, error: '사용자 정보를 찾을 수 없습니다.' }, 404);
    }

    const isValidPassword = await verifyPassword(password, dbUser.password_hash);
    if (!isValidPassword) {
      return c.json({ success: false, error: '비밀번호가 올바르지 않습니다.' }, 401);
    }

    // CRF Instance 확인
    const crfInstance = await c.env.DB.prepare(`
      SELECT ci.*, v.subject_id, s.site_id, si.study_id
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites si ON s.site_id = si.id
      WHERE ci.id = ?
    `).bind(crfInstanceId).first();

    if (!crfInstance) {
      return c.json({ success: false, error: 'CRF를 찾을 수 없습니다.' }, 404);
    }

    if ((crfInstance as any).status === 'SIGNED') {
      return c.json({ success: false, error: '이미 서명된 CRF입니다.' }, 400);
    }

    if ((crfInstance as any).status !== 'COMPLETE') {
      return c.json({ success: false, error: '완료된 CRF만 서명할 수 있습니다.' }, 400);
    }

    // CRF 데이터 해시 생성 (무결성 검증용)
    const crfData = await c.env.DB.prepare(`
      SELECT field_code, field_value FROM crf_data 
      WHERE crf_instance_id = ? ORDER BY field_code
    `).bind(crfInstanceId).all();

    const dataString = JSON.stringify(crfData.results);
    const dataHash = await hashData(dataString);

    const timestamp = now();
    const signatureId = generateId('sig');
    const meaningText = signature_meaning || SIGNATURE_MEANINGS.INVESTIGATOR_APPROVAL;
    const { ipAddress, userAgent } = getClientInfo(c);

    // 전자서명 저장
    await c.env.DB.prepare(`
      INSERT INTO electronic_signatures (
        id, user_id, record_type, record_id, 
        signature_meaning, signature_reason,
        ip_address, user_agent, data_hash, created_at
      ) VALUES (?, ?, 'CRF_INSTANCE', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signatureId, user.userId, crfInstanceId,
      meaningText, signature_reason ?? null,
      ipAddress ?? null, userAgent ?? null, dataHash, timestamp
    ).run();

    // CRF 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE crf_instances SET 
        status = 'SIGNED', 
        signed_by = ?, 
        signed_at = ?, 
        signature_meaning = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(user.userId, timestamp, meaningText, timestamp, crfInstanceId).run();

    // Audit Log
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: (crfInstance as any).study_id,
      siteId: (crfInstance as any).site_id,
      subjectId: (crfInstance as any).subject_id,
    }, {
      action: 'SIGN',
      tableName: 'crf_instances',
      recordId: crfInstanceId,
      fieldName: 'status',
      oldValue: 'COMPLETE',
      newValue: 'SIGNED',
    });

    return c.json({
      success: true,
      message: 'CRF가 서명되었습니다.',
      data: {
        signatureId,
        signedAt: timestamp,
        signedBy: user.name,
        dataHash,
      },
    });
  } catch (error) {
    console.error('Sign CRF error:', error);
    return c.json({ success: false, error: 'CRF 서명 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/signatures/lock/:type/:recordId
 * 데이터 잠금 서명 (Subject, Visit, Site, Study)
 */
signatures.post('/lock/:type/:recordId', requireAuth, requirePermission('LOCK_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const lockType = c.req.param('type').toUpperCase();
    const recordId = c.req.param('recordId');
    const body = await c.req.json();
    const { password, lock_reason } = body;

    if (!['SUBJECT', 'VISIT', 'SITE', 'STUDY'].includes(lockType)) {
      return c.json({ success: false, error: '유효하지 않은 잠금 유형입니다.' }, 400);
    }

    if (!password) {
      return c.json({ success: false, error: '잠금을 위해 비밀번호를 입력해주세요.' }, 400);
    }

    // 사용자 비밀번호 확인
    const dbUser = await c.env.DB.prepare(`
      SELECT password_hash FROM users WHERE id = ?
    `).bind(user.userId).first<{ password_hash: string }>();

    if (!dbUser) {
      return c.json({ success: false, error: '사용자 정보를 찾을 수 없습니다.' }, 404);
    }

    const isValidPassword = await verifyPassword(password, dbUser.password_hash);
    if (!isValidPassword) {
      return c.json({ success: false, error: '비밀번호가 올바르지 않습니다.' }, 401);
    }

    // 이미 잠금되어 있는지 확인
    const existingLock = await c.env.DB.prepare(`
      SELECT id FROM data_locks WHERE lock_type = ? AND record_id = ? AND unlocked_at IS NULL
    `).bind(lockType, recordId).first();

    if (existingLock) {
      return c.json({ success: false, error: '이미 잠금된 데이터입니다.' }, 400);
    }

    const timestamp = now();
    const lockId = generateId('lock');
    const signatureId = generateId('sig');
    const { ipAddress, userAgent } = getClientInfo(c);

    // 레코드 존재 확인 및 컨텍스트 정보 가져오기
    let studyId: string | null = null;
    let siteId: string | null = null;
    let subjectId: string | null = null;

    if (lockType === 'STUDY') {
      const study = await c.env.DB.prepare(`SELECT id FROM studies WHERE id = ?`).bind(recordId).first();
      if (!study) return c.json({ success: false, error: 'Study를 찾을 수 없습니다.' }, 404);
      studyId = recordId;
    } else if (lockType === 'SITE') {
      const site = await c.env.DB.prepare(`SELECT id, study_id FROM sites WHERE id = ?`).bind(recordId).first();
      if (!site) return c.json({ success: false, error: 'Site를 찾을 수 없습니다.' }, 404);
      studyId = (site as any).study_id;
      siteId = recordId;
    } else if (lockType === 'SUBJECT') {
      const subject = await c.env.DB.prepare(`
        SELECT s.id, s.site_id, si.study_id FROM subjects s
        JOIN sites si ON s.site_id = si.id WHERE s.id = ?
      `).bind(recordId).first();
      if (!subject) return c.json({ success: false, error: 'Subject를 찾을 수 없습니다.' }, 404);
      studyId = (subject as any).study_id;
      siteId = (subject as any).site_id;
      subjectId = recordId;
    } else if (lockType === 'VISIT') {
      const visit = await c.env.DB.prepare(`
        SELECT v.id, v.subject_id, s.site_id, si.study_id FROM visits v
        JOIN subjects s ON v.subject_id = s.id
        JOIN sites si ON s.site_id = si.id WHERE v.id = ?
      `).bind(recordId).first();
      if (!visit) return c.json({ success: false, error: 'Visit를 찾을 수 없습니다.' }, 404);
      studyId = (visit as any).study_id;
      siteId = (visit as any).site_id;
      subjectId = (visit as any).subject_id;
    }

    // 데이터 잠금 생성
    await c.env.DB.prepare(`
      INSERT INTO data_locks (id, lock_type, record_id, locked_by, locked_at, lock_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(lockId, lockType, recordId, user.userId, timestamp, lock_reason ?? null).run();

    // 전자서명 저장
    await c.env.DB.prepare(`
      INSERT INTO electronic_signatures (
        id, user_id, record_type, record_id, 
        signature_meaning, signature_reason,
        ip_address, user_agent, data_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signatureId, user.userId, `DATA_LOCK_${lockType}`, recordId,
      SIGNATURE_MEANINGS.DATA_LOCK, lock_reason ?? null,
      ipAddress ?? null, userAgent ?? null, '', timestamp
    ).run();

    // Audit Log
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
      studyId: studyId ?? undefined,
      siteId: siteId ?? undefined,
      subjectId: subjectId ?? undefined,
    }, {
      action: 'LOCK',
      tableName: 'data_locks',
      recordId: lockId,
      newValue: `${lockType} locked: ${recordId}`,
      reasonForChange: lock_reason,
    });

    return c.json({
      success: true,
      message: `${lockType}이(가) 잠금되었습니다.`,
      data: {
        lockId,
        lockedAt: timestamp,
        lockedBy: user.name,
      },
    });
  } catch (error) {
    console.error('Lock data error:', error);
    return c.json({ success: false, error: '데이터 잠금 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * POST /api/signatures/unlock/:type/:recordId
 * 데이터 잠금 해제
 */
signatures.post('/unlock/:type/:recordId', requireAuth, requirePermission('UNLOCK_DATA'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const lockType = c.req.param('type').toUpperCase();
    const recordId = c.req.param('recordId');
    const body = await c.req.json();
    const { password, unlock_reason } = body;

    if (!password || !unlock_reason) {
      return c.json({ success: false, error: '비밀번호와 해제 사유는 필수입니다.' }, 400);
    }

    // 사용자 비밀번호 확인
    const dbUser = await c.env.DB.prepare(`
      SELECT password_hash FROM users WHERE id = ?
    `).bind(user.userId).first<{ password_hash: string }>();

    if (!dbUser) {
      return c.json({ success: false, error: '사용자 정보를 찾을 수 없습니다.' }, 404);
    }

    const isValidPassword = await verifyPassword(password, dbUser.password_hash);
    if (!isValidPassword) {
      return c.json({ success: false, error: '비밀번호가 올바르지 않습니다.' }, 401);
    }

    // 잠금 레코드 확인
    const lock = await c.env.DB.prepare(`
      SELECT * FROM data_locks WHERE lock_type = ? AND record_id = ? AND unlocked_at IS NULL
    `).bind(lockType, recordId).first();

    if (!lock) {
      return c.json({ success: false, error: '잠금된 데이터를 찾을 수 없습니다.' }, 404);
    }

    const timestamp = now();
    const { ipAddress, userAgent } = getClientInfo(c);

    // 잠금 해제
    await c.env.DB.prepare(`
      UPDATE data_locks SET 
        unlocked_by = ?, 
        unlocked_at = ?, 
        unlock_reason = ?
      WHERE id = ?
    `).bind(user.userId, timestamp, unlock_reason, (lock as any).id).run();

    // Audit Log
    await createAuditLog(c.env.DB, {
      user,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      sessionId: c.get('sessionId') ?? undefined,
    }, {
      action: 'UNLOCK',
      tableName: 'data_locks',
      recordId: (lock as any).id,
      oldValue: `${lockType} locked`,
      newValue: `${lockType} unlocked`,
      reasonForChange: unlock_reason,
    });

    return c.json({
      success: true,
      message: `${lockType}의 잠금이 해제되었습니다.`,
    });
  } catch (error) {
    console.error('Unlock data error:', error);
    return c.json({ success: false, error: '데이터 잠금 해제 중 오류가 발생했습니다.' }, 500);
  }
});

/**
 * GET /api/signatures/:recordType/:recordId
 * 서명 이력 조회
 */
signatures.get('/:recordType/:recordId', requireAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) return c.json({ success: false, error: '인증 정보가 없습니다.' }, 401);

    const recordType = c.req.param('recordType');
    const recordId = c.req.param('recordId');

    const signaturesResult = await c.env.DB.prepare(`
      SELECT es.*, u.name as signer_name, u.role as signer_role
      FROM electronic_signatures es
      JOIN users u ON es.user_id = u.id
      WHERE es.record_type = ? AND es.record_id = ?
      ORDER BY es.created_at DESC
    `).bind(recordType, recordId).all();

    return c.json({
      success: true,
      data: signaturesResult.results,
    });
  } catch (error) {
    console.error('Get signatures error:', error);
    return c.json({ success: false, error: '서명 이력 조회 중 오류가 발생했습니다.' }, 500);
  }
});

export default signatures;
