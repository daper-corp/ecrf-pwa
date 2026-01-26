// Reports & Dashboard API
// 등록 현황, Query 통계, 진행률 차트 데이터 API
// Created: 2026-01-26

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';
import { hasPermission } from '../middleware/rbac';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// ENROLLMENT REPORTS
// =====================================================

// GET /api/reports/enrollment/summary - 등록 현황 요약
app.get('/enrollment/summary', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // 전체 등록 현황
    const totalStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_subjects,
        SUM(CASE WHEN s.status = 'SCREENING' THEN 1 ELSE 0 END) as screening,
        SUM(CASE WHEN s.status = 'SCREEN_FAILED' THEN 1 ELSE 0 END) as screen_failed,
        SUM(CASE WHEN s.status = 'ENROLLED' THEN 1 ELSE 0 END) as enrolled,
        SUM(CASE WHEN s.status = 'RANDOMIZED' THEN 1 ELSE 0 END) as randomized,
        SUM(CASE WHEN s.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN s.status = 'WITHDRAWN' THEN 1 ELSE 0 END) as withdrawn,
        SUM(CASE WHEN s.status IN ('ENROLLED', 'RANDOMIZED', 'COMPLETED') THEN 1 ELSE 0 END) as active
      FROM subjects s
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first();

    // Study 정보 조회
    const study = await c.env.DB.prepare(`
      SELECT id, title, short_title, status 
      FROM studies WHERE id = ?
    `).bind(study_id).first<any>();

    // Site별 등록 현황
    const siteStats = await c.env.DB.prepare(`
      SELECT 
        site.id,
        site.site_number,
        site.name as site_name,
        COUNT(s.id) as total_subjects,
        SUM(CASE WHEN s.status IN ('ENROLLED', 'RANDOMIZED', 'COMPLETED') THEN 1 ELSE 0 END) as active_subjects,
        SUM(CASE WHEN s.status = 'SCREENING' THEN 1 ELSE 0 END) as screening,
        SUM(CASE WHEN s.status = 'SCREEN_FAILED' THEN 1 ELSE 0 END) as screen_failed
      FROM sites site
      LEFT JOIN subjects s ON s.site_id = site.id
      WHERE site.study_id = ?
      GROUP BY site.id
      ORDER BY site.site_number
    `).bind(study_id).all();

    const targetEnrollment = 100; // Default target, can be configured per study
    const currentEnrollment = (totalStats as any)?.active || 0;
    const enrollmentRate = targetEnrollment > 0 ? Math.round((currentEnrollment / targetEnrollment) * 100) : 0;

    return c.json({
      study: {
        id: study_id,
        title: study?.title,
        target_enrollment: targetEnrollment,
        current_enrollment: currentEnrollment,
        enrollment_rate: enrollmentRate
      },
      summary: totalStats,
      by_site: siteStats.results
    });
  } catch (error: any) {
    console.error('Enrollment summary error:', error);
    return c.json({ error: '등록 현황 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/reports/enrollment/trend - 등록 추이 (시계열)
app.get('/enrollment/trend', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id, period = 'monthly' } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // 기간별 등록 추이
    let dateFormat: string;
    switch (period) {
      case 'daily':
        dateFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        dateFormat = '%Y-W%W';
        break;
      case 'monthly':
      default:
        dateFormat = '%Y-%m';
    }

    const trend = await c.env.DB.prepare(`
      SELECT 
        strftime('${dateFormat}', s.created_at) as period,
        COUNT(*) as new_subjects,
        SUM(CASE WHEN s.status IN ('ENROLLED', 'RANDOMIZED', 'COMPLETED') THEN 1 ELSE 0 END) as enrolled
      FROM subjects s
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
      GROUP BY strftime('${dateFormat}', s.created_at)
      ORDER BY period
    `).bind(study_id).all();

    // 누적 계산
    let cumulative = 0;
    const trendData = (trend.results as any[]).map(t => {
      cumulative += t.new_subjects;
      return {
        ...t,
        cumulative_subjects: cumulative
      };
    });

    return c.json({
      study_id,
      period,
      trend: trendData
    });
  } catch (error: any) {
    console.error('Enrollment trend error:', error);
    return c.json({ error: '등록 추이 조회 실패', details: error?.message }, 500);
  }
});

// =====================================================
// QUERY REPORTS
// =====================================================

// GET /api/reports/queries/summary - Query 통계 요약
app.get('/queries/summary', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Query 상태별 통계
    const queryStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_queries,
        SUM(CASE WHEN q.status = 'OPEN' THEN 1 ELSE 0 END) as open_queries,
        SUM(CASE WHEN q.status = 'ANSWERED' THEN 1 ELSE 0 END) as answered_queries,
        SUM(CASE WHEN q.status = 'CLOSED' THEN 1 ELSE 0 END) as closed_queries,
        SUM(CASE WHEN q.status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_queries,
        SUM(CASE WHEN q.priority = 'CRITICAL' THEN 1 ELSE 0 END) as critical_queries,
        SUM(CASE WHEN q.priority = 'MAJOR' THEN 1 ELSE 0 END) as major_queries,
        SUM(CASE WHEN q.priority = 'MINOR' THEN 1 ELSE 0 END) as minor_queries,
        SUM(CASE WHEN q.status = 'OPEN' AND q.due_date < date('now') THEN 1 ELSE 0 END) as overdue_queries
      FROM queries q
      JOIN crf_instances ci ON q.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first();

    // Site별 Query 통계
    const siteQueryStats = await c.env.DB.prepare(`
      SELECT 
        site.id,
        site.site_number,
        site.name as site_name,
        COUNT(q.id) as total_queries,
        SUM(CASE WHEN q.status = 'OPEN' THEN 1 ELSE 0 END) as open_queries,
        SUM(CASE WHEN q.status = 'CLOSED' THEN 1 ELSE 0 END) as closed_queries
      FROM sites site
      LEFT JOIN subjects s ON s.site_id = site.id
      LEFT JOIN visits v ON v.subject_id = s.id
      LEFT JOIN crf_instances ci ON ci.visit_id = v.id
      LEFT JOIN queries q ON q.crf_instance_id = ci.id
      WHERE site.study_id = ?
      GROUP BY site.id
      ORDER BY site.site_number
    `).bind(study_id).all();

    // Category별 Query 통계
    const categoryStats = await c.env.DB.prepare(`
      SELECT 
        q.category,
        COUNT(*) as count,
        SUM(CASE WHEN q.status = 'OPEN' THEN 1 ELSE 0 END) as open_count
      FROM queries q
      JOIN crf_instances ci ON q.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
      GROUP BY q.category
    `).bind(study_id).all();

    return c.json({
      study_id,
      summary: queryStats,
      by_site: siteQueryStats.results,
      by_category: categoryStats.results
    });
  } catch (error: any) {
    console.error('Query summary error:', error);
    return c.json({ error: 'Query 통계 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/reports/queries/aging - Query Aging Report
app.get('/queries/aging', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Aging 분류 (0-7일, 8-14일, 15-30일, 30일+)
    const aging = await c.env.DB.prepare(`
      SELECT 
        CASE 
          WHEN julianday('now') - julianday(q.created_at) <= 7 THEN '0-7 days'
          WHEN julianday('now') - julianday(q.created_at) <= 14 THEN '8-14 days'
          WHEN julianday('now') - julianday(q.created_at) <= 30 THEN '15-30 days'
          ELSE '30+ days'
        END as age_group,
        COUNT(*) as count,
        q.priority
      FROM queries q
      JOIN crf_instances ci ON q.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ? AND q.status = 'OPEN'
      GROUP BY age_group, q.priority
      ORDER BY 
        CASE age_group 
          WHEN '0-7 days' THEN 1 
          WHEN '8-14 days' THEN 2 
          WHEN '15-30 days' THEN 3 
          ELSE 4 
        END,
        CASE q.priority 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'MAJOR' THEN 2 
          ELSE 3 
        END
    `).bind(study_id).all();

    // Aging 요약
    const agingSummary: Record<string, { total: number; critical: number; major: number; minor: number }> = {
      '0-7 days': { total: 0, critical: 0, major: 0, minor: 0 },
      '8-14 days': { total: 0, critical: 0, major: 0, minor: 0 },
      '15-30 days': { total: 0, critical: 0, major: 0, minor: 0 },
      '30+ days': { total: 0, critical: 0, major: 0, minor: 0 }
    };

    for (const row of aging.results as any[]) {
      if (agingSummary[row.age_group]) {
        agingSummary[row.age_group].total += row.count;
        if (row.priority === 'CRITICAL') agingSummary[row.age_group].critical += row.count;
        else if (row.priority === 'MAJOR') agingSummary[row.age_group].major += row.count;
        else agingSummary[row.age_group].minor += row.count;
      }
    }

    return c.json({
      study_id,
      aging: agingSummary,
      raw_data: aging.results
    });
  } catch (error: any) {
    console.error('Query aging error:', error);
    return c.json({ error: 'Query Aging 조회 실패', details: error?.message }, 500);
  }
});

// =====================================================
// CRF PROGRESS REPORTS
// =====================================================

// GET /api/reports/crf/progress - CRF 진행률
app.get('/crf/progress', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // CRF 상태별 통계
    const crfStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_crfs,
        SUM(CASE WHEN ci.status = 'NOT_STARTED' THEN 1 ELSE 0 END) as not_started,
        SUM(CASE WHEN ci.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN ci.status = 'COMPLETE' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN ci.status = 'VERIFIED' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN ci.status = 'LOCKED' THEN 1 ELSE 0 END) as locked
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).first();

    // Form별 진행률
    const formProgress = await c.env.DB.prepare(`
      SELECT 
        ci.form_code,
        fd.form_name,
        COUNT(*) as total,
        SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) as completed,
        ROUND(SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as completion_rate
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      LEFT JOIN form_definitions fd ON fd.form_code = ci.form_code AND fd.study_id = site.study_id
      WHERE site.study_id = ?
      GROUP BY ci.form_code
      ORDER BY fd.form_order
    `).bind(study_id).all();

    // Visit별 진행률
    const visitProgress = await c.env.DB.prepare(`
      SELECT 
        vs.visit_name,
        vs.visit_number,
        COUNT(ci.id) as total_crfs,
        SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) as completed_crfs,
        ROUND(SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(ci.id), 0), 1) as completion_rate
      FROM visit_schedules vs
      LEFT JOIN visits v ON v.visit_name = vs.visit_name
      LEFT JOIN subjects s ON v.subject_id = s.id
      LEFT JOIN sites site ON s.site_id = site.id AND site.study_id = vs.study_id
      LEFT JOIN crf_instances ci ON ci.visit_id = v.id
      WHERE vs.study_id = ?
      GROUP BY vs.id
      ORDER BY vs.visit_number
    `).bind(study_id).all();

    // 전체 완료율 계산
    const totalCrfs = (crfStats as any)?.total_crfs || 0;
    const completedCrfs = ((crfStats as any)?.complete || 0) + 
                          ((crfStats as any)?.verified || 0) + 
                          ((crfStats as any)?.locked || 0);
    const overallCompletionRate = totalCrfs > 0 ? Math.round((completedCrfs / totalCrfs) * 100) : 0;

    return c.json({
      study_id,
      summary: {
        ...crfStats,
        overall_completion_rate: overallCompletionRate
      },
      by_form: formProgress.results,
      by_visit: visitProgress.results
    });
  } catch (error: any) {
    console.error('CRF progress error:', error);
    return c.json({ error: 'CRF 진행률 조회 실패', details: error?.message }, 500);
  }
});

// GET /api/reports/crf/missing - 미입력 CRF 리포트
app.get('/crf/missing', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id, site_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // 미입력 또는 진행 중인 CRF 목록
    let query = `
      SELECT 
        site.site_number,
        s.subject_number,
        v.visit_name,
        ci.form_code,
        ci.status,
        v.actual_date as visit_date,
        julianday('now') - julianday(v.actual_date) as days_since_visit
      FROM crf_instances ci
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ? 
        AND ci.status IN ('NOT_STARTED', 'IN_PROGRESS')
        AND v.actual_date IS NOT NULL
    `;
    const params: any[] = [study_id];

    if (site_id) {
      query += ' AND site.id = ?';
      params.push(site_id);
    }

    query += ' ORDER BY days_since_visit DESC, site.site_number, s.subject_number';

    const missingCrfs = await c.env.DB.prepare(query).bind(...params).all();

    // 기한 초과 분류
    const categorized = {
      critical: [] as any[],  // 30일 이상
      urgent: [] as any[],    // 14-30일
      normal: [] as any[]     // 14일 미만
    };

    for (const crf of missingCrfs.results as any[]) {
      if (crf.days_since_visit >= 30) {
        categorized.critical.push(crf);
      } else if (crf.days_since_visit >= 14) {
        categorized.urgent.push(crf);
      } else {
        categorized.normal.push(crf);
      }
    }

    return c.json({
      study_id,
      total_missing: missingCrfs.results?.length || 0,
      summary: {
        critical: categorized.critical.length,
        urgent: categorized.urgent.length,
        normal: categorized.normal.length
      },
      categorized
    });
  } catch (error: any) {
    console.error('Missing CRF error:', error);
    return c.json({ error: '미입력 CRF 조회 실패', details: error?.message }, 500);
  }
});

// =====================================================
// SITE PERFORMANCE REPORTS
// =====================================================

// GET /api/reports/sites/performance - Site 성과 리포트
app.get('/sites/performance', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Site별 종합 성과
    const sitePerformance = await c.env.DB.prepare(`
      SELECT 
        site.id,
        site.site_number,
        site.name as site_name,
        site.status as site_status,
        -- 등록 현황
        COUNT(DISTINCT s.id) as total_subjects,
        COUNT(DISTINCT CASE WHEN s.status IN ('ENROLLED', 'RANDOMIZED', 'COMPLETED') THEN s.id END) as active_subjects,
        COUNT(DISTINCT CASE WHEN s.status = 'SCREEN_FAILED' THEN s.id END) as screen_failures,
        -- CRF 현황
        COUNT(ci.id) as total_crfs,
        SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) as completed_crfs,
        ROUND(SUM(CASE WHEN ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED') THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(ci.id), 0), 1) as crf_completion_rate,
        -- Query 현황
        COUNT(q.id) as total_queries,
        SUM(CASE WHEN q.status = 'OPEN' THEN 1 ELSE 0 END) as open_queries,
        SUM(CASE WHEN q.status = 'OPEN' AND q.due_date < date('now') THEN 1 ELSE 0 END) as overdue_queries
      FROM sites site
      LEFT JOIN subjects s ON s.site_id = site.id
      LEFT JOIN visits v ON v.subject_id = s.id
      LEFT JOIN crf_instances ci ON ci.visit_id = v.id
      LEFT JOIN queries q ON q.crf_instance_id = ci.id
      WHERE site.study_id = ?
      GROUP BY site.id
      ORDER BY site.site_number
    `).bind(study_id).all();

    // 스크리닝 성공률 계산
    const results = (sitePerformance.results as any[]).map(site => ({
      ...site,
      screening_success_rate: site.total_subjects > 0 
        ? Math.round((site.active_subjects / site.total_subjects) * 100) 
        : 0
    }));

    // 전체 평균
    const totals = results.reduce((acc, site) => ({
      total_subjects: acc.total_subjects + site.total_subjects,
      active_subjects: acc.active_subjects + site.active_subjects,
      total_crfs: acc.total_crfs + site.total_crfs,
      completed_crfs: acc.completed_crfs + site.completed_crfs,
      total_queries: acc.total_queries + site.total_queries,
      open_queries: acc.open_queries + site.open_queries
    }), { total_subjects: 0, active_subjects: 0, total_crfs: 0, completed_crfs: 0, total_queries: 0, open_queries: 0 });

    const averages = {
      avg_subjects_per_site: results.length > 0 ? Math.round(totals.total_subjects / results.length) : 0,
      avg_crf_completion_rate: totals.total_crfs > 0 ? Math.round((totals.completed_crfs / totals.total_crfs) * 100) : 0,
      avg_open_queries_per_site: results.length > 0 ? Math.round(totals.open_queries / results.length * 10) / 10 : 0
    };

    return c.json({
      study_id,
      total_sites: results.length,
      averages,
      totals,
      sites: results
    });
  } catch (error: any) {
    console.error('Site performance error:', error);
    return c.json({ error: 'Site 성과 조회 실패', details: error?.message }, 500);
  }
});

// =====================================================
// DASHBOARD OVERVIEW
// =====================================================

// GET /api/reports/dashboard - 대시보드 종합 데이터
app.get('/dashboard', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();
    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Study 정보
    const study = await c.env.DB.prepare(`
      SELECT id, title, short_title, protocol_number, status,
             study_start_date, study_end_date
      FROM studies WHERE id = ?
    `).bind(study_id).first<any>();

    // 핵심 지표
    const metrics = await c.env.DB.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM sites WHERE study_id = ?) as total_sites,
        (SELECT COUNT(*) FROM sites WHERE study_id = ? AND status = 'ACTIVE') as active_sites,
        (SELECT COUNT(*) FROM subjects s JOIN sites site ON s.site_id = site.id WHERE site.study_id = ?) as total_subjects,
        (SELECT COUNT(*) FROM subjects s JOIN sites site ON s.site_id = site.id WHERE site.study_id = ? AND s.status IN ('ENROLLED', 'RANDOMIZED', 'COMPLETED')) as enrolled_subjects,
        (SELECT COUNT(*) FROM visits v JOIN subjects s ON v.subject_id = s.id JOIN sites site ON s.site_id = site.id WHERE site.study_id = ?) as total_visits,
        (SELECT COUNT(*) FROM crf_instances ci JOIN visits v ON ci.visit_id = v.id JOIN subjects s ON v.subject_id = s.id JOIN sites site ON s.site_id = site.id WHERE site.study_id = ?) as total_crfs,
        (SELECT COUNT(*) FROM crf_instances ci JOIN visits v ON ci.visit_id = v.id JOIN subjects s ON v.subject_id = s.id JOIN sites site ON s.site_id = site.id WHERE site.study_id = ? AND ci.status IN ('COMPLETE', 'VERIFIED', 'LOCKED')) as completed_crfs,
        (SELECT COUNT(*) FROM queries q JOIN crf_instances ci ON q.crf_instance_id = ci.id JOIN visits v ON ci.visit_id = v.id JOIN subjects s ON v.subject_id = s.id JOIN sites site ON s.site_id = site.id WHERE site.study_id = ?) as total_queries,
        (SELECT COUNT(*) FROM queries q JOIN crf_instances ci ON q.crf_instance_id = ci.id JOIN visits v ON ci.visit_id = v.id JOIN subjects s ON v.subject_id = s.id JOIN sites site ON s.site_id = site.id WHERE site.study_id = ? AND q.status = 'OPEN') as open_queries
    `).bind(study_id, study_id, study_id, study_id, study_id, study_id, study_id, study_id, study_id).first<any>();

    // 최근 활동 (최근 7일)
    const recentActivity = await c.env.DB.prepare(`
      SELECT 
        date(timestamp) as activity_date,
        COUNT(*) as activity_count
      FROM audit_logs
      WHERE study_id = ? AND timestamp >= date('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY activity_date DESC
    `).bind(study_id).all();

    // 알림/경고
    const alerts: any[] = [];

    // 오버듀 쿼리
    if ((metrics as any)?.open_queries > 0) {
      const overdueCount = await c.env.DB.prepare(`
        SELECT COUNT(*) as count
        FROM queries q
        JOIN crf_instances ci ON q.crf_instance_id = ci.id
        JOIN visits v ON ci.visit_id = v.id
        JOIN subjects s ON v.subject_id = s.id
        JOIN sites site ON s.site_id = site.id
        WHERE site.study_id = ? AND q.status = 'OPEN' AND q.due_date < date('now')
      `).bind(study_id).first<{ count: number }>();
      
      if (overdueCount && overdueCount.count > 0) {
        alerts.push({
          type: 'warning',
          message: `${overdueCount.count}개의 쿼리가 기한 초과되었습니다.`,
          count: overdueCount.count
        });
      }
    }

    // 등록률 확인
    const targetEnrollment = 100; // Default target
    const currentEnrollment = (metrics as any)?.enrolled_subjects || 0;
    if (targetEnrollment > 0) {
      const enrollmentRate = Math.round((currentEnrollment / targetEnrollment) * 100);
      if (enrollmentRate < 50) {
        alerts.push({
          type: 'info',
          message: `등록 진행률이 ${enrollmentRate}%입니다. 목표: ${targetEnrollment}명`,
          rate: enrollmentRate
        });
      }
    }

    // 계산된 지표
    const totalCrfs = (metrics as any)?.total_crfs || 0;
    const completedCrfs = (metrics as any)?.completed_crfs || 0;
    const crfCompletionRate = totalCrfs > 0 ? Math.round((completedCrfs / totalCrfs) * 100) : 0;

    return c.json({
      study: {
        id: study_id,
        title: study?.title,
        short_title: study?.short_title,
        protocol_number: study?.protocol_number,
        status: study?.status,
        target_enrollment: targetEnrollment
      },
      metrics: {
        ...metrics,
        enrollment_rate: targetEnrollment > 0 ? Math.round((currentEnrollment / targetEnrollment) * 100) : 0,
        crf_completion_rate: crfCompletionRate
      },
      recent_activity: recentActivity.results,
      alerts
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return c.json({ error: '대시보드 조회 실패', details: error?.message }, 500);
  }
});

export default app;
