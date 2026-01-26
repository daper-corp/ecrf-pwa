// eCRF PWA - Main Application Entry Point
// Hono Framework + Cloudflare Pages

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import studyRoutes from './routes/studies';

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

// Health Check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// =====================================================
// FRONTEND PAGES
// =====================================================

// HTML 템플릿
const htmlTemplate = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="eCRF - Electronic Case Report Form PWA">
    <meta name="theme-color" content="#2563eb">
    <title>${title} - eCRF</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              'ecrf-blue': '#2563eb',
              'ecrf-green': '#059669',
              'ecrf-red': '#dc2626',
              'ecrf-yellow': '#d97706',
            }
          }
        }
      }
    </script>
    <style>
      /* Custom scrollbar */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: #f1f5f9; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      
      /* Status colors */
      .status-draft { @apply bg-gray-100 text-gray-700; }
      .status-active { @apply bg-green-100 text-green-700; }
      .status-completed { @apply bg-blue-100 text-blue-700; }
      .status-locked { @apply bg-purple-100 text-purple-700; }
      
      /* Validation colors */
      .validation-error { @apply border-red-500 bg-red-50; }
      .validation-warning { @apply border-yellow-500 bg-yellow-50; }
      .validation-valid { @apply border-green-500; }
    </style>
</head>
<body class="bg-gray-50 min-h-screen">
    <div id="app">${content}</div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/app.js"></script>
</body>
</html>
`;

// 메인 페이지
app.get('/', (c) => {
  const content = `
    <!-- Header -->
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <div class="flex items-center">
            <i class="fas fa-clipboard-list text-ecrf-blue text-2xl mr-3"></i>
            <h1 class="text-xl font-bold text-gray-900">eCRF</h1>
            <span class="ml-2 text-sm text-gray-500">Electronic Case Report Form</span>
          </div>
          <div id="auth-section" class="flex items-center space-x-4">
            <!-- Auth buttons will be rendered by JS -->
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Login Section (shown when not authenticated) -->
      <div id="login-section" class="hidden">
        <div class="max-w-md mx-auto">
          <div class="bg-white rounded-lg shadow-lg p-8">
            <div class="text-center mb-8">
              <i class="fas fa-shield-alt text-ecrf-blue text-4xl mb-4"></i>
              <h2 class="text-2xl font-bold text-gray-900">로그인</h2>
              <p class="text-gray-600 mt-2">21 CFR Part 11 준수 시스템</p>
            </div>
            
            <form id="login-form" class="space-y-6">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  <i class="fas fa-envelope mr-1"></i> 이메일
                </label>
                <input type="email" id="login-email" required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ecrf-blue focus:border-transparent"
                  placeholder="user@example.com">
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  <i class="fas fa-lock mr-1"></i> 비밀번호
                </label>
                <input type="password" id="login-password" required
                  class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ecrf-blue focus:border-transparent"
                  placeholder="••••••••">
              </div>
              
              <div id="login-error" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              </div>
              
              <button type="submit"
                class="w-full bg-ecrf-blue text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition font-medium">
                <i class="fas fa-sign-in-alt mr-2"></i> 로그인
              </button>
            </form>
            
            <div class="mt-6 text-center text-sm text-gray-500">
              <p>테스트 계정: admin@ecrf.local / Test1234!</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Dashboard (shown when authenticated) -->
      <div id="dashboard-section" class="hidden">
        <!-- User Info -->
        <div class="mb-6 bg-white rounded-lg shadow p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <div class="w-12 h-12 bg-ecrf-blue rounded-full flex items-center justify-center text-white text-lg font-bold">
                <span id="user-initials">--</span>
              </div>
              <div class="ml-4">
                <h3 id="user-name" class="font-semibold text-gray-900">사용자</h3>
                <p id="user-role" class="text-sm text-gray-500">역할</p>
              </div>
            </div>
            <div class="text-sm text-gray-500">
              <span id="last-login">마지막 로그인: --</span>
            </div>
          </div>
        </div>

        <!-- Quick Stats -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center">
              <div class="p-3 bg-blue-100 rounded-full">
                <i class="fas fa-flask text-ecrf-blue text-xl"></i>
              </div>
              <div class="ml-4">
                <p class="text-sm text-gray-500">임상시험</p>
                <p id="stat-studies" class="text-2xl font-bold text-gray-900">0</p>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center">
              <div class="p-3 bg-green-100 rounded-full">
                <i class="fas fa-hospital text-ecrf-green text-xl"></i>
              </div>
              <div class="ml-4">
                <p class="text-sm text-gray-500">연구기관</p>
                <p id="stat-sites" class="text-2xl font-bold text-gray-900">0</p>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center">
              <div class="p-3 bg-purple-100 rounded-full">
                <i class="fas fa-users text-purple-600 text-xl"></i>
              </div>
              <div class="ml-4">
                <p class="text-sm text-gray-500">피험자</p>
                <p id="stat-subjects" class="text-2xl font-bold text-gray-900">0</p>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center">
              <div class="p-3 bg-yellow-100 rounded-full">
                <i class="fas fa-question-circle text-ecrf-yellow text-xl"></i>
              </div>
              <div class="ml-4">
                <p class="text-sm text-gray-500">미결 Query</p>
                <p id="stat-queries" class="text-2xl font-bold text-gray-900">0</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Studies List -->
        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-flask mr-2"></i> 임상시험 목록
            </h2>
            <button id="btn-new-study" class="hidden bg-ecrf-blue text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
              <i class="fas fa-plus mr-1"></i> 새 임상시험
            </button>
          </div>
          <div id="studies-list" class="divide-y">
            <div class="p-8 text-center text-gray-500">
              <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
              <p>데이터를 불러오는 중...</p>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-white border-t mt-auto">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500">
          <p>eCRF PWA v1.0.0 - 21 CFR Part 11 준수 시스템</p>
          <p class="mt-2 md:mt-0">
            <i class="fas fa-shield-alt mr-1"></i> 
            데이터 무결성 및 감사 추적 지원
          </p>
        </div>
      </div>
    </footer>
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
