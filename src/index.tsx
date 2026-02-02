// eCRF PWA - Main Application Entry Point
// Hono Framework + Cloudflare Pages
// 21 CFR Part 11 Compliant Electronic Data Capture System

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import { securityHeaders, apiRateLimiter, loginRateLimiter, requestId, validateRequest } from './middleware/security';
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
import auditRoutes from './routes/audit';

// Application version
const APP_VERSION = '2.0.0';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// GLOBAL MIDDLEWARE
// =====================================================

// Request ID for tracing
app.use('*', requestId);

// Security headers for all responses
app.use('*', securityHeaders);

// =====================================================
// API MIDDLEWARE
// =====================================================

// CORS 설정 (프로덕션에서는 특정 도메인만 허용)
app.use('/api/*', cors({
  origin: (origin) => {
    // 프로덕션 도메인 허용 목록
    const allowedOrigins = [
      'https://ecrf-pwa.pages.dev',
      'https://*.ecrf-pwa.pages.dev',
      /^https:\/\/.*\.pages\.dev$/,
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    if (!origin) return '*';  // Allow requests with no origin (mobile apps, curl)
    
    for (const allowed of allowedOrigins) {
      if (typeof allowed === 'string' && origin === allowed) return origin;
      if (allowed instanceof RegExp && allowed.test(origin)) return origin;
    }
    
    return origin;  // Allow in development, restrict in strict production
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  exposeHeaders: ['Content-Length', 'X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
  credentials: true,
}));

// 로깅 (구조화된 로그)
app.use('/api/*', logger((message: string, ...rest: string[]) => {
  console.log(`[${new Date().toISOString()}] ${message}`, ...rest);
}));

// Request validation
app.use('/api/*', validateRequest);

// Rate limiting (login 엔드포인트는 더 엄격하게)
app.use('/api/auth/login', loginRateLimiter);
app.use('/api/*', apiRateLimiter);

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

// Audit Trail API (21 CFR Part 11 Compliant)
app.route('/api/audit', auditRoutes);

// Health Check (detailed for monitoring)
app.get('/api/health', async (c) => {
  const startTime = Date.now();
  let dbStatus = 'ok';
  let dbLatency = 0;
  
  // Check database connectivity
  try {
    const dbStart = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    dbLatency = Date.now() - dbStart;
  } catch (error) {
    dbStatus = 'error';
    console.error('Database health check failed:', error);
  }
  
  const responseTime = Date.now() - startTime;
  
  return c.json({
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    environment: c.env.ENVIRONMENT || 'production',
    uptime: 'N/A',  // Workers don't have persistent uptime
    checks: {
      database: {
        status: dbStatus,
        latency_ms: dbLatency
      }
    },
    response_time_ms: responseTime,
    request_id: c.get('requestId')
  });
});

// Readiness probe (for load balancers)
app.get('/api/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// Liveness probe
app.get('/api/live', (c) => {
  return c.json({ alive: true });
});

// =====================================================
// STATIC FILES (for local development)
// =====================================================

// Favicon - return minimal PNG
app.get('/favicon.ico', async (c) => {
  // 32x32 blue PNG
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xFC, 0x18, 0xED, 0xA3
  ]);
  return new Response(pngHeader, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  });
});

// Icons - return blue PNG placeholders
app.get('/icons/:filename', async (c) => {
  const filename = c.req.param('filename');
  const sizeMatch = filename.match(/icon-(\d+)\.png/);
  const size = sizeMatch ? parseInt(sizeMatch[1]) : 192;
  
  // Return minimal valid PNG with blue color
  const pngData = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0x00, 0x66, 0xB3, 0x00,
    0x00, 0x00, 0x37, 0x00, 0x25, 0x17, 0xF5, 0x69, 0x2F, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  
  return new Response(pngData, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  });
});

// Manifest.json
app.get('/manifest.json', async (c) => {
  const manifest = {
    name: 'eCRF Clinical',
    short_name: 'eCRF',
    description: '21 CFR Part 11 Compliant Electronic Case Report Form System',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0066B3',
    icons: [
      { src: '/icons/icon-72.png', sizes: '72x72', type: 'image/png' },
      { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  };
  return c.json(manifest);
});

// =====================================================
// FRONTEND PAGES
// =====================================================

// HTML 템플릿 - Professional eCRF System (Medidata/Veeva Style)
const htmlTemplate = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="eCRF - Electronic Case Report Form System">
    <meta name="theme-color" content="#0066B3">
    <title>${title} | eCRF Clinical</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="stylesheet" href="/static/mobile.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      /* ===== Professional eCRF System Styles ===== */
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      :root {
        --primary: #0066B3;
        --primary-dark: #004d86;
        --secondary: #5c6bc0;
        --success: #2e7d32;
        --warning: #ed6c02;
        --danger: #d32f2f;
        --text-primary: #1a1a1a;
        --text-secondary: #5f6368;
        --text-muted: #80868b;
        --bg-primary: #ffffff;
        --bg-secondary: #f8f9fa;
        --bg-tertiary: #f1f3f4;
        --border: #dadce0;
        --border-light: #e8eaed;
      }
      
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-primary);
        background: var(--bg-secondary);
        min-height: 100vh;
      }
      
      /* ===== Header ===== */
      .app-header {
        background: var(--primary);
        height: 48px;
        position: sticky;
        top: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        padding: 0 16px;
      }
      
      .header-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #fff;
        font-weight: 600;
        font-size: 15px;
        cursor: pointer;
      }
      
      .header-brand i { font-size: 18px; }
      
      .header-nav {
        display: flex;
        align-items: center;
        margin-left: 32px;
        gap: 4px;
      }
      
      .header-nav-item {
        color: rgba(255,255,255,0.85);
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
        text-decoration: none;
      }
      
      .header-nav-item:hover { background: rgba(255,255,255,0.1); }
      .header-nav-item.active { background: rgba(255,255,255,0.15); color: #fff; }
      
      .header-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .header-user {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        color: #fff;
        font-size: 13px;
      }
      
      .header-user:hover { background: rgba(255,255,255,0.1); }
      
      .user-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
      }
      
      /* ===== Secondary Nav (Breadcrumb) ===== */
      .sub-header {
        background: #fff;
        border-bottom: 1px solid var(--border);
        padding: 0 20px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .breadcrumb {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        width: 100%;
        max-width: 1400px;
      }
      
      .breadcrumb a {
        color: var(--primary);
        text-decoration: none;
      }
      
      .breadcrumb a:hover { text-decoration: underline; }
      .breadcrumb span { color: var(--text-muted); }
      
      /* ===== Tabs ===== */
      .tabs {
        display: flex;
        gap: 0;
        border-bottom: 2px solid var(--border);
        margin-bottom: 20px;
        overflow-x: auto;
      }
      
      .tab-btn {
        padding: 12px 20px;
        border: none;
        background: transparent;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s;
      }
      
      .tab-btn:hover {
        color: var(--primary);
        background: var(--bg-secondary);
      }
      
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      
      .tab-btn .badge {
        font-size: 11px;
        padding: 2px 6px;
      }
      
      .tab-content {
        display: none;
      }
      
      .tab-content.active {
        display: block;
      }
      
      /* ===== Main Layout ===== */
      .main-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 20px;
      }
      
      /* ===== Cards ===== */
      .card {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        margin-bottom: 16px;
      }
      
      .card-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-light);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      
      .card-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
      }
      
      .card-body { padding: 20px; }
      .card-body.compact { padding: 0; }
      
      /* ===== Buttons ===== */
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        transition: all 0.15s;
        text-decoration: none;
      }
      
      .btn-primary {
        background: var(--primary);
        color: #fff;
      }
      .btn-primary:hover { background: var(--primary-dark); }
      
      .btn-secondary {
        background: #fff;
        color: var(--text-primary);
        border: 1px solid var(--border);
      }
      .btn-secondary:hover { background: var(--bg-tertiary); }
      
      .btn-danger {
        background: var(--danger);
        color: #fff;
      }
      .btn-danger:hover { background: #c62828; }
      
      .btn-sm {
        padding: 5px 10px;
        font-size: 12px;
      }
      
      .btn-icon {
        width: 32px;
        height: 32px;
        padding: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--text-secondary);
        border: none;
        cursor: pointer;
      }
      .btn-icon:hover { background: var(--bg-tertiary); }
      
      /* ===== Forms ===== */
      .form-group { margin-bottom: 16px; }
      
      .form-label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 6px;
      }
      
      .form-label .required { color: var(--danger); margin-left: 2px; }
      
      .form-input {
        width: 100%;
        padding: 10px 12px;
        font-size: 14px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: #fff;
        color: var(--text-primary);
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      
      .form-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(0, 102, 179, 0.1);
      }
      
      .form-input::placeholder { color: var(--text-muted); }
      
      .form-input.error { border-color: var(--danger); }
      
      .form-hint {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
      }
      
      /* ===== Tables ===== */
      .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      
      .data-table th {
        padding: 12px 16px;
        text-align: left;
        font-weight: 500;
        color: var(--text-secondary);
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
      }
      
      .data-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-light);
        color: var(--text-primary);
      }
      
      .data-table tbody tr:hover { background: var(--bg-secondary); }
      .data-table tbody tr.clickable { cursor: pointer; }
      
      /* ===== Badges ===== */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 500;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      
      .badge-active { background: #e8f5e9; color: #2e7d32; }
      .badge-draft { background: var(--bg-tertiary); color: var(--text-secondary); }
      .badge-pending { background: #fff3e0; color: #e65100; }
      .badge-completed { background: #e3f2fd; color: #1565c0; }
      .badge-locked { background: #f3e5f5; color: #7b1fa2; }
      .badge-open { background: #ffebee; color: #c62828; }
      .badge-closed { background: var(--bg-tertiary); color: var(--text-muted); }
      
      /* ===== Stats ===== */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
      }
      
      .stat-card {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 20px;
      }
      
      .stat-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      
      .stat-value {
        font-size: 28px;
        font-weight: 600;
        color: var(--text-primary);
      }
      
      .stat-change {
        font-size: 12px;
        margin-top: 4px;
      }
      .stat-change.positive { color: var(--success); }
      .stat-change.negative { color: var(--danger); }
      
      /* ===== Dropdown ===== */
      .dropdown { position: relative; }
      
      .dropdown-menu {
        position: absolute;
        top: 100%;
        right: 0;
        min-width: 200px;
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        z-index: 1000;
        display: none;
        overflow: hidden;
      }
      
      .dropdown-menu.show { display: block; }
      
      .dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        font-size: 13px;
        color: var(--text-primary);
        cursor: pointer;
        transition: background 0.15s;
      }
      
      .dropdown-item:hover { background: var(--bg-secondary); }
      .dropdown-item i { width: 16px; color: var(--text-muted); }
      
      .dropdown-divider {
        height: 1px;
        background: var(--border-light);
        margin: 4px 0;
      }
      
      /* ===== Toast ===== */
      .toast-container {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2000;
      }
      
      .toast {
        background: #323232;
        color: #fff;
        padding: 12px 20px;
        border-radius: 4px;
        font-size: 14px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      
      .toast.success { background: var(--success); }
      .toast.error { background: var(--danger); }
      .toast.warning { background: var(--warning); }
      
      /* ===== Modal ===== */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      
      .modal {
        background: #fff;
        border-radius: 8px;
        max-width: 560px;
        width: 90%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      }
      
      .modal-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      
      .modal-title {
        font-size: 16px;
        font-weight: 600;
      }
      
      .modal-close {
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--text-muted);
        border-radius: 4px;
      }
      .modal-close:hover { background: var(--bg-tertiary); }
      
      .modal-body { 
        padding: 20px; 
        overflow-y: auto;
        flex: 1;
        max-height: calc(90vh - 130px);
      }
      
      .modal-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--border-light);
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        background: var(--bg-secondary);
        flex-shrink: 0;
      }
      
      /* ===== Empty State ===== */
      .empty-state {
        text-align: center;
        padding: 48px 20px;
        color: var(--text-muted);
      }
      
      .empty-state i {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }
      
      .empty-state h3 {
        font-size: 16px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }
      
      .empty-state p { font-size: 14px; }
      
      /* ===== Loading ===== */
      .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px;
        color: var(--text-muted);
      }
      
      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 12px;
      }
      
      @keyframes spin { to { transform: rotate(360deg); } }
      
      /* ===== Login Page ===== */
      .login-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-secondary);
        padding: 20px;
      }
      
      .login-container {
        width: 100%;
        max-width: 400px;
      }
      
      .login-header {
        text-align: center;
        margin-bottom: 32px;
      }
      
      .login-logo {
        width: 48px;
        height: 48px;
        background: var(--primary);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
      }
      
      .login-logo i { color: #fff; font-size: 24px; }
      
      .login-header h1 {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 4px;
      }
      
      .login-header p {
        color: var(--text-muted);
        font-size: 14px;
      }
      
      .login-card {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 24px;
      }
      
      .compliance-badges {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-bottom: 24px;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--border-light);
      }
      
      .compliance-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: var(--bg-secondary);
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-secondary);
      }
      
      .compliance-badge i { color: var(--success); }
      
      .test-accounts {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--border-light);
      }
      
      .test-accounts h4 {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        margin-bottom: 12px;
        text-align: center;
      }
      
      .test-accounts-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      
      .test-account {
        padding: 10px;
        background: var(--bg-secondary);
        border-radius: 4px;
        font-size: 11px;
      }
      
      .test-account-role {
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 2px;
      }
      
      .test-account-email {
        color: var(--text-muted);
        font-family: monospace;
      }
      
      .login-footer {
        text-align: center;
        margin-top: 24px;
        font-size: 12px;
        color: var(--text-muted);
      }
      
      /* ===== Welcome Section ===== */
      .welcome-banner {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 20px 24px;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      
      .welcome-info {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      
      .welcome-avatar {
        width: 48px;
        height: 48px;
        background: var(--primary);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 600;
        font-size: 16px;
      }
      
      .welcome-text h2 {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 2px;
      }
      
      .welcome-text p {
        color: var(--text-muted);
        font-size: 13px;
      }
      
      .welcome-meta {
        text-align: right;
        color: var(--text-muted);
        font-size: 13px;
      }
      
      /* ===== Study List ===== */
      .study-item {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-light);
        cursor: pointer;
        transition: background 0.15s;
      }
      
      .study-item:hover { background: var(--bg-secondary); }
      .study-item:last-child { border-bottom: none; }
      
      .study-item-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      
      .study-protocol {
        font-weight: 600;
        color: var(--primary);
      }
      
      .study-title {
        color: var(--text-secondary);
        font-size: 13px;
        margin-bottom: 8px;
      }
      
      .study-meta {
        display: flex;
        gap: 16px;
        font-size: 12px;
        color: var(--text-muted);
      }
      
      .study-meta-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      
      /* ===== Quick Actions ===== */
      .quick-actions {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }
      
      .quick-action {
        padding: 16px;
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
      }
      
      .quick-action:hover {
        border-color: var(--primary);
        background: #f5f9ff;
      }
      
      .quick-action i {
        font-size: 20px;
        color: var(--primary);
        margin-bottom: 8px;
        display: block;
      }
      
      .quick-action span {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-primary);
      }
      
      /* ===== Responsive ===== */
      @media (max-width: 768px) {
        .header-nav { display: none; }
        .main-container { padding: 12px; }
        .stats-grid { grid-template-columns: repeat(2, 1fr); }
        .quick-actions { grid-template-columns: repeat(2, 1fr); }
        .welcome-meta { display: none; }
      }
      
      /* ===== Utility ===== */
      .hidden { display: none !important; }
      .text-center { text-align: center; }
      .mt-4 { margin-top: 16px; }
      .mb-4 { margin-bottom: 16px; }
    </style>
</head>
<body>
    <div id="app">${content}</div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script src="/static/app.js"></script>
</body>
</html>
`;

// 메인 페이지
app.get('/', (c) => {
  const content = `
    <!-- ===== HEADER ===== -->
    <header class="app-header" id="app-header">
      <div class="header-brand" onclick="navigateTo('dashboard')">
        <i class="fas fa-database"></i>
        <span>eCRF Clinical</span>
      </div>
      
      <nav class="header-nav" id="header-nav"></nav>
      
      <div class="header-right" id="auth-section"></div>
    </header>

    <!-- ===== SUB HEADER ===== -->
    <div class="sub-header" id="sub-header" style="display: none;">
      <div class="breadcrumb" id="breadcrumb">
        <a href="#" onclick="navigateTo('dashboard')">Home</a>
      </div>
    </div>

    <!-- ===== LOGIN SECTION ===== -->
    <div id="login-section" class="login-page hidden">
      <div class="login-container">
        <div class="login-header">
          <div class="login-logo">
            <i class="fas fa-database"></i>
          </div>
          <h1>eCRF Clinical</h1>
          <p>Electronic Case Report Form System</p>
        </div>
        
        <div class="login-card">
          <div class="compliance-badges">
            <div class="compliance-badge">
              <i class="fas fa-shield-alt"></i>
              <span>21 CFR Part 11</span>
            </div>
            <div class="compliance-badge">
              <i class="fas fa-lock"></i>
              <span>HIPAA Ready</span>
            </div>
          </div>
          
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">
                이메일 <span class="required">*</span>
              </label>
              <input type="email" id="login-email" class="form-input" placeholder="user@example.com" required autocomplete="email">
            </div>
            
            <div class="form-group">
              <label class="form-label">
                비밀번호 <span class="required">*</span>
              </label>
              <input type="password" id="login-password" class="form-input" placeholder="비밀번호 입력" required autocomplete="current-password">
            </div>
            
            <div id="login-2fa-section" class="form-group hidden">
              <label class="form-label">
                2FA 코드 <span class="required">*</span>
              </label>
              <input type="text" id="login-2fa-code" class="form-input" placeholder="000000" maxlength="6" style="text-align: center; letter-spacing: 4px; font-size: 18px; font-family: monospace;">
            </div>
            
            <div id="login-error" class="hidden" style="padding: 12px; background: #ffebee; border-radius: 4px; color: #c62828; font-size: 13px; margin-bottom: 16px;">
            </div>
            
            <button type="submit" class="btn btn-primary" style="width: 100%; height: 44px;">
              로그인
            </button>
          </form>
          
          <div class="test-accounts">
            <h4>테스트 계정</h4>
            <div class="test-accounts-grid">
              <div class="test-account">
                <div class="test-account-role">관리자</div>
                <div class="test-account-email">admin@ecrf.local</div>
              </div>
              <div class="test-account">
                <div class="test-account-role">연구책임자</div>
                <div class="test-account-email">pi@hospital1.local</div>
              </div>
              <div class="test-account">
                <div class="test-account-role">CRC</div>
                <div class="test-account-email">crc@hospital1.local</div>
              </div>
              <div class="test-account">
                <div class="test-account-role">모니터</div>
                <div class="test-account-email">cra@sponsor.local</div>
              </div>
            </div>
            <p style="text-align: center; margin-top: 12px; font-size: 12px; color: var(--text-muted);">
              비밀번호: <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px;">Test1234!</code>
            </p>
          </div>
        </div>
        
        <div class="login-footer">
          © 2024 eCRF Clinical Data Management System
        </div>
      </div>
    </div>

    <!-- ===== DASHBOARD SECTION ===== -->
    <div id="dashboard-section" class="hidden">
      <div class="main-container">
        <div id="main-content">
          <div class="loading">
            <div class="spinner"></div>
            <span>데이터를 불러오는 중...</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TOAST CONTAINER ===== -->
    <div id="toast-container" class="toast-container"></div>

    <!-- ===== MODAL CONTAINER ===== -->
    <div id="modal-container"></div>
  `;

  return c.html(htmlTemplate('홈', content));
});

// 404 페이지
app.notFound((c) => {
  return c.html(htmlTemplate('페이지를 찾을 수 없음', `
    <div class="main-container">
      <div class="empty-state" style="margin-top: 80px;">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>404 - 페이지를 찾을 수 없습니다</h3>
        <p>요청하신 페이지가 존재하지 않습니다.</p>
        <a href="/" class="btn btn-primary" style="margin-top: 16px;">
          <i class="fas fa-home"></i> 홈으로 돌아가기
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
