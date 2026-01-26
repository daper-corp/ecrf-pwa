// Data Lock/Freeze Routes
// Subject, Visit, Site, Study 레벨 데이터 잠금 API
// Created: 2026-01-26

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { generateId } from '../utils/id';
import { now } from '../utils/date';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// TYPES
// =====================================================

type LockType = 'SUBJECT' | 'VISIT' | 'SITE' | 'STUDY';

interface DataLock {
  id: string;
  lock_type: LockType;
  record_id: string;
  locked_by: string;
  locked_at: string;
  lock_reason: string | null;
  unlocked_by: string | null;
  unlocked_at: string | null;
  unlock_reason: string | null;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * 레코드 존재 여부 확인
 */
async function validateRecordExists(
  db: D1Database,
  lockType: LockType,
  recordId: string
): Promise<{ exists: boolean; studyId?: string; siteId?: string }> {
  let query: string;
  let result: any;

  switch (lockType) {
    case 'STUDY':
      query = 'SELECT id FROM studies WHERE id = ?';
      result = await db.prepare(query).bind(recordId).first();
      return { exists: !!result, studyId: recordId };

    case 'SITE':
      query = 'SELECT id, study_id FROM sites WHERE id = ?';
      result = await db.prepare(query).bind(recordId).first();
      return { exists: !!result, studyId: result?.study_id, siteId: recordId };

    case 'SUBJECT':
      query = `
        SELECT s.id, s.site_id, site.study_id 
        FROM subjects s 
        JOIN sites site ON s.site_id = site.id 
        WHERE s.id = ?
      `;
      result = await db.prepare(query).bind(recordId).first();
      return { exists: !!result, studyId: result?.study_id, siteId: result?.site_id };

    case 'VISIT':
      query = `
        SELECT v.id, sub.site_id, site.study_id
        FROM visits v
        JOIN subjects sub ON v.subject_id = sub.id
        JOIN sites site ON sub.site_id = site.id
        WHERE v.id = ?
      `;
      result = await db.prepare(query).bind(recordId).first();
      return { exists: !!result, studyId: result?.study_id, siteId: result?.site_id };

    default:
      return { exists: false };
  }
}

/**
 * 상위 레벨 잠금 확인
 */
async function checkParentLocks(
  db: D1Database,
  lockType: LockType,
  recordId: string
): Promise<DataLock | null> {
  // Study는 최상위이므로 상위 잠금 없음
  if (lockType === 'STUDY') {
    return null;
  }

  const validation = await validateRecordExists(db, lockType, recordId);
  if (!validation.exists) return null;

  // Study 레벨 잠금 확인
  if (validation.studyId) {
    const studyLock = await db.prepare(`
      SELECT * FROM data_locks 
      WHERE lock_type = 'STUDY' AND record_id = ? AND unlocked_at IS NULL
    `).bind(validation.studyId).first<DataLock>();
    if (studyLock) return studyLock;
  }

  // Site 레벨 잠금 확인 (Subject, Visit인 경우)
  if (lockType !== 'SITE' && validation.siteId) {
    const siteLock = await db.prepare(`
      SELECT * FROM data_locks 
      WHERE lock_type = 'SITE' AND record_id = ? AND unlocked_at IS NULL
    `).bind(validation.siteId).first<DataLock>();
    if (siteLock) return siteLock;
  }

  // Subject 레벨 잠금 확인 (Visit인 경우)
  if (lockType === 'VISIT') {
    const visit = await db.prepare('SELECT subject_id FROM visits WHERE id = ?')
      .bind(recordId).first<{ subject_id: string }>();
    if (visit) {
      const subjectLock = await db.prepare(`
        SELECT * FROM data_locks 
        WHERE lock_type = 'SUBJECT' AND record_id = ? AND unlocked_at IS NULL
      `).bind(visit.subject_id).first<DataLock>();
      if (subjectLock) return subjectLock;
    }
  }

  return null;
}

/**
 * 잠금 상태 확인 (데이터 수정 시 사용)
 */
async function isRecordLocked(
  db: D1Database,
  lockType: LockType,
  recordId: string
): Promise<{ locked: boolean; lock?: DataLock }> {
  // 직접 잠금 확인
  const directLock = await db.prepare(`
    SELECT * FROM data_locks 
    WHERE lock_type = ? AND record_id = ? AND unlocked_at IS NULL
  `).bind(lockType, recordId).first<DataLock>();

  if (directLock) {
    return { locked: true, lock: directLock };
  }

  // 상위 레벨 잠금 확인
  const parentLock = await checkParentLocks(db, lockType, recordId);
  if (parentLock) {
    return { locked: true, lock: parentLock };
  }

  return { locked: false };
}

// =====================================================
// API ROUTES
// =====================================================

// GET /api/locks - 잠금 목록 조회
app.get('/', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id, site_id, lock_type, include_unlocked } = c.req.query();
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let query = 'SELECT * FROM data_locks WHERE 1=1';
    const params: any[] = [];

    if (lock_type) {
      query += ' AND lock_type = ?';
      params.push(lock_type);
    }

    if (!include_unlocked || include_unlocked !== 'true') {
      query += ' AND unlocked_at IS NULL';
    }

    query += ' ORDER BY locked_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const locks = await c.env.DB.prepare(query).bind(...params).all();

    // 각 잠금에 대한 추가 정보 조회
    const enrichedLocks = await Promise.all(
      (locks.results as DataLock[]).map(async (lock) => {
        let recordName = '';
        let additionalInfo: any = {};

        switch (lock.lock_type) {
          case 'STUDY':
            const study = await c.env.DB.prepare('SELECT protocol_number, short_title FROM studies WHERE id = ?')
              .bind(lock.record_id).first<any>();
            recordName = study ? `${study.protocol_number} - ${study.short_title}` : lock.record_id;
            break;
          case 'SITE':
            const site = await c.env.DB.prepare('SELECT site_number, name FROM sites WHERE id = ?')
              .bind(lock.record_id).first<any>();
            recordName = site ? `${site.site_number} - ${site.name}` : lock.record_id;
            break;
          case 'SUBJECT':
            const subject = await c.env.DB.prepare('SELECT subject_number FROM subjects WHERE id = ?')
              .bind(lock.record_id).first<any>();
            recordName = subject?.subject_number || lock.record_id;
            break;
          case 'VISIT':
            const visit = await c.env.DB.prepare(`
              SELECT v.visit_name, s.subject_number 
              FROM visits v 
              JOIN subjects s ON v.subject_id = s.id 
              WHERE v.id = ?
            `).bind(lock.record_id).first<any>();
            recordName = visit ? `${visit.subject_number} - ${visit.visit_name}` : lock.record_id;
            break;
        }

        // 잠금한 사용자 정보
        const lockedByUser = await c.env.DB.prepare('SELECT name, role FROM users WHERE id = ?')
          .bind(lock.locked_by).first<any>();

        return {
          ...lock,
          record_name: recordName,
          locked_by_name: lockedByUser?.name,
          locked_by_role: lockedByUser?.role
        };
      })
    );

    // 총 개수 조회
    let countQuery = 'SELECT COUNT(*) as total FROM data_locks WHERE 1=1';
    const countParams: any[] = [];
    if (lock_type) {
      countQuery += ' AND lock_type = ?';
      countParams.push(lock_type);
    }
    if (!include_unlocked || include_unlocked !== 'true') {
      countQuery += ' AND unlocked_at IS NULL';
    }

    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();

    return c.json({
      data: enrichedLocks,
      total: countResult?.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error('Get locks error:', error);
    return c.json({ error: '잠금 목록 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/locks/check - 특정 레코드의 잠금 상태 확인
app.get('/check', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { lock_type, record_id } = c.req.query();

    if (!lock_type || !record_id) {
      return c.json({ error: 'lock_type과 record_id가 필요합니다.' }, 400);
    }

    const result = await isRecordLocked(c.env.DB, lock_type as LockType, record_id);

    if (result.locked && result.lock) {
      // 잠금한 사용자 정보 조회
      const lockedByUser = await c.env.DB.prepare('SELECT name, role FROM users WHERE id = ?')
        .bind(result.lock.locked_by).first<any>();

      return c.json({
        locked: true,
        lock: {
          ...result.lock,
          locked_by_name: lockedByUser?.name,
          locked_by_role: lockedByUser?.role
        }
      });
    }

    return c.json({ locked: false });
  } catch (error: any) {
    console.error('Check lock error:', error);
    return c.json({ error: '잠금 상태 확인 실패', details: error?.message }, 500);
  }
});

// POST /api/locks - 데이터 잠금 (DM만 가능)
app.post('/', requireRole('DM', 'ADMIN'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const body = await c.req.json();
    const { lock_type, record_id, reason } = body;

    // 유효성 검사
    if (!lock_type || !record_id) {
      return c.json({ error: 'lock_type과 record_id가 필요합니다.' }, 400);
    }

    if (!['STUDY', 'SITE', 'SUBJECT', 'VISIT'].includes(lock_type)) {
      return c.json({ error: '유효하지 않은 lock_type입니다.' }, 400);
    }

    // 레코드 존재 여부 확인
    const validation = await validateRecordExists(c.env.DB, lock_type, record_id);
    if (!validation.exists) {
      return c.json({ error: '해당 레코드를 찾을 수 없습니다.' }, 404);
    }

    // 이미 잠금되어 있는지 확인
    const existingLock = await c.env.DB.prepare(`
      SELECT * FROM data_locks 
      WHERE lock_type = ? AND record_id = ? AND unlocked_at IS NULL
    `).bind(lock_type, record_id).first<DataLock>();

    if (existingLock) {
      return c.json({ error: '이미 잠금된 레코드입니다.' }, 409);
    }

    // 상위 레벨이 잠금되어 있는지 확인
    const parentLock = await checkParentLocks(c.env.DB, lock_type, record_id);
    if (parentLock) {
      return c.json({ 
        error: '상위 레벨이 이미 잠금되어 있습니다.',
        parent_lock: {
          lock_type: parentLock.lock_type,
          record_id: parentLock.record_id,
          locked_at: parentLock.locked_at
        }
      }, 409);
    }

    // 잠금 생성
    const lockId = generateId('lock');
    const timestamp = now();

    await c.env.DB.prepare(`
      INSERT INTO data_locks (id, lock_type, record_id, locked_by, locked_at, lock_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(lockId, lock_type, record_id, user.userId, timestamp, reason || null).run();

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
      studyId: validation.studyId,
      siteId: validation.siteId
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'LOCK',
      tableName: 'data_locks',
      recordId: lockId,
      newValue: JSON.stringify({ lock_type, record_id, reason })
    });

    return c.json({
      message: '데이터가 잠금되었습니다.',
      lock: {
        id: lockId,
        lock_type,
        record_id,
        locked_by: user.userId,
        locked_at: timestamp,
        lock_reason: reason
      }
    }, 201);
  } catch (error: any) {
    console.error('Create lock error:', error);
    return c.json({ error: '데이터 잠금 실패', details: error?.message }, 500);
  }
});

// DELETE /api/locks/:id - 잠금 해제 (DM만 가능)
app.delete('/:id', requireRole('DM', 'ADMIN'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const lockId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { reason } = body;

    // 잠금 조회
    const lock = await c.env.DB.prepare(`
      SELECT * FROM data_locks WHERE id = ? AND unlocked_at IS NULL
    `).bind(lockId).first<DataLock>();

    if (!lock) {
      return c.json({ error: '활성 잠금을 찾을 수 없습니다.' }, 404);
    }

    // 잠금 해제
    const timestamp = now();

    await c.env.DB.prepare(`
      UPDATE data_locks 
      SET unlocked_by = ?, unlocked_at = ?, unlock_reason = ?
      WHERE id = ?
    `).bind(user.userId, timestamp, reason || null, lockId).run();

    // 레코드 정보 조회 (감사 로그용)
    const validation = await validateRecordExists(c.env.DB, lock.lock_type as LockType, lock.record_id);

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
      studyId: validation.studyId,
      siteId: validation.siteId
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'UNLOCK',
      tableName: 'data_locks',
      recordId: lockId,
      oldValue: JSON.stringify({ lock_type: lock.lock_type, record_id: lock.record_id }),
      newValue: JSON.stringify({ unlocked_at: timestamp, unlock_reason: reason })
    });

    return c.json({
      message: '잠금이 해제되었습니다.',
      unlock: {
        id: lockId,
        unlocked_by: user.userId,
        unlocked_at: timestamp,
        unlock_reason: reason
      }
    });
  } catch (error: any) {
    console.error('Unlock error:', error);
    return c.json({ error: '잠금 해제 실패', details: error?.message }, 500);
  }
});

// POST /api/locks/bulk - 일괄 잠금 (DM만 가능)
app.post('/bulk', requireRole('DM', 'ADMIN'), async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const body = await c.req.json();
    const { lock_type, record_ids, reason } = body;

    if (!lock_type || !record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
      return c.json({ error: 'lock_type과 record_ids 배열이 필요합니다.' }, 400);
    }

    if (!['STUDY', 'SITE', 'SUBJECT', 'VISIT'].includes(lock_type)) {
      return c.json({ error: '유효하지 않은 lock_type입니다.' }, 400);
    }

    const timestamp = now();
    const results: { success: string[]; failed: { id: string; reason: string }[] } = {
      success: [],
      failed: []
    };

    for (const recordId of record_ids) {
      try {
        // 레코드 존재 여부 확인
        const validation = await validateRecordExists(c.env.DB, lock_type, recordId);
        if (!validation.exists) {
          results.failed.push({ id: recordId, reason: '레코드를 찾을 수 없음' });
          continue;
        }

        // 이미 잠금되어 있는지 확인
        const existingLock = await c.env.DB.prepare(`
          SELECT id FROM data_locks 
          WHERE lock_type = ? AND record_id = ? AND unlocked_at IS NULL
        `).bind(lock_type, recordId).first();

        if (existingLock) {
          results.failed.push({ id: recordId, reason: '이미 잠금됨' });
          continue;
        }

        // 잠금 생성
        const lockId = generateId('lock');
        await c.env.DB.prepare(`
          INSERT INTO data_locks (id, lock_type, record_id, locked_by, locked_at, lock_reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(lockId, lock_type, recordId, user.userId, timestamp, reason || null).run();

        results.success.push(recordId);
      } catch (err) {
        results.failed.push({ id: recordId, reason: '처리 중 오류' });
      }
    }

    // 감사 로그
    if (results.success.length > 0) {
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
        sessionId: user.sessionId
      };

      await createAuditLog(c.env.DB, auditContext, {
        action: 'BULK_LOCK',
        tableName: 'data_locks',
        recordId: 'bulk',
        newValue: JSON.stringify({ lock_type, count: results.success.length, reason })
      });
    }

    return c.json({
      message: `${results.success.length}개 잠금 완료, ${results.failed.length}개 실패`,
      results
    });
  } catch (error: any) {
    console.error('Bulk lock error:', error);
    return c.json({ error: '일괄 잠금 실패', details: error?.message }, 500);
  }
});

// GET /api/locks/stats - 잠금 통계
app.get('/stats', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    // 타입별 활성 잠금 수
    const byType = await c.env.DB.prepare(`
      SELECT lock_type, COUNT(*) as count
      FROM data_locks
      WHERE unlocked_at IS NULL
      GROUP BY lock_type
    `).all();

    // 총 활성 잠금 수
    const total = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM data_locks WHERE unlocked_at IS NULL
    `).first<{ count: number }>();

    // 최근 잠금 활동
    const recentActivity = await c.env.DB.prepare(`
      SELECT 
        dl.*,
        u.name as locked_by_name
      FROM data_locks dl
      JOIN users u ON dl.locked_by = u.id
      ORDER BY COALESCE(dl.unlocked_at, dl.locked_at) DESC
      LIMIT 10
    `).all();

    return c.json({
      total_active_locks: total?.count || 0,
      by_type: byType.results || [],
      recent_activity: recentActivity.results || []
    });
  } catch (error: any) {
    console.error('Lock stats error:', error);
    return c.json({ error: '통계 조회 실패', details: error?.message }, 500);
  }
});

export default app;
export { isRecordLocked };
