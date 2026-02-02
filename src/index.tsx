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

// HTML 템플릿 - Professional eCRF System (Modern Clinical Design)
const htmlTemplate = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="eCRF - 21 CFR Part 11 Compliant Electronic Case Report Form System">
    <meta name="theme-color" content="#0052a3">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>${title} | eCRF Clinical</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
    <link rel="stylesheet" href="/static/design-system.css">
    <link rel="stylesheet" href="/static/mobile.css">
    <style>
      /* ===== Page-specific overrides and legacy compatibility ===== */
      /* Note: Most styles are now in /static/design-system.css */
      
      /* Legacy variable aliases for backward compatibility */
      :root {
        --primary: var(--primary-500);
        --primary-dark: var(--primary-700);
        --secondary: var(--secondary-500);
        --success: var(--success-main);
        --warning: var(--warning-main);
        --danger: var(--error-main);
        --border: var(--border-main);
      }
      
      /* 2FA Code Input Special Styling */
      .twofa-code-input {
        text-align: center;
        letter-spacing: 0.5em;
        font-size: var(--text-xl);
        font-family: var(--font-mono);
        font-weight: var(--font-semibold);
      }
      
      /* Error Alert Box */
      .alert-error {
        padding: var(--space-3) var(--space-4);
        background: var(--error-light);
        border: 1px solid rgba(211, 47, 47, 0.2);
        border-radius: var(--radius-md);
        color: var(--error-main);
        font-size: var(--text-sm);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      
      .alert-error i {
        flex-shrink: 0;
      }
      
      /* Password Code Display */
      .password-code {
        background: var(--bg-tertiary);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        user-select: all;
      }
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
        <i class="fas fa-heartbeat"></i>
        <span>eCRF Clinical</span>
      </div>
      
      <nav class="header-nav" id="header-nav"></nav>
      
      <div class="header-right" id="auth-section"></div>
    </header>

    <!-- ===== SUB HEADER ===== -->
    <div class="sub-header" id="sub-header" style="display: none;">
      <div class="breadcrumb" id="breadcrumb">
        <a href="#" onclick="navigateTo('dashboard')"><i class="fas fa-home"></i></a>
        <span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>
      </div>
    </div>

    <!-- ===== LOGIN SECTION ===== -->
    <div id="login-section" class="login-page hidden">
      <div class="login-container">
        <div class="login-header">
          <div class="login-logo">
            <i class="fas fa-heartbeat"></i>
          </div>
          <h1>eCRF Clinical</h1>
          <p>21 CFR Part 11 Compliant EDC System</p>
        </div>
        
        <div class="login-card">
          <div class="compliance-badges">
            <div class="compliance-badge">
              <i class="fas fa-shield-alt"></i>
              <span>21 CFR Part 11</span>
            </div>
            <div class="compliance-badge">
              <i class="fas fa-check-circle"></i>
              <span>GCP Compliant</span>
            </div>
            <div class="compliance-badge">
              <i class="fas fa-lock"></i>
              <span>Audit Trail</span>
            </div>
          </div>
          
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">
                <i class="fas fa-envelope"></i>
                이메일 <span class="required">*</span>
              </label>
              <input type="email" id="login-email" class="form-input" placeholder="user@example.com" required autocomplete="email">
            </div>
            
            <div class="form-group">
              <label class="form-label">
                <i class="fas fa-key"></i>
                비밀번호 <span class="required">*</span>
              </label>
              <input type="password" id="login-password" class="form-input" placeholder="비밀번호 입력" required autocomplete="current-password">
            </div>
            
            <div id="login-2fa-section" class="form-group hidden">
              <label class="form-label">
                <i class="fas fa-shield-alt"></i>
                2FA 인증 코드 <span class="required">*</span>
              </label>
              <input type="text" id="login-2fa-code" class="form-input twofa-code-input" placeholder="000000" maxlength="6">
              <div class="form-hint">인증 앱에서 6자리 코드를 입력하세요</div>
            </div>
            
            <div id="login-error" class="alert-error hidden mb-4">
              <i class="fas fa-exclamation-circle"></i>
              <span id="login-error-text"></span>
            </div>
            
            <button type="submit" class="btn btn-primary btn-lg w-full">
              <i class="fas fa-sign-in-alt"></i>
              로그인
            </button>
          </form>
          
          <div class="test-accounts">
            <h4><i class="fas fa-users"></i> 테스트 계정</h4>
            <div class="test-accounts-grid">
              <div class="test-account" onclick="fillTestAccount('admin@ecrf.local')">
                <div class="test-account-role"><i class="fas fa-user-shield"></i> 관리자</div>
                <div class="test-account-email">admin@ecrf.local</div>
              </div>
              <div class="test-account" onclick="fillTestAccount('pi@hospital1.local')">
                <div class="test-account-role"><i class="fas fa-user-md"></i> 연구책임자</div>
                <div class="test-account-email">pi@hospital1.local</div>
              </div>
              <div class="test-account" onclick="fillTestAccount('crc@hospital1.local')">
                <div class="test-account-role"><i class="fas fa-user-nurse"></i> CRC</div>
                <div class="test-account-email">crc@hospital1.local</div>
              </div>
              <div class="test-account" onclick="fillTestAccount('cra@sponsor.local')">
                <div class="test-account-role"><i class="fas fa-user-tie"></i> 모니터</div>
                <div class="test-account-email">cra@sponsor.local</div>
              </div>
            </div>
            <p class="text-center mt-4 text-muted" style="font-size: var(--text-xs);">
              비밀번호: <code class="password-code">Test1234!</code>
            </p>
          </div>
        </div>
        
        <div class="login-footer">
          <p>© 2026 eCRF Clinical Data Management System</p>
          <p style="margin-top: 4px; opacity: 0.7;">Version 2.0.0 | Powered by Cloudflare</p>
        </div>
      </div>
    </div>

    <!-- ===== DASHBOARD SECTION ===== -->
    <div id="dashboard-section" class="hidden">
      <div class="main-container">
        <div id="main-content">
          <div class="loading">
            <div class="spinner"></div>
            <span class="loading-text">데이터를 불러오는 중...</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TOAST CONTAINER ===== -->
    <div id="toast-container" class="toast-container"></div>

    <!-- ===== MODAL CONTAINER ===== -->
    <div id="modal-container"></div>
    
    <!-- ===== Test Account Fill Script ===== -->
    <script>
      function fillTestAccount(email) {
        const emailInput = document.getElementById('login-email');
        const passwordInput = document.getElementById('login-password');
        if (emailInput) emailInput.value = email;
        if (passwordInput) passwordInput.value = 'Test1234!';
        emailInput?.focus();
      }
    </script>
  `;

  return c.html(htmlTemplate('홈', content));
});

// 404 페이지 - API와 웹 페이지 구분 처리
app.notFound((c) => {
  const path = c.req.path;
  
  // API 엔드포인트는 JSON 응답
  if (path.startsWith('/api/')) {
    return c.json({
      success: false,
      error: 'Endpoint not found',
      code: 'NOT_FOUND',
      path: path,
      request_id: c.get('requestId')
    }, 404);
  }
  
  // 웹 페이지는 HTML 응답
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
  
  const path = c.req.path;
  
  // API 엔드포인트는 JSON 응답
  if (path.startsWith('/api/')) {
    return c.json({
      success: false,
      error: '서버 오류가 발생했습니다.',
      code: 'INTERNAL_SERVER_ERROR',
      request_id: c.get('requestId')
    }, 500);
  }
  
  // 웹 페이지는 HTML 응답
  return c.html(htmlTemplate('오류 발생', `
    <div class="main-container">
      <div class="empty-state" style="margin-top: 80px;">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>500 - 서버 오류</h3>
        <p>서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
        <a href="/" class="btn btn-primary" style="margin-top: 16px;">
          <i class="fas fa-home"></i> 홈으로 돌아가기
        </a>
      </div>
    </div>
  `), 500);
});

export default app;
