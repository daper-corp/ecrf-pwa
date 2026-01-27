// eCRF PWA - Main Application Entry Point
// Hono Framework + Cloudflare Pages

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import studyRoutes from './routes/studies';
import siteRoutes from './routes/sites';
import subjectRoutes from './routes/subjects';
import visitRoutes from './routes/visits';
import queryRoutes from './routes/queries';
import signatureRoutes from './routes/signatures';
import editCheckRoutes from './routes/editchecks';
import lockRoutes from './routes/locks';
import exportRoutes from './routes/exports';
import cdiscRoutes from './routes/cdisc';
import reportRoutes from './routes/reports';
import twofaRoutes from './routes/twofa';
import notificationRoutes from './routes/notifications';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// MIDDLEWARE
// =====================================================

// CORS 설정
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400,
  credentials: true,
}));

// 로깅
app.use('/api/*', logger());

// 인증 미들웨어
app.use('/api/*', authMiddleware);

// =====================================================
// API ROUTES
// =====================================================

// 인증 API
app.route('/api/auth', authRoutes);

// Study API
app.route('/api/studies', studyRoutes);

// Site API (nested under studies)
app.route('/api/studies/:studyId/sites', siteRoutes);
app.route('/api/sites', siteRoutes);

// Subject API (nested under sites)
app.route('/api/sites/:siteId/subjects', subjectRoutes);
app.route('/api/subjects', subjectRoutes);

// Visit API (nested under subjects)
app.route('/api/subjects/:subjectId/visits', visitRoutes);
app.route('/api/visits', visitRoutes);

// Query API
app.route('/api/queries', queryRoutes);

// Signature API
app.route('/api/signatures', signatureRoutes);

// Edit Check API
app.route('/api/edit-checks', editCheckRoutes);

// Data Lock API
app.route('/api/locks', lockRoutes);

// Data Export API
app.route('/api/exports', exportRoutes);

// CDISC Export API (ODM/SDTM)
app.route('/api/cdisc', cdiscRoutes);

// Reports & Dashboard API
app.route('/api/reports', reportRoutes);

// Two-Factor Authentication API
app.route('/api/2fa', twofaRoutes);

// Push Notifications API
app.route('/api/notifications', notificationRoutes);

// Audit Log API
app.get('/api/audit/logs', async (c) => {
  const { getAuthUser } = await import('./middleware/auth');
  const { hasPermission } = await import('./middleware/rbac');
  
  const user = getAuthUser(c);
  if (!user) return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  if (!hasPermission(user.role, 'VIEW_AUDIT')) {
    return c.json({ success: false, error: '감사 로그 조회 권한이 없습니다.' }, 403);
  }

  const studyId = c.req.query('studyId');
  const siteId = c.req.query('siteId');
  const subjectId = c.req.query('subjectId');
  const tableName = c.req.query('tableName');
  const recordId = c.req.query('recordId');
  const action = c.req.query('action');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = `SELECT * FROM audit_logs WHERE 1=1`;
  const params: (string | number)[] = [];

  if (studyId) { query += ` AND study_id = ?`; params.push(studyId); }
  if (siteId) { query += ` AND site_id = ?`; params.push(siteId); }
  if (subjectId) { query += ` AND subject_id = ?`; params.push(subjectId); }
  if (tableName) { query += ` AND table_name = ?`; params.push(tableName); }
  if (recordId) { query += ` AND record_id = ?`; params.push(recordId); }
  if (action) { query += ` AND action = ?`; params.push(action); }
  if (startDate) { query += ` AND timestamp >= ?`; params.push(startDate); }
  if (endDate) { query += ` AND timestamp <= ?`; params.push(endDate); }

  query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const logs = await c.env.DB.prepare(query).bind(...params).all();

  return c.json({
    success: true,
    data: logs.results,
  });
});

// Health Check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

// =====================================================
// FRONTEND PAGES
// =====================================================

// HTML 템플릿 - Professional eCRF System with Medical-Grade UI
const htmlTemplate = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="eCRF - Electronic Case Report Form System | 21 CFR Part 11 Compliant | HIPAA Ready">
    <meta name="theme-color" content="#0c1222">
    <title>${title} - eCRF Clinical Data Management</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="stylesheet" href="/static/mobile.css">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              'sans': ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
            },
            colors: {
              'clinical': { 
                50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 
                400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 
                800: '#075985', 900: '#0c4a6e', 950: '#082f49' 
              },
              'medical': { 
                50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
                400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
                800: '#1e293b', 900: '#0f172a', 950: '#020617'
              },
              'success': { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 500: '#10b981', 600: '#059669', 700: '#047857' },
              'warning': { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 500: '#f59e0b', 600: '#d97706' },
              'danger': { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
              'query': { 50: '#fefce8', 100: '#fef9c3', 500: '#eab308', 600: '#ca8a04' },
              'locked': { 50: '#faf5ff', 100: '#f3e8ff', 500: '#a855f7', 600: '#9333ea' }
            }
          }
        }
      }
    </script>
    <style>
      * { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
      
      /* Custom scrollbar - Medical-grade subtle */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; border: 2px solid #f1f5f9; }
      ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      
      /* ===== PROFESSIONAL CARD SYSTEM ===== */
      .card { 
        background: white; 
        border-radius: 16px; 
        box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
        border: 1px solid #e2e8f0;
        overflow: hidden;
        transition: all 0.2s ease;
      }
      .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-color: #cbd5e1; }
      .card-header { 
        padding: 16px 20px; 
        border-bottom: 1px solid #f1f5f9; 
        background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
      }
      .card-body { padding: 20px; }
      
      /* ===== CLINICAL STATUS BADGES ===== */
      .badge { 
        display: inline-flex; 
        align-items: center; 
        padding: 4px 10px; 
        border-radius: 20px; 
        font-size: 11px; 
        font-weight: 600; 
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .badge-active { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); color: #047857; }
      .badge-completed { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); color: #1d4ed8; }
      .badge-pending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); color: #b45309; }
      .badge-locked { background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); color: #7c3aed; }
      .badge-error { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #dc2626; }
      .badge-draft { background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); color: #475569; }
      
      /* ===== MEDICAL-GRADE BUTTONS ===== */
      .btn { 
        display: inline-flex; 
        align-items: center; 
        justify-content: center; 
        padding: 10px 18px; 
        font-size: 14px; 
        font-weight: 500; 
        border-radius: 10px; 
        transition: all 0.15s ease;
        cursor: pointer;
        border: none;
        outline: none;
      }
      .btn:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-primary { 
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
        color: white; 
        box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);
      }
      .btn-primary:hover { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); transform: translateY(-1px); }
      .btn-secondary { 
        background: white; 
        color: #374151; 
        border: 1px solid #d1d5db;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .btn-secondary:hover { background: #f9fafb; border-color: #9ca3af; }
      .btn-success { 
        background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
        color: white;
        box-shadow: 0 2px 4px rgba(5, 150, 105, 0.3);
      }
      .btn-success:hover { background: linear-gradient(135deg, #059669 0%, #047857 100%); }
      .btn-danger { 
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); 
        color: white;
        box-shadow: 0 2px 4px rgba(220, 38, 38, 0.3);
      }
      .btn-danger:hover { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); }
      .btn-ghost { background: transparent; color: #6b7280; }
      .btn-ghost:hover { background: #f3f4f6; color: #111827; }
      .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 8px; }
      .btn-lg { padding: 14px 24px; font-size: 16px; border-radius: 12px; }
      .btn-icon { padding: 10px; width: 40px; height: 40px; }
      
      /* ===== CLINICAL FORM INPUTS ===== */
      .form-input { 
        width: 100%; 
        padding: 12px 16px; 
        font-size: 14px; 
        border: 1.5px solid #e2e8f0; 
        border-radius: 10px; 
        background: #fafbfc;
        transition: all 0.15s ease;
      }
      .form-input:focus { 
        border-color: #3b82f6; 
        background: white;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); 
        outline: none;
      }
      .form-input:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
      .form-input.error { border-color: #ef4444; background: #fef2f2; }
      .form-input.error:focus { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15); }
      .form-input.valid { border-color: #10b981; background: #ecfdf5; }
      .form-label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
      .form-label .required { color: #ef4444; margin-left: 2px; }
      .form-helper { margin-top: 6px; font-size: 12px; color: #6b7280; }
      .form-error { margin-top: 6px; font-size: 12px; color: #ef4444; display: flex; align-items: center; gap: 4px; }
      
      /* ===== DATA TABLE - Medical Grade ===== */
      .table-container { 
        overflow-x: auto; 
        border-radius: 12px; 
        border: 1px solid #e2e8f0;
        background: white;
      }
      .data-table { width: 100%; border-collapse: collapse; }
      .data-table thead { background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%); }
      .data-table th { 
        padding: 14px 16px; 
        text-align: left; 
        font-size: 11px; 
        font-weight: 700; 
        color: #475569; 
        text-transform: uppercase; 
        letter-spacing: 0.05em;
        border-bottom: 2px solid #e2e8f0;
      }
      .data-table td { 
        padding: 14px 16px; 
        font-size: 14px; 
        color: #374151; 
        border-bottom: 1px solid #f1f5f9;
      }
      .data-table tbody tr { transition: background 0.15s ease; }
      .data-table tbody tr:hover { background: #f8fafc; }
      .data-table tbody tr:last-child td { border-bottom: none; }
      
      /* ===== CLINICAL STATS CARD ===== */
      .stat-card { 
        background: white; 
        border-radius: 16px; 
        padding: 20px;
        border: 1px solid #e2e8f0;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        position: relative;
        overflow: hidden;
      }
      .stat-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .stat-card:hover::before { opacity: 1; }
      .stat-value { font-size: 28px; font-weight: 700; color: #0f172a; line-height: 1; }
      .stat-label { font-size: 13px; color: #64748b; margin-top: 6px; font-weight: 500; }
      .stat-icon { 
        width: 48px; 
        height: 48px; 
        border-radius: 12px; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        font-size: 20px;
      }
      
      /* ===== PROGRESS INDICATORS ===== */
      .progress-bar { 
        height: 6px; 
        background: #e2e8f0; 
        border-radius: 3px; 
        overflow: hidden;
      }
      .progress-fill { 
        height: 100%; 
        border-radius: 3px; 
        transition: width 0.5s ease;
        background: linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%);
      }
      .progress-fill.success { background: linear-gradient(90deg, #10b981 0%, #34d399 100%); }
      .progress-fill.warning { background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%); }
      .progress-fill.danger { background: linear-gradient(90deg, #ef4444 0%, #f87171 100%); }
      
      /* ===== MODAL SYSTEM ===== */
      .modal-overlay { 
        position: fixed; 
        inset: 0; 
        background: rgba(15, 23, 42, 0.7); 
        backdrop-filter: blur(4px);
        z-index: 50; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        padding: 16px;
        animation: fadeIn 0.2s ease;
      }
      .modal-content { 
        background: white; 
        border-radius: 20px; 
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        max-width: 520px; 
        width: 100%; 
        max-height: 90vh; 
        overflow: hidden;
        animation: slideUp 0.3s ease;
      }
      .modal-header { 
        padding: 20px 24px; 
        border-bottom: 1px solid #f1f5f9; 
        display: flex; 
        align-items: center; 
        justify-content: space-between;
        background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
      }
      .modal-body { padding: 24px; overflow-y: auto; max-height: 60vh; }
      .modal-footer { 
        padding: 16px 24px; 
        border-top: 1px solid #f1f5f9; 
        display: flex; 
        justify-content: flex-end; 
        gap: 12px;
        background: #f8fafc;
      }
      
      /* ===== TOAST NOTIFICATIONS ===== */
      .toast { 
        position: fixed; 
        bottom: 80px; 
        left: 50%; 
        transform: translateX(-50%); 
        padding: 14px 20px; 
        border-radius: 12px; 
        box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        z-index: 100; 
        display: flex; 
        align-items: center; 
        gap: 12px; 
        font-size: 14px; 
        font-weight: 500;
        animation: toastSlideUp 0.3s ease;
      }
      .toast-success { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; }
      .toast-error { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; }
      .toast-warning { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; }
      .toast-info { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; }
      
      /* ===== PROFESSIONAL HEADER ===== */
      .app-header { 
        background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); 
        color: white; 
        position: sticky; 
        top: 0; 
        z-index: 40;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      .header-brand { display: flex; align-items: center; gap: 12px; cursor: pointer; }
      .header-brand-icon { 
        width: 42px; 
        height: 42px; 
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); 
        border-radius: 12px; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      }
      
      /* ===== COMPLIANCE INDICATORS ===== */
      .compliance-badge { 
        display: inline-flex; 
        align-items: center; 
        gap: 6px; 
        padding: 6px 12px; 
        background: rgba(16, 185, 129, 0.15); 
        color: #34d399; 
        font-size: 11px; 
        font-weight: 600; 
        border-radius: 8px;
        border: 1px solid rgba(16, 185, 129, 0.2);
      }
      
      /* ===== CRF FORM SYSTEM ===== */
      .crf-section { 
        background: white; 
        border-radius: 16px; 
        border: 1px solid #e2e8f0; 
        margin-bottom: 16px;
        overflow: hidden;
      }
      .crf-section-header { 
        padding: 16px 20px; 
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); 
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .crf-section-title { font-size: 14px; font-weight: 700; color: #1e293b; }
      .crf-field { padding: 16px 20px; border-bottom: 1px solid #f1f5f9; }
      .crf-field:last-child { border-bottom: none; }
      .crf-field-label { 
        font-size: 13px; 
        font-weight: 600; 
        color: #475569; 
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      /* ===== SUBJECT CARDS ===== */
      .subject-card { 
        background: white; 
        border-radius: 16px; 
        border: 1px solid #e2e8f0; 
        padding: 16px;
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .subject-card:hover { 
        border-color: #3b82f6; 
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
        transform: translateY(-2px);
      }
      .subject-id { font-size: 18px; font-weight: 700; color: #0f172a; }
      
      /* ===== USER AVATAR ===== */
      .avatar { 
        width: 40px; 
        height: 40px; 
        border-radius: 12px; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        font-weight: 700;
        font-size: 14px;
        color: white;
      }
      .avatar-sm { width: 32px; height: 32px; font-size: 12px; border-radius: 10px; }
      .avatar-lg { width: 56px; height: 56px; font-size: 20px; border-radius: 16px; }
      
      /* ===== ANIMATIONS ===== */
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes toastSlideUp { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .animate-fadeIn { animation: fadeIn 0.3s ease; }
      .animate-slideUp { animation: slideUp 0.3s ease; }
      .animate-pulse { animation: pulse 2s infinite; }
      .animate-spin { animation: spin 1s linear infinite; }
      
      /* ===== SKELETON LOADING ===== */
      .skeleton { background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; border-radius: 8px; }
      @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      
      /* ===== RESPONSIVE UTILITIES ===== */
      @media (max-width: 768px) {
        .stat-value { font-size: 24px; }
        .card { border-radius: 12px; }
        .modal-content { border-radius: 16px; margin: 16px; }
      }
    </style>
</head>
<body class="bg-slate-50 min-h-screen font-sans antialiased">
    <div id="app">${content}</div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script src="/static/app.js"></script>
</body>
</html>
`;

// 메인 페이지 - Professional eCRF Clinical Data Management System
app.get('/', (c) => {
  const content = `
    <!-- ===== PROFESSIONAL HEADER ===== -->
    <header class="app-header">
      <!-- Primary Navigation Bar -->
      <div class="border-b border-white/10">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between items-center h-16">
            <!-- Brand Logo -->
            <div class="header-brand" onclick="navigateTo('dashboard')">
              <div class="header-brand-icon">
                <i class="fas fa-heartbeat text-white text-lg"></i>
              </div>
              <div>
                <h1 class="text-xl font-bold text-white tracking-tight">eCRF</h1>
                <p class="text-[10px] text-slate-400 -mt-0.5 font-medium hidden sm:block">Clinical Data Management</p>
              </div>
            </div>
            
            <!-- Center: System Status (Desktop) -->
            <div id="header-stats" class="hidden lg:flex items-center gap-3">
              <div class="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span class="text-xs text-slate-300 font-medium">System Active</span>
              </div>
              <div class="compliance-badge">
                <i class="fas fa-shield-alt text-xs"></i>
                <span>21 CFR Part 11</span>
              </div>
            </div>
            
            <!-- Right: User Section -->
            <div id="auth-section" class="flex items-center gap-3">
              <!-- Populated by JS -->
            </div>
          </div>
        </div>
      </div>
      
      <!-- Secondary Navigation (Breadcrumb Bar) -->
      <div id="sub-nav" class="hidden" style="background: rgba(30, 41, 59, 0.5);">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-10">
            <!-- Breadcrumb Navigation -->
            <div id="breadcrumb" class="flex items-center gap-1 text-sm">
              <button class="flex items-center gap-1.5 px-2 py-1 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition" onclick="navigateTo('dashboard')">
                <i class="fas fa-home text-xs"></i>
                <span class="hidden sm:inline">대시보드</span>
              </button>
            </div>
            
            <!-- Connection Status -->
            <div class="flex items-center gap-3">
              <div id="online-status" class="flex items-center gap-2 text-xs">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span class="text-slate-400">Online</span>
              </div>
              <div id="pending-sync" class="hidden flex items-center gap-2 text-xs text-amber-400">
                <i class="fas fa-sync fa-spin"></i>
                <span>Syncing...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- ===== MAIN CONTENT AREA ===== -->
    <main class="min-h-[calc(100vh-120px)] pb-20 md:pb-8">
      
      <!-- LOGIN SECTION -->
      <div id="login-section" class="hidden">
        <div class="min-h-screen flex items-center justify-center py-12 px-4" style="background: linear-gradient(135deg, #0c1222 0%, #1a2642 50%, #0f172a 100%);">
          <!-- Decorative Elements -->
          <div class="absolute inset-0 overflow-hidden pointer-events-none">
            <div class="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
            <div class="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
          </div>
          
          <div class="relative w-full max-w-md">
            <!-- Logo & Title -->
            <div class="text-center mb-10">
              <div class="inline-flex items-center justify-center w-24 h-24 rounded-3xl mb-8" style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); box-shadow: 0 20px 40px rgba(59, 130, 246, 0.4);">
                <i class="fas fa-heartbeat text-white text-4xl"></i>
              </div>
              <h1 class="text-4xl font-bold text-white mb-3">eCRF System</h1>
              <p class="text-slate-400 text-lg">Clinical Data Management Platform</p>
            </div>
            
            <!-- Login Card -->
            <div class="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-white/20">
              <!-- Compliance Badge -->
              <div class="flex items-center justify-center gap-3 mb-8 pb-6 border-b border-gray-100">
                <div class="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                  <i class="fas fa-shield-alt text-emerald-600 text-sm"></i>
                  <span class="text-xs font-semibold text-emerald-700">21 CFR Part 11</span>
                </div>
                <div class="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
                  <i class="fas fa-lock text-blue-600 text-sm"></i>
                  <span class="text-xs font-semibold text-blue-700">HIPAA Ready</span>
                </div>
              </div>
              
              <!-- Login Form -->
              <form id="login-form" class="space-y-6">
                <div>
                  <label class="form-label">
                    이메일 <span class="required">*</span>
                  </label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <i class="fas fa-user"></i>
                    </span>
                    <input type="email" id="login-email" required
                      class="form-input pl-12"
                      placeholder="user@example.com"
                      autocomplete="email">
                  </div>
                </div>
                
                <div>
                  <label class="form-label">
                    비밀번호 <span class="required">*</span>
                  </label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <i class="fas fa-lock"></i>
                    </span>
                    <input type="password" id="login-password" required
                      class="form-input pl-12"
                      placeholder="••••••••"
                      autocomplete="current-password">
                  </div>
                </div>
                
                <!-- 2FA Code (conditionally shown) -->
                <div id="login-2fa-section" class="hidden">
                  <label class="form-label">
                    2단계 인증 코드 <span class="required">*</span>
                  </label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <i class="fas fa-shield-alt"></i>
                    </span>
                    <input type="text" id="login-2fa-code" maxlength="6"
                      class="form-input pl-12 text-center tracking-widest text-lg font-mono"
                      placeholder="000000">
                  </div>
                </div>
                
                <!-- Error Message -->
                <div id="login-error" class="hidden p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-3">
                  <i class="fas fa-exclamation-circle text-red-500"></i>
                  <span></span>
                </div>
                
                <button type="submit" class="btn btn-primary w-full btn-lg" style="height: 52px;">
                  <i class="fas fa-sign-in-alt mr-2"></i>
                  <span>로그인</span>
                </button>
              </form>
              
              <!-- Test Accounts Info -->
              <div class="mt-8 pt-6 border-t border-gray-100">
                <p class="text-xs text-gray-500 text-center mb-4 font-medium">테스트 계정 정보</p>
                <div class="grid grid-cols-2 gap-3">
                  <div class="p-3 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl border border-gray-100">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="w-2 h-2 rounded-full bg-red-400"></span>
                      <p class="text-xs font-semibold text-gray-700">관리자</p>
                    </div>
                    <p class="text-xs text-gray-500 font-mono">admin@ecrf.local</p>
                  </div>
                  <div class="p-3 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl border border-gray-100">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="w-2 h-2 rounded-full bg-purple-400"></span>
                      <p class="text-xs font-semibold text-gray-700">연구책임자</p>
                    </div>
                    <p class="text-xs text-gray-500 font-mono">pi@hospital1.local</p>
                  </div>
                  <div class="p-3 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl border border-gray-100">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="w-2 h-2 rounded-full bg-blue-400"></span>
                      <p class="text-xs font-semibold text-gray-700">CRC</p>
                    </div>
                    <p class="text-xs text-gray-500 font-mono">crc@hospital1.local</p>
                  </div>
                  <div class="p-3 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl border border-gray-100">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="w-2 h-2 rounded-full bg-green-400"></span>
                      <p class="text-xs font-semibold text-gray-700">모니터</p>
                    </div>
                    <p class="text-xs text-gray-500 font-mono">cra@sponsor.local</p>
                  </div>
                </div>
                <p class="text-center text-xs text-gray-400 mt-3">
                  <i class="fas fa-key mr-1"></i> 비밀번호: <code class="bg-gray-100 px-1.5 py-0.5 rounded">Test1234!</code>
                </p>
              </div>
            </div>
            
            <!-- Footer -->
            <p class="text-center text-slate-500 text-xs mt-8">
              © 2024 eCRF Clinical Data Management System. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      <!-- DASHBOARD SECTION -->
      <div id="dashboard-section" class="hidden">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div id="main-content">
            <!-- Loading Placeholder -->
            <div class="flex flex-col items-center justify-center py-20">
              <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-6" style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);">
                <i class="fas fa-heartbeat text-white text-2xl animate-pulse"></i>
              </div>
              <div class="w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin mb-4"></div>
              <p class="text-gray-500 font-medium">임상 데이터를 불러오는 중...</p>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- ===== MOBILE BOTTOM NAVIGATION ===== -->
    <nav class="mobile-nav fixed bottom-0 left-0 right-0 z-50 md:hidden" id="mobile-nav" style="background: white; border-top: 1px solid #e2e8f0; box-shadow: 0 -4px 12px rgba(0,0,0,0.05);">
      <div class="grid grid-cols-5 h-16">
        <button class="mobile-nav-item flex flex-col items-center justify-center transition-colors" onclick="navigateTo('dashboard')" data-view="dashboard">
          <i class="fas fa-th-large text-lg text-gray-400"></i>
          <span class="text-[10px] mt-1 font-semibold text-gray-500">대시보드</span>
        </button>
        <button class="mobile-nav-item flex flex-col items-center justify-center transition-colors" onclick="navigateTo('studies')" data-view="studies">
          <i class="fas fa-flask text-lg text-gray-400"></i>
          <span class="text-[10px] mt-1 font-semibold text-gray-500">Study</span>
        </button>
        <button class="mobile-nav-item flex flex-col items-center justify-center transition-colors" onclick="navigateTo('subjects')" data-view="subjects">
          <i class="fas fa-user-injured text-lg text-gray-400"></i>
          <span class="text-[10px] mt-1 font-semibold text-gray-500">피험자</span>
        </button>
        <button class="mobile-nav-item flex flex-col items-center justify-center transition-colors relative" onclick="navigateTo('queries')" data-view="queries">
          <i class="fas fa-comment-medical text-lg text-gray-400"></i>
          <span class="text-[10px] mt-1 font-semibold text-gray-500">Query</span>
          <span id="query-badge" class="hidden absolute top-1 right-1/4 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">0</span>
        </button>
        <button class="mobile-nav-item flex flex-col items-center justify-center transition-colors" onclick="showMobileMenu()" data-view="more">
          <i class="fas fa-bars text-lg text-gray-400"></i>
          <span class="text-[10px] mt-1 font-semibold text-gray-500">메뉴</span>
        </button>
      </div>
    </nav>

    <!-- ===== MOBILE MENU OVERLAY ===== -->
    <div id="mobile-menu-overlay" class="fixed inset-0 z-[60] hidden" onclick="closeMobileMenu()" style="background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px);">
      <div class="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6 pb-8 animate-slideUp" onclick="event.stopPropagation()">
        <div class="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>
        
        <!-- Quick Actions Grid -->
        <div class="grid grid-cols-4 gap-4 mb-6">
          <button onclick="navigateTo('reports'); closeMobileMenu();" class="flex flex-col items-center p-4 rounded-2xl hover:bg-gray-50 transition">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);">
              <i class="fas fa-chart-pie text-xl text-blue-600"></i>
            </div>
            <span class="text-xs font-semibold text-gray-700">리포트</span>
          </button>
          <button onclick="navigateTo('exports'); closeMobileMenu();" class="flex flex-col items-center p-4 rounded-2xl hover:bg-gray-50 transition">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);">
              <i class="fas fa-file-export text-xl text-emerald-600"></i>
            </div>
            <span class="text-xs font-semibold text-gray-700">Export</span>
          </button>
          <button onclick="navigateTo('audit'); closeMobileMenu();" class="flex flex-col items-center p-4 rounded-2xl hover:bg-gray-50 transition">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%);">
              <i class="fas fa-history text-xl text-purple-600"></i>
            </div>
            <span class="text-xs font-semibold text-gray-700">감사로그</span>
          </button>
          <button onclick="offline.showSyncDashboard(); closeMobileMenu();" class="flex flex-col items-center p-4 rounded-2xl hover:bg-gray-50 transition">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);">
              <i class="fas fa-sync text-xl text-amber-600"></i>
            </div>
            <span class="text-xs font-semibold text-gray-700">동기화</span>
          </button>
        </div>
        
        <!-- Menu Items -->
        <div class="border-t border-gray-100 pt-4 space-y-1">
          <button onclick="showSettings(); closeMobileMenu();" class="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-gray-50 transition">
            <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <i class="fas fa-cog text-gray-600"></i>
            </div>
            <span class="font-medium text-gray-700">설정</span>
            <i class="fas fa-chevron-right ml-auto text-gray-300"></i>
          </button>
          <button onclick="logout(); closeMobileMenu();" class="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-red-50 transition text-red-600">
            <div class="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <i class="fas fa-sign-out-alt text-red-500"></i>
            </div>
            <span class="font-medium">로그아웃</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ===== TOAST CONTAINER ===== -->
    <div id="toast-container" class="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-96 z-[100] space-y-3"></div>

    <!-- ===== MODAL CONTAINER ===== -->
    <div id="modal-container"></div>
  `;

  return c.html(htmlTemplate('홈', content));
});

// 404 페이지
app.notFound((c) => {
  return c.html(htmlTemplate('페이지를 찾을 수 없음', `
    <div class="min-h-[60vh] flex items-center justify-center">
      <div class="text-center">
        <i class="fas fa-exclamation-triangle text-6xl text-yellow-500 mb-4"></i>
        <h2 class="text-2xl font-bold text-gray-900 mb-2">404 - 페이지를 찾을 수 없습니다</h2>
        <p class="text-gray-600 mb-6">요청하신 페이지가 존재하지 않습니다.</p>
        <a href="/" class="bg-ecrf-blue text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
          <i class="fas fa-home mr-2"></i> 홈으로 돌아가기
        </a>
      </div>
    </div>
  `), 404);
});

// 에러 핸들러
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({
    success: false,
    error: '서버 오류가 발생했습니다.',
  }, 500);
});

export default app;
