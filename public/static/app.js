// eCRF PWA - Frontend Application
// Professional Clinical Data Management System
// Version 3.0 - Clean Enterprise UI

(function() {
  'use strict';

  // =====================================================
  // CONFIGURATION
  // =====================================================
  const CONFIG = {
    sessionTimeout: 30 * 60 * 1000,
    autoSaveInterval: 30 * 1000,
  };

  // =====================================================
  // STATE MANAGEMENT
  // =====================================================
  const state = {
    token: localStorage.getItem('ecrf_token'),
    user: JSON.parse(localStorage.getItem('ecrf_user') || 'null'),
    studies: [],
    currentStudy: null,
    currentSite: null,
    currentSubject: null,
    currentVisit: null,
    currentView: 'dashboard',
    lastActivity: Date.now(),
    isOnline: navigator.onLine,
  };

  // =====================================================
  // API CLIENT
  // =====================================================
  const api = {
    baseUrl: '/api',
    
    async request(method, path, data = null) {
      state.lastActivity = Date.now();
      
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: { 'Content-Type': 'application/json' },
      };

      if (state.token) {
        config.headers['Authorization'] = `Bearer ${state.token}`;
      }

      if (data) config.data = data;

      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        if (error.response?.status === 401) {
          logout(false);
          showToast('세션이 만료되었습니다.', 'error');
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
  // UI UTILITIES
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

    setHtml(selector, html) {
      const el = document.querySelector(selector);
      if (el) el.innerHTML = html;
    },

    formatDate(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleDateString('ko-KR');
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleString('ko-KR');
    },

    getInitials(name) {
      if (!name) return '--';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    },

    getRoleName(role) {
      const roles = {
        ADMIN: '시스템 관리자',
        PI: '책임연구자',
        SUB_INV: '공동연구자',
        CRC: '연구간호사',
        CRA: '모니터',
        DM: '데이터 관리자',
      };
      return roles[role] || role;
    },

    getRoleShort(role) {
      const roles = {
        ADMIN: 'Admin',
        PI: 'PI',
        SUB_INV: 'Sub-Inv',
        CRC: 'CRC',
        CRA: 'CRA',
        DM: 'DM',
      };
      return roles[role] || role;
    },

    canWrite() {
      return state.user && ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'DM'].includes(state.user.role);
    },

    canManage() {
      return state.user && ['ADMIN', 'DM'].includes(state.user.role);
    },
  };

  // =====================================================
  // STATUS BADGE
  // =====================================================
  function getStatusBadge(status) {
    const config = {
      ACTIVE: { class: 'badge-active', label: '진행중' },
      DRAFT: { class: 'badge-draft', label: '초안' },
      PENDING: { class: 'badge-pending', label: '대기' },
      COMPLETED: { class: 'badge-completed', label: '완료' },
      COMPLETE: { class: 'badge-completed', label: '완료' },
      LOCKED: { class: 'badge-locked', label: '잠금' },
      FROZEN: { class: 'badge-locked', label: '동결' },
      OPEN: { class: 'badge-open', label: '미결' },
      ANSWERED: { class: 'badge-pending', label: '답변됨' },
      CLOSED: { class: 'badge-closed', label: '종료' },
      SCREENING: { class: 'badge-pending', label: '스크리닝' },
      ENROLLED: { class: 'badge-active', label: '등록' },
      RANDOMIZED: { class: 'badge-active', label: '무작위배정' },
      WITHDRAWN: { class: 'badge-open', label: '중도탈락' },
      SIGNED: { class: 'badge-completed', label: '서명완료' },
      SCHEDULED: { class: 'badge-draft', label: '예정' },
      IN_PROGRESS: { class: 'badge-pending', label: '진행중' },
    };
    const c = config[status] || { class: 'badge-draft', label: status };
    return `<span class="badge ${c.class}">${c.label}</span>`;
  }

  // =====================================================
  // TOAST NOTIFICATIONS
  // =====================================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
      <span>${message}</span>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
  window.showToast = showToast;

  // =====================================================
  // MODAL
  // =====================================================
  function showModal(title, content, actions = []) {
    const container = document.getElementById('modal-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="modal-overlay" onclick="closeModal()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
            <button class="modal-close" onclick="closeModal()">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">${content}</div>
          ${actions.length > 0 ? `
            <div class="modal-footer">
              ${actions.map(a => `
                <button class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'}" onclick="${a.onclick}">
                  ${a.label}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
  window.showModal = showModal;

  function closeModal() {
    const container = document.getElementById('modal-container');
    if (container) container.innerHTML = '';
  }
  window.closeModal = closeModal;

  // =====================================================
  // AUTHENTICATION
  // =====================================================
  async function login(email, password, twoFaCode = null) {
    try {
      const payload = { email, password };
      if (twoFaCode) payload.twoFaCode = twoFaCode;
      
      const result = await api.post('/auth/login', payload);
      
      if (result.success) {
        state.token = result.data.token;
        state.user = result.data.user;
        localStorage.setItem('ecrf_token', state.token);
        localStorage.setItem('ecrf_user', JSON.stringify(state.user));
        
        updateAuthUI();
        navigateTo('dashboard');
        showToast('로그인 성공', 'success');
        return true;
      }
      return false;
    } catch (error) {
      throw error;
    }
  }

  async function logout(callApi = true) {
    if (callApi && state.token) {
      try { await api.post('/auth/logout'); } catch (e) {}
    }
    
    state.token = null;
    state.user = null;
    localStorage.removeItem('ecrf_token');
    localStorage.removeItem('ecrf_user');
    
    updateAuthUI();
    showToast('로그아웃 되었습니다.', 'info');
  }
  window.logout = logout;

  function updateAuthUI() {
    const authSection = document.getElementById('auth-section');
    const headerNav = document.getElementById('header-nav');
    const subHeader = document.getElementById('sub-header');
    const mobileNav = document.getElementById('mobile-nav');
    
    if (state.token && state.user) {
      ui.hide('#login-section');
      ui.show('#dashboard-section');
      if (subHeader) subHeader.style.display = 'flex';
      if (mobileNav) mobileNav.style.display = 'block';
      
      // Header Navigation
      if (headerNav) {
        headerNav.innerHTML = `
          <a class="header-nav-item active" onclick="navigateTo('dashboard')" data-view="dashboard">Dashboard</a>
          <a class="header-nav-item" onclick="navigateTo('studies')" data-view="studies">Studies</a>
          <a class="header-nav-item" onclick="navigateTo('queries')" data-view="queries">Queries</a>
          <a class="header-nav-item" onclick="navigateTo('reports')" data-view="reports">Reports</a>
        `;
      }
      
      // Auth Section (User Menu)
      if (authSection) {
        authSection.innerHTML = `
          <button class="btn-icon" title="알림">
            <i class="fas fa-bell"></i>
          </button>
          <div class="dropdown">
            <div class="header-user" onclick="toggleUserMenu()">
              <div class="user-avatar">${ui.getInitials(state.user.name)}</div>
              <span style="display: none;">${state.user.name}</span>
              <i class="fas fa-chevron-down" style="font-size: 10px; margin-left: 4px; opacity: 0.7;"></i>
            </div>
            <div class="dropdown-menu" id="user-dropdown">
              <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-light);">
                <div style="font-weight: 500; margin-bottom: 2px;">${state.user.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${state.user.email}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${ui.getRoleName(state.user.role)}</div>
              </div>
              <div class="dropdown-item" onclick="showSettings(); closeUserMenu();">
                <i class="fas fa-cog"></i>
                <span>설정</span>
              </div>
              <div class="dropdown-item" onclick="show2FASettings(); closeUserMenu();">
                <i class="fas fa-shield-alt"></i>
                <span>2단계 인증</span>
              </div>
              ${state.user.role === 'ADMIN' ? `
              <div class="dropdown-item" onclick="showUserManagement(); closeUserMenu();">
                <i class="fas fa-users-cog"></i>
                <span>사용자 관리</span>
              </div>
              ` : ''}
              <div class="dropdown-divider"></div>
              <div class="dropdown-item" onclick="logout(); closeUserMenu();" style="color: var(--danger);">
                <i class="fas fa-sign-out-alt"></i>
                <span>로그아웃</span>
              </div>
            </div>
          </div>
        `;
      }
    } else {
      ui.show('#login-section');
      ui.hide('#dashboard-section');
      if (subHeader) subHeader.style.display = 'none';
      if (mobileNav) mobileNav.style.display = 'none';
      if (headerNav) headerNav.innerHTML = '';
      if (authSection) authSection.innerHTML = '';
    }
  }

  function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.toggle('show');
  }
  window.toggleUserMenu = toggleUserMenu;

  function closeUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.remove('show');
  }
  window.closeUserMenu = closeUserMenu;

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      closeUserMenu();
    }
  });

  // =====================================================
  // NAVIGATION
  // =====================================================
  function navigateTo(view, params = {}) {
    state.currentView = view;
    
    // Update header nav active state
    document.querySelectorAll('.header-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    
    // Update mobile nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    
    updateBreadcrumb(view, params);
    
    switch (view) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'studies':
        loadDashboard(); // Studies list is on dashboard
        break;
      case 'study':
        loadStudyDetail(params.studyId);
        break;
      case 'site':
        loadSiteDetail(params.siteId);
        break;
      case 'subject':
        loadSubjectDetail(params.subjectId);
        break;
      case 'visit':
        loadVisitDetail(params.visitId);
        break;
      case 'queries':
        loadQueriesList(params);
        break;
      case 'reports':
        loadReports();
        break;
      default:
        loadDashboard();
    }
  }
  window.navigateTo = navigateTo;

  function updateBreadcrumb(view, params) {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;

    let html = '<a href="#" onclick="navigateTo(\'dashboard\')">Home</a>';
    
    if (state.currentStudy && ['study', 'site', 'subject', 'visit'].includes(view)) {
      html += ` <span>/</span> <a href="#" onclick="navigateTo('study', {studyId:'${state.currentStudy.id}'})">${state.currentStudy.protocol_number}</a>`;
    }
    
    if (state.currentSite && ['site', 'subject', 'visit'].includes(view)) {
      html += ` <span>/</span> <a href="#" onclick="navigateTo('site', {siteId:'${state.currentSite.id}'})">Site ${state.currentSite.site_number}</a>`;
    }
    
    if (state.currentSubject && ['subject', 'visit'].includes(view)) {
      html += ` <span>/</span> <a href="#" onclick="navigateTo('subject', {subjectId:'${state.currentSubject.id}'})">${state.currentSubject.subject_number}</a>`;
    }
    
    if (view === 'queries') {
      html += ' <span>/</span> <span style="color: var(--text-primary);">Queries</span>';
    }
    
    if (view === 'reports') {
      html += ' <span>/</span> <span style="color: var(--text-primary);">Reports</span>';
    }

    breadcrumb.innerHTML = html;
  }

  // =====================================================
  // DASHBOARD
  // =====================================================
  async function loadDashboard() {
    state.currentStudy = null;
    state.currentSite = null;
    state.currentSubject = null;
    state.currentVisit = null;

    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <!-- Welcome Banner -->
      <div class="welcome-banner">
        <div class="welcome-info">
          <div class="welcome-avatar">${ui.getInitials(state.user?.name)}</div>
          <div class="welcome-text">
            <h2>안녕하세요, ${state.user?.name || '사용자'}님</h2>
            <p>${ui.getRoleName(state.user?.role)} · 마지막 접속: ${new Date().toLocaleDateString('ko-KR')}</p>
          </div>
        </div>
        <div class="welcome-meta">
          <div>${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">임상시험</div>
          <div class="stat-value" id="stat-studies">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">피험자</div>
          <div class="stat-value" id="stat-subjects">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">미해결 Query</div>
          <div class="stat-value" id="stat-queries">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">서명 대기</div>
          <div class="stat-value" id="stat-signatures">-</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">빠른 작업</span>
        </div>
        <div class="card-body">
          <div class="quick-actions">
            <div class="quick-action" onclick="showSubjectSearch()">
              <i class="fas fa-search"></i>
              <span>피험자 검색</span>
            </div>
            <div class="quick-action" onclick="navigateTo('queries')">
              <i class="fas fa-comment-medical"></i>
              <span>Query 관리</span>
            </div>
            <div class="quick-action" onclick="navigateTo('reports')">
              <i class="fas fa-chart-bar"></i>
              <span>리포트</span>
            </div>
            <div class="quick-action" onclick="showExportOptions()">
              <i class="fas fa-file-export"></i>
              <span>데이터 Export</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Studies List -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">임상시험 목록</span>
          ${ui.canManage() ? `
            <button class="btn btn-primary btn-sm" onclick="showNewStudyModal()">
              <i class="fas fa-plus"></i> 새 Study
            </button>
          ` : ''}
        </div>
        <div class="card-body compact" id="studies-list">
          <div class="loading">
            <div class="spinner"></div>
            <span>데이터를 불러오는 중...</span>
          </div>
        </div>
      </div>
    `;

    try {
      const studiesResult = await api.get('/studies');
      state.studies = studiesResult.data || [];
      renderStudiesList();
      loadDashboardStats();
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      ui.setHtml('#studies-list', `
        <div class="empty-state">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>데이터 로드 실패</h3>
          <p>임상시험 목록을 불러올 수 없습니다.</p>
        </div>
      `);
    }
  }

  function renderStudiesList() {
    const container = document.getElementById('studies-list');
    if (!container) return;
    
    if (state.studies.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-flask"></i>
          <h3>등록된 임상시험이 없습니다</h3>
          <p>새로운 임상시험을 등록해 주세요.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.studies.map(study => `
      <div class="study-item" onclick="navigateTo('study', {studyId: '${study.id}'})">
        <div class="study-item-header">
          <span class="study-protocol">${study.protocol_number}</span>
          ${getStatusBadge(study.status)}
          ${study.phase ? `<span class="badge badge-draft">Phase ${study.phase}</span>` : ''}
        </div>
        <div class="study-title">${study.title}</div>
        <div class="study-meta">
          <span class="study-meta-item">
            <i class="fas fa-building"></i> ${study.sponsor || '-'}
          </span>
          <span class="study-meta-item">
            <i class="fas fa-calendar"></i> ${ui.formatDate(study.study_start_date)}
          </span>
          ${study.therapeutic_area ? `
            <span class="study-meta-item">
              <i class="fas fa-heartbeat"></i> ${study.therapeutic_area}
            </span>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  async function loadDashboardStats() {
    document.getElementById('stat-studies').textContent = state.studies.length.toString();
    
    if (state.studies.length > 0) {
      try {
        let totalSubjects = 0;
        let totalQueries = 0;
        let totalSignatures = 0;

        for (const study of state.studies.slice(0, 5)) {
          const stats = await api.get(`/studies/${study.id}/stats`);
          if (stats.success && stats.data) {
            totalSubjects += (stats.data.subjects || []).reduce((sum, s) => sum + s.count, 0);
            const openQueries = (stats.data.queries || []).find(q => q.status === 'OPEN');
            totalQueries += openQueries?.count || 0;
          }
        }

        document.getElementById('stat-subjects').textContent = totalSubjects.toString();
        document.getElementById('stat-queries').textContent = totalQueries.toString();
        document.getElementById('stat-signatures').textContent = totalSignatures.toString();
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }
  }

  // =====================================================
  // STUDY DETAIL
  // =====================================================
  async function loadStudyDetail(studyId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Study 정보를 불러오는 중...</span>
      </div>
    `;

    try {
      const result = await api.get(`/studies/${studyId}`);
      if (!result.success) throw new Error(result.error);

      state.currentStudy = result.data;
      const study = result.data;

      const sitesResult = await api.get(`/studies/${studyId}/sites`);
      const sites = sitesResult.data || [];

      const statsResult = await api.get(`/studies/${studyId}/stats`);
      const stats = statsResult.data || {};

      mainContent.innerHTML = `
        <!-- Study Header -->
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">${study.protocol_number}</h1>
                  ${getStatusBadge(study.status)}
                  ${study.phase ? `<span class="badge badge-draft">Phase ${study.phase}</span>` : ''}
                </div>
                <p style="color: var(--text-secondary);">${study.title}</p>
              </div>
              <div style="display: flex; gap: 8px;">
                ${ui.canManage() ? `
                  <button class="btn btn-secondary btn-sm" onclick="showEditStudyModal('${study.id}')">
                    <i class="fas fa-edit"></i> 수정
                  </button>
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">스폰서</div>
                <div style="font-weight: 500;">${study.sponsor || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">IRB 승인번호</div>
                <div style="font-weight: 500;">${study.irb_approval_number || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">시작일</div>
                <div style="font-weight: 500;">${ui.formatDate(study.study_start_date)}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">버전</div>
                <div style="font-weight: 500;">${study.version || '1.0'}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">연구기관</div>
            <div class="stat-value">${sites.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">피험자</div>
            <div class="stat-value">${study.subjectsCount || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">CRF</div>
            <div class="stat-value">${(stats.crfs || []).reduce((sum, c) => sum + c.count, 0)}</div>
          </div>
          <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('queries', {studyId: '${study.id}'})">
            <div class="stat-label">미결 Query</div>
            <div class="stat-value">${(stats.queries || []).find(q => q.status === 'OPEN')?.count || 0}</div>
          </div>
        </div>

        <!-- Sites List -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">연구기관 목록 (${sites.length})</span>
            ${ui.canManage() ? `
              <button class="btn btn-primary btn-sm" onclick="showNewSiteModal('${study.id}')">
                <i class="fas fa-plus"></i> 기관 추가
              </button>
            ` : ''}
          </div>
          <div class="card-body compact">
            ${sites.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-hospital"></i>
                <h3>등록된 연구기관이 없습니다</h3>
              </div>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>기관번호</th>
                    <th>기관명</th>
                    <th>PI</th>
                    <th>상태</th>
                    <th>피험자</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${sites.map(site => `
                    <tr class="clickable" onclick="navigateTo('site', {siteId: '${site.id}'})">
                      <td><strong>${site.site_number}</strong></td>
                      <td>${site.name}</td>
                      <td>${site.pi_name || '-'}</td>
                      <td>${getStatusBadge(site.status)}</td>
                      <td>${site.subject_count || 0}명</td>
                      <td style="color: var(--text-muted);"><i class="fas fa-chevron-right"></i></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load study:', error);
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 40px;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>Study 로드 실패</h3>
          <p>Study 정보를 불러올 수 없습니다.</p>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">
            대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  // =====================================================
  // SITE DETAIL
  // =====================================================
  async function loadSiteDetail(siteId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Site 정보를 불러오는 중...</span>
      </div>
    `;

    try {
      const result = await api.get(`/sites/${siteId}`);
      if (!result.success) throw new Error(result.error);

      state.currentSite = result.data;
      const site = result.data;

      if (site.study_id && (!state.currentStudy || state.currentStudy.id !== site.study_id)) {
        const studyResult = await api.get(`/studies/${site.study_id}`);
        state.currentStudy = studyResult.data;
      }

      const subjectsResult = await api.get(`/sites/${siteId}/subjects`);
      const subjects = subjectsResult.data || [];

      mainContent.innerHTML = `
        <!-- Site Header -->
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">Site ${site.site_number}</h1>
                  ${getStatusBadge(site.status)}
                </div>
                <p style="color: var(--text-secondary);">${site.name}</p>
              </div>
              <div style="display: flex; gap: 8px;">
                ${ui.canManage() ? `
                  <button class="btn btn-secondary btn-sm" onclick="showEditSiteModal('${site.id}')">
                    <i class="fas fa-edit"></i> 수정
                  </button>
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">PI</div>
                <div style="font-weight: 500;">${site.pi_name || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">이메일</div>
                <div style="font-weight: 500;">${site.pi_email || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">주소</div>
                <div style="font-weight: 500;">${site.address || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">등록 피험자</div>
                <div style="font-weight: 500;">${subjects.length}명</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Subjects List -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">피험자 목록 (${subjects.length})</span>
            ${ui.canWrite() && site.status === 'ACTIVE' ? `
              <button class="btn btn-primary btn-sm" onclick="showNewSubjectModal('${site.id}')">
                <i class="fas fa-user-plus"></i> 피험자 등록
              </button>
            ` : ''}
          </div>
          <div class="card-body compact">
            ${subjects.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-users"></i>
                <h3>등록된 피험자가 없습니다</h3>
              </div>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Subject ID</th>
                    <th>Screening #</th>
                    <th>이니셜</th>
                    <th>상태</th>
                    <th>등록일</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${subjects.map(subj => `
                    <tr class="clickable" onclick="navigateTo('subject', {subjectId: '${subj.id}'})">
                      <td><strong>${subj.subject_number}</strong></td>
                      <td>${subj.screening_number || '-'}</td>
                      <td>${subj.initials || '-'}</td>
                      <td>${getStatusBadge(subj.status)}</td>
                      <td>${ui.formatDate(subj.screening_date || subj.created_at)}</td>
                      <td style="color: var(--text-muted);"><i class="fas fa-chevron-right"></i></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load site:', error);
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 40px;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>Site 로드 실패</h3>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">
            대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  // =====================================================
  // SUBJECT DETAIL
  // =====================================================
  async function loadSubjectDetail(subjectId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>피험자 정보를 불러오는 중...</span>
      </div>
    `;

    try {
      const result = await api.get(`/subjects/${subjectId}`);
      if (!result.success) throw new Error(result.error);

      state.currentSubject = result.data;
      const subject = result.data;

      if (subject.site_id && (!state.currentSite || state.currentSite.id !== subject.site_id)) {
        const siteResult = await api.get(`/sites/${subject.site_id}`);
        state.currentSite = siteResult.data;
      }
      if (subject.study_id && (!state.currentStudy || state.currentStudy.id !== subject.study_id)) {
        const studyResult = await api.get(`/studies/${subject.study_id}`);
        state.currentStudy = studyResult.data;
      }

      const visits = subject.visits || [];

      mainContent.innerHTML = `
        <!-- Subject Header -->
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">${subject.subject_number}</h1>
                  ${getStatusBadge(subject.status)}
                </div>
                <p style="color: var(--text-secondary);">
                  ${subject.site_name || ''} · Screening #: ${subject.screening_number || '-'}
                  ${subject.randomization_number ? ` · Rand #: ${subject.randomization_number}` : ''}
                </p>
              </div>
              <div style="display: flex; gap: 8px;">
                ${ui.canWrite() && !['COMPLETED', 'WITHDRAWN'].includes(subject.status) ? `
                  <button class="btn btn-danger btn-sm" onclick="showWithdrawModal('${subject.id}')">
                    <i class="fas fa-user-slash"></i> 중도탈락
                  </button>
                ` : ''}
                ${ui.canWrite() ? `
                  <button class="btn btn-secondary btn-sm" onclick="showEditSubjectModal('${subject.id}')">
                    <i class="fas fa-edit"></i> 수정
                  </button>
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">이니셜</div>
                <div style="font-weight: 500;">${subject.initials || '-'}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">스크리닝일</div>
                <div style="font-weight: 500;">${ui.formatDate(subject.screening_date)}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">등록일</div>
                <div style="font-weight: 500;">${ui.formatDate(subject.enrolled_date)}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">무작위배정일</div>
                <div style="font-weight: 500;">${ui.formatDate(subject.randomized_date)}</div>
              </div>
            </div>
            
            ${subject.status === 'WITHDRAWN' ? `
              <div style="margin-top: 16px; padding: 12px; background: #ffebee; border-radius: 4px; color: #c62828; font-size: 13px;">
                <i class="fas fa-exclamation-triangle"></i>
                중도탈락: ${subject.withdrawal_reason || '사유 미기재'} (${ui.formatDate(subject.withdrawn_date)})
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Visit Timeline -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">방문 일정</span>
          </div>
          <div class="card-body compact">
            ${visits.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-calendar-alt"></i>
                <h3>방문 일정이 없습니다</h3>
              </div>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>방문</th>
                    <th>방문명</th>
                    <th>상태</th>
                    <th>예정일</th>
                    <th>실제일</th>
                    <th>CRF</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${visits.map(visit => {
                    const crfStats = visit.crfStats || [];
                    const totalCRF = crfStats.reduce((sum, s) => sum + s.count, 0);
                    const completedCRF = crfStats.filter(s => ['COMPLETE', 'SIGNED', 'LOCKED'].includes(s.status)).reduce((sum, s) => sum + s.count, 0);
                    
                    return `
                      <tr class="clickable" onclick="navigateTo('visit', {visitId: '${visit.id}'})">
                        <td><strong>V${visit.visit_number}</strong></td>
                        <td>${visit.visit_name}</td>
                        <td>${getStatusBadge(visit.status)}</td>
                        <td>${ui.formatDate(visit.scheduled_date)}</td>
                        <td>${ui.formatDate(visit.actual_date)}</td>
                        <td>${completedCRF}/${totalCRF}</td>
                        <td style="color: var(--text-muted);"><i class="fas fa-chevron-right"></i></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load subject:', error);
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 40px;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>피험자 로드 실패</h3>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">
            대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  // =====================================================
  // QUERIES LIST
  // =====================================================
  async function loadQueriesList(params = {}) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Query 목록을 불러오는 중...</span>
      </div>
    `;

    try {
      let url = '/queries?limit=100';
      if (params.studyId) url += `&studyId=${params.studyId}`;
      if (params.status) url += `&status=${params.status}`;
      
      const result = await api.get(url);
      const queries = result.data || [];

      mainContent.innerHTML = `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Query 목록 (${queries.length})</span>
            <div style="display: flex; gap: 8px;">
              <select class="form-input" style="width: auto; padding: 6px 12px; font-size: 13px;" onchange="filterQueries(this.value)">
                <option value="">전체 상태</option>
                <option value="OPEN">미결</option>
                <option value="ANSWERED">답변됨</option>
                <option value="CLOSED">종료</option>
              </select>
            </div>
          </div>
          <div class="card-body compact">
            ${queries.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-comment-medical"></i>
                <h3>Query가 없습니다</h3>
              </div>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Query ID</th>
                    <th>Subject</th>
                    <th>필드</th>
                    <th>상태</th>
                    <th>우선순위</th>
                    <th>생성일</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${queries.map(q => `
                    <tr class="clickable" onclick="showQueryDetail('${q.id}')">
                      <td><strong>${q.id.substring(0, 8)}</strong></td>
                      <td>${q.subject_number || '-'}</td>
                      <td>${q.field_name || '-'}</td>
                      <td>${getStatusBadge(q.status)}</td>
                      <td>
                        <span class="badge ${q.priority === 'CRITICAL' ? 'badge-open' : q.priority === 'MAJOR' ? 'badge-pending' : 'badge-draft'}">
                          ${q.priority || 'MINOR'}
                        </span>
                      </td>
                      <td>${ui.formatDate(q.created_at)}</td>
                      <td style="color: var(--text-muted);"><i class="fas fa-chevron-right"></i></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load queries:', error);
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 40px;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>Query 로드 실패</h3>
        </div>
      `;
    }
  }
  window.filterQueries = function(status) {
    loadQueriesList({ status });
  };

  // =====================================================
  // REPORTS
  // =====================================================
  async function loadReports() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Reports & Analytics</span>
        </div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
            <div class="quick-action" onclick="generateReport('enrollment')">
              <i class="fas fa-user-plus"></i>
              <span>Enrollment Report</span>
            </div>
            <div class="quick-action" onclick="generateReport('query')">
              <i class="fas fa-comment-medical"></i>
              <span>Query Status Report</span>
            </div>
            <div class="quick-action" onclick="generateReport('crf')">
              <i class="fas fa-file-alt"></i>
              <span>CRF Completion Report</span>
            </div>
            <div class="quick-action" onclick="generateReport('audit')">
              <i class="fas fa-history"></i>
              <span>Audit Trail Report</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // =====================================================
  // USER MANAGEMENT
  // =====================================================
  async function showUserManagement() {
    if (state.user?.role !== 'ADMIN') {
      showToast('권한이 없습니다.', 'error');
      return;
    }

    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>사용자 목록을 불러오는 중...</span>
      </div>
    `;

    try {
      const result = await api.get('/auth/users?limit=100');
      const users = result.data || [];

      mainContent.innerHTML = `
        <div class="card">
          <div class="card-header">
            <span class="card-title">사용자 관리 (${users.length})</span>
            <button class="btn btn-primary btn-sm" onclick="showNewUserModal()">
              <i class="fas fa-user-plus"></i> 사용자 추가
            </button>
          </div>
          <div class="card-body compact">
            <table class="data-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>2FA</th>
                  <th>마지막 접속</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td><strong>${u.name}</strong></td>
                    <td>${u.email}</td>
                    <td><span class="badge badge-draft">${ui.getRoleShort(u.role)}</span></td>
                    <td>${getStatusBadge(u.status)}</td>
                    <td>${u.two_factor_enabled ? '<i class="fas fa-shield-alt" style="color: var(--success);"></i>' : '-'}</td>
                    <td>${ui.formatDateTime(u.last_login)}</td>
                    <td>
                      <button class="btn-icon" onclick="showEditUserModal('${u.id}')" title="수정">
                        <i class="fas fa-edit"></i>
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load users:', error);
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 40px;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>사용자 목록 로드 실패</h3>
        </div>
      `;
    }
  }
  window.showUserManagement = showUserManagement;

  // =====================================================
  // PLACEHOLDER FUNCTIONS
  // =====================================================
  function showSettings() {
    showModal('설정', `
      <div class="form-group">
        <label class="form-label">알림 설정</label>
        <select class="form-input">
          <option>모든 알림 받기</option>
          <option>중요 알림만</option>
          <option>알림 끄기</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">언어</label>
        <select class="form-input">
          <option>한국어</option>
          <option>English</option>
        </select>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: 'closeModal(); showToast("설정이 저장되었습니다.", "success");' }
    ]);
  }
  window.showSettings = showSettings;

  function show2FASettings() {
    showModal('2단계 인증', `
      <p style="margin-bottom: 16px; color: var(--text-secondary);">
        2단계 인증을 활성화하면 로그인 시 추가 보안 코드가 필요합니다.
      </p>
      <div style="padding: 16px; background: var(--bg-secondary); border-radius: 4px; text-align: center;">
        <i class="fas fa-shield-alt" style="font-size: 48px; color: var(--primary); margin-bottom: 12px;"></i>
        <p style="font-weight: 500;">2FA ${state.user?.two_factor_enabled ? '활성화됨' : '비활성화됨'}</p>
      </div>
    `, [
      { label: '닫기', onclick: 'closeModal()' },
      { label: state.user?.two_factor_enabled ? '비활성화' : '활성화', primary: true, onclick: 'closeModal();' }
    ]);
  }
  window.show2FASettings = show2FASettings;

  function showSubjectSearch() {
    showModal('피험자 검색', `
      <div class="form-group">
        <label class="form-label">Subject ID 또는 Screening #</label>
        <input type="text" class="form-input" placeholder="검색어 입력..." id="subject-search-input">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '검색', primary: true, onclick: 'searchSubject()' }
    ]);
  }
  window.showSubjectSearch = showSubjectSearch;

  function showExportOptions() {
    showModal('데이터 Export', `
      <p style="margin-bottom: 16px; color: var(--text-secondary);">
        Export 형식을 선택하세요.
      </p>
      <div style="display: grid; gap: 8px;">
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showToast('ODM Export 준비 중...', 'info');">
          <i class="fas fa-file-code"></i> CDISC ODM 1.3
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showToast('SDTM Export 준비 중...', 'info');">
          <i class="fas fa-database"></i> CDISC SDTM
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showToast('Excel Export 준비 중...', 'info');">
          <i class="fas fa-file-excel"></i> Excel (.xlsx)
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showToast('CSV Export 준비 중...', 'info');">
          <i class="fas fa-file-csv"></i> CSV
        </button>
      </div>
    `, [
      { label: '닫기', onclick: 'closeModal()' }
    ]);
  }
  window.showExportOptions = showExportOptions;

  function showMobileMenu() {
    showModal('메뉴', `
      <div style="display: grid; gap: 8px;">
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); navigateTo('reports');">
          <i class="fas fa-chart-bar"></i> 리포트
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showExportOptions();">
          <i class="fas fa-file-export"></i> 데이터 Export
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showSettings();">
          <i class="fas fa-cog"></i> 설정
        </button>
        ${state.user?.role === 'ADMIN' ? `
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="closeModal(); showUserManagement();">
          <i class="fas fa-users-cog"></i> 사용자 관리
        </button>
        ` : ''}
        <button class="btn btn-secondary" style="justify-content: flex-start; color: var(--danger);" onclick="closeModal(); logout();">
          <i class="fas fa-sign-out-alt"></i> 로그아웃
        </button>
      </div>
    `, []);
  }
  window.showMobileMenu = showMobileMenu;

  function showNewStudyModal() {
    showModal('새 Study 등록', `
      <div class="form-group">
        <label class="form-label">Protocol Number <span class="required">*</span></label>
        <input type="text" class="form-input" id="new-study-protocol" placeholder="예: ABC-001">
      </div>
      <div class="form-group">
        <label class="form-label">Study Title <span class="required">*</span></label>
        <input type="text" class="form-input" id="new-study-title" placeholder="임상시험 제목">
      </div>
      <div class="form-group">
        <label class="form-label">Sponsor</label>
        <input type="text" class="form-input" id="new-study-sponsor" placeholder="스폰서 기관명">
      </div>
      <div class="form-group">
        <label class="form-label">Phase</label>
        <select class="form-input" id="new-study-phase">
          <option value="">선택</option>
          <option value="1">Phase 1</option>
          <option value="2">Phase 2</option>
          <option value="3">Phase 3</option>
          <option value="4">Phase 4</option>
        </select>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', primary: true, onclick: 'createStudy()' }
    ]);
  }
  window.showNewStudyModal = showNewStudyModal;

  async function createStudy() {
    const protocol = document.getElementById('new-study-protocol')?.value;
    const title = document.getElementById('new-study-title')?.value;
    const sponsor = document.getElementById('new-study-sponsor')?.value;
    const phase = document.getElementById('new-study-phase')?.value;

    if (!protocol || !title) {
      showToast('필수 항목을 입력해주세요.', 'error');
      return;
    }

    try {
      await api.post('/studies', { protocol_number: protocol, title, sponsor, phase: phase || null });
      closeModal();
      showToast('Study가 등록되었습니다.', 'success');
      loadDashboard();
    } catch (error) {
      showToast('등록에 실패했습니다.', 'error');
    }
  }
  window.createStudy = createStudy;

  function loadVisitDetail(visitId) {
    showToast('Visit 상세 보기 기능 준비 중...', 'info');
  }

  function showQueryDetail(queryId) {
    showToast('Query 상세 보기 기능 준비 중...', 'info');
  }
  window.showQueryDetail = showQueryDetail;

  function generateReport(type) {
    showToast(`${type} 리포트 생성 중...`, 'info');
  }
  window.generateReport = generateReport;

  // =====================================================
  // INITIALIZATION
  // =====================================================
  function init() {
    // Setup login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email')?.value;
        const password = document.getElementById('login-password')?.value;
        const twoFaCode = document.getElementById('login-2fa-code')?.value;
        
        const errorEl = document.getElementById('login-error');
        if (errorEl) errorEl.classList.add('hidden');

        try {
          await login(email, password, twoFaCode || null);
        } catch (error) {
          if (error.error === '2FA_REQUIRED') {
            ui.show('#login-2fa-section');
            document.getElementById('login-2fa-code')?.focus();
            showToast('2FA 코드를 입력해주세요.', 'info');
          } else {
            if (errorEl) {
              errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.error || '로그인에 실패했습니다.'}`;
              errorEl.classList.remove('hidden');
            }
          }
        }
      });
    }

    // Initialize UI
    updateAuthUI();
    
    // Load dashboard if logged in
    if (state.token && state.user) {
      loadDashboard();
    }

    // Session timeout check
    setInterval(() => {
      if (state.token && Date.now() - state.lastActivity > CONFIG.sessionTimeout) {
        logout(false);
        showToast('세션이 만료되었습니다.', 'warning');
      }
    }, 60000);

    // Online/offline handler
    window.addEventListener('online', () => showToast('온라인 상태로 전환되었습니다.', 'success'));
    window.addEventListener('offline', () => showToast('오프라인 상태입니다.', 'warning'));
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for global access
  window.offline = {
    showSyncDashboard: () => showToast('동기화 대시보드 준비 중...', 'info')
  };

})();
