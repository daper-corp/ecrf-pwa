// eCRF PWA - Frontend Application
// 21 CFR Part 11 준수를 위한 클라이언트 사이드 로직

(function() {
  'use strict';

  // =====================================================
  // STATE MANAGEMENT
  // =====================================================
  const state = {
    token: localStorage.getItem('ecrf_token'),
    user: JSON.parse(localStorage.getItem('ecrf_user') || 'null'),
    studies: [],
    currentStudy: null,
  };

  // =====================================================
  // API CLIENT
  // =====================================================
  const api = {
    baseUrl: '/api',
    
    async request(method, path, data = null) {
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (state.token) {
        config.headers['Authorization'] = `Bearer ${state.token}`;
      }

      if (data) {
        config.data = data;
      }

      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        if (error.response?.status === 401) {
          // 인증 만료 - 로그아웃 처리
          logout(false);
        }
        throw error.response?.data || { error: '요청 처리 중 오류가 발생했습니다.' };
      }
    },

    get(path) { return this.request('GET', path); },
    post(path, data) { return this.request('POST', path, data); },
    put(path, data) { return this.request('PUT', path, data); },
    delete(path) { return this.request('DELETE', path); },
  };

  // =====================================================
  // UI HELPERS
  // =====================================================
  const ui = {
    show(selector) {
      const el = document.querySelector(selector);
      if (el) el.classList.remove('hidden');
    },

    hide(selector) {
      const el = document.querySelector(selector);
      if (el) el.classList.add('hidden');
    },

    setText(selector, text) {
      const el = document.querySelector(selector);
      if (el) el.textContent = text;
    },

    setHtml(selector, html) {
      const el = document.querySelector(selector);
      if (el) el.innerHTML = html;
    },

    showError(selector, message) {
      const el = document.querySelector(selector);
      if (el) {
        el.textContent = message;
        el.classList.remove('hidden');
      }
    },

    hideError(selector) {
      const el = document.querySelector(selector);
      if (el) el.classList.add('hidden');
    },

    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    getStatusBadge(status) {
      const badges = {
        DRAFT: '<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">준비중</span>',
        ACTIVE: '<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">진행중</span>',
        COMPLETED: '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">완료</span>',
        LOCKED: '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">잠김</span>',
        CANCELLED: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">취소</span>',
        PENDING: '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">대기중</span>',
        SCREENING: '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">스크리닝</span>',
        ENROLLED: '<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">등록</span>',
        WITHDRAWN: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">중도탈락</span>',
      };
      return badges[status] || `<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">${status}</span>`;
    },

    getRoleName(role) {
      const roles = {
        ADMIN: '시스템 관리자',
        PI: '책임연구자 (PI)',
        SUB_INV: '공동연구자',
        CRC: '연구간호사 (CRC)',
        CRA: '모니터 (CRA)',
        DM: '데이터 관리자',
      };
      return roles[role] || role;
    },

    getInitials(name) {
      if (!name) return '--';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    },
  };

  // =====================================================
  // AUTHENTICATION
  // =====================================================
  async function login(email, password) {
    try {
      const result = await api.post('/auth/login', { email, password });
      
      if (result.success) {
        state.token = result.data.token;
        state.user = result.data.user;
        
        localStorage.setItem('ecrf_token', state.token);
        localStorage.setItem('ecrf_user', JSON.stringify(state.user));
        
        updateAuthUI();
        loadDashboard();
        return true;
      }
      return false;
    } catch (error) {
      throw error;
    }
  }

  async function logout(callApi = true) {
    if (callApi && state.token) {
      try {
        await api.post('/auth/logout');
      } catch (e) {
        // Ignore logout errors
      }
    }

    state.token = null;
    state.user = null;
    localStorage.removeItem('ecrf_token');
    localStorage.removeItem('ecrf_user');
    
    updateAuthUI();
  }

  function updateAuthUI() {
    const authSection = document.getElementById('auth-section');
    
    if (state.token && state.user) {
      // 로그인 상태
      ui.hide('#login-section');
      ui.show('#dashboard-section');
      
      authSection.innerHTML = `
        <span class="text-sm text-gray-600">
          <i class="fas fa-user-circle mr-1"></i>
          ${state.user.name} (${ui.getRoleName(state.user.role)})
        </span>
        <button id="btn-logout" class="text-sm text-gray-600 hover:text-red-600 transition">
          <i class="fas fa-sign-out-alt mr-1"></i> 로그아웃
        </button>
      `;
      
      document.getElementById('btn-logout').addEventListener('click', () => logout());
      
      // 사용자 정보 업데이트
      ui.setText('#user-name', state.user.name);
      ui.setText('#user-role', ui.getRoleName(state.user.role));
      ui.setText('#user-initials', ui.getInitials(state.user.name));
      ui.setText('#last-login', `마지막 로그인: ${ui.formatDateTime(state.user.last_login_at)}`);
      
      // 관리자 권한이면 새 임상시험 버튼 표시
      if (['ADMIN', 'DM'].includes(state.user.role)) {
        ui.show('#btn-new-study');
      }
    } else {
      // 비로그인 상태
      ui.show('#login-section');
      ui.hide('#dashboard-section');
      
      authSection.innerHTML = '';
    }
  }

  // =====================================================
  // DASHBOARD
  // =====================================================
  async function loadDashboard() {
    try {
      // 임상시험 목록 로드
      const studiesResult = await api.get('/studies');
      state.studies = studiesResult.data || [];
      
      renderStudiesList();
      updateStats();
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      ui.setHtml('#studies-list', `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-2xl mb-2"></i>
          <p>데이터를 불러오는데 실패했습니다.</p>
        </div>
      `);
    }
  }

  function renderStudiesList() {
    const container = document.getElementById('studies-list');
    
    if (state.studies.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-folder-open text-4xl mb-4"></i>
          <p>등록된 임상시험이 없습니다.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.studies.map(study => `
      <div class="p-4 hover:bg-gray-50 transition cursor-pointer" data-study-id="${study.id}">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center">
              <h3 class="font-semibold text-gray-900">${study.protocol_number}</h3>
              ${ui.getStatusBadge(study.status)}
              ${study.phase ? `<span class="ml-2 text-xs text-gray-500">Phase ${study.phase}</span>` : ''}
            </div>
            <p class="text-sm text-gray-600 mt-1 line-clamp-1">${study.title}</p>
            <div class="flex items-center mt-2 text-xs text-gray-500 space-x-4">
              <span><i class="fas fa-building mr-1"></i> ${study.sponsor || '-'}</span>
              <span><i class="fas fa-calendar mr-1"></i> ${ui.formatDate(study.study_start_date)}</span>
              ${study.irb_approval_number ? `<span><i class="fas fa-certificate mr-1"></i> IRB: ${study.irb_approval_number}</span>` : ''}
            </div>
          </div>
          <div class="ml-4">
            <i class="fas fa-chevron-right text-gray-400"></i>
          </div>
        </div>
      </div>
    `).join('');

    // 클릭 이벤트 추가
    container.querySelectorAll('[data-study-id]').forEach(el => {
      el.addEventListener('click', () => {
        const studyId = el.getAttribute('data-study-id');
        viewStudy(studyId);
      });
    });
  }

  function updateStats() {
    const activeStudies = state.studies.filter(s => s.status === 'ACTIVE').length;
    ui.setText('#stat-studies', state.studies.length.toString());
    // Sites, Subjects, Queries는 실제 API 호출로 가져와야 함
    ui.setText('#stat-sites', '-');
    ui.setText('#stat-subjects', '-');
    ui.setText('#stat-queries', '-');
  }

  async function viewStudy(studyId) {
    try {
      const result = await api.get(`/studies/${studyId}`);
      if (result.success) {
        state.currentStudy = result.data;
        // TODO: 상세 페이지 렌더링
        console.log('Study details:', result.data);
        alert(`Study: ${result.data.protocol_number}\n${result.data.title}\n\n(상세 화면은 추후 구현 예정)`);
      }
    } catch (error) {
      console.error('Failed to load study:', error);
    }
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================
  function setupEventHandlers() {
    // 로그인 폼
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        ui.hideError('#login-error');
        
        try {
          await login(email, password);
        } catch (error) {
          ui.showError('#login-error', error.error || '로그인에 실패했습니다.');
        }
      });
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================
  function init() {
    setupEventHandlers();
    updateAuthUI();
    
    if (state.token && state.user) {
      loadDashboard();
    }

    // Service Worker 등록 (PWA)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/static/sw.js')
        .then(reg => console.log('Service Worker registered:', reg.scope))
        .catch(err => console.log('Service Worker registration failed:', err));
    }
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
