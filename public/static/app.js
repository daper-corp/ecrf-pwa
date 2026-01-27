// eCRF PWA - Frontend Application
// Professional Clinical Data Management System
// Version 3.1 - Full Functionality

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
      const roles = { ADMIN: 'Admin', PI: 'PI', SUB_INV: 'Sub-Inv', CRC: 'CRC', CRA: 'CRA', DM: 'DM' };
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
      SUSPENDED: { class: 'badge-pending', label: '중단' },
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
                <button class="btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-secondary'}" onclick="${a.onclick}">
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
    
    if (state.token && state.user) {
      ui.hide('#login-section');
      ui.show('#dashboard-section');
      if (subHeader) subHeader.style.display = 'flex';
      
      if (headerNav) {
        headerNav.innerHTML = `
          <a class="header-nav-item active" onclick="navigateTo('dashboard')" data-view="dashboard">Dashboard</a>
          <a class="header-nav-item" onclick="navigateTo('studies')" data-view="studies">Studies</a>
          <a class="header-nav-item" onclick="navigateTo('queries')" data-view="queries">Queries</a>
          <a class="header-nav-item" onclick="navigateTo('reports')" data-view="reports">Reports</a>
        `;
      }
      
      if (authSection) {
        authSection.innerHTML = `
          <button class="btn-icon" title="알림">
            <i class="fas fa-bell"></i>
          </button>
          <div class="dropdown">
            <div class="header-user" onclick="toggleUserMenu()">
              <div class="user-avatar">${ui.getInitials(state.user.name)}</div>
              <i class="fas fa-chevron-down" style="font-size: 10px; margin-left: 4px; opacity: 0.7;"></i>
            </div>
            <div class="dropdown-menu" id="user-dropdown">
              <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-light);">
                <div style="font-weight: 500; margin-bottom: 2px;">${state.user.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${state.user.email}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${ui.getRoleName(state.user.role)}</div>
              </div>
              <div class="dropdown-item" onclick="showSettings(); closeUserMenu();">
                <i class="fas fa-cog"></i><span>설정</span>
              </div>
              <div class="dropdown-item" onclick="show2FASettings(); closeUserMenu();">
                <i class="fas fa-shield-alt"></i><span>2단계 인증</span>
              </div>
              ${state.user.role === 'ADMIN' ? `
              <div class="dropdown-item" onclick="showUserManagement(); closeUserMenu();">
                <i class="fas fa-users-cog"></i><span>사용자 관리</span>
              </div>
              ` : ''}
              <div class="dropdown-divider"></div>
              <div class="dropdown-item" onclick="logout(); closeUserMenu();" style="color: var(--danger);">
                <i class="fas fa-sign-out-alt"></i><span>로그아웃</span>
              </div>
            </div>
          </div>
        `;
      }
    } else {
      ui.show('#login-section');
      ui.hide('#dashboard-section');
      if (subHeader) subHeader.style.display = 'none';
      if (headerNav) headerNav.innerHTML = '';
      if (authSection) authSection.innerHTML = '';
    }
  }

  function toggleUserMenu() {
    document.getElementById('user-dropdown')?.classList.toggle('show');
  }
  window.toggleUserMenu = toggleUserMenu;

  function closeUserMenu() {
    document.getElementById('user-dropdown')?.classList.remove('show');
  }
  window.closeUserMenu = closeUserMenu;

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) closeUserMenu();
  });

  // =====================================================
  // NAVIGATION
  // =====================================================
  function navigateTo(view, params = {}) {
    state.currentView = view;
    
    document.querySelectorAll('.header-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    
    updateBreadcrumb(view, params);
    
    switch (view) {
      case 'dashboard':
      case 'studies':
        loadDashboard();
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
    
    if (view === 'queries') html += ' <span>/</span> <span style="color: var(--text-primary);">Queries</span>';
    if (view === 'reports') html += ' <span>/</span> <span style="color: var(--text-primary);">Reports</span>';

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

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">임상시험</div><div class="stat-value" id="stat-studies">-</div></div>
        <div class="stat-card"><div class="stat-label">피험자</div><div class="stat-value" id="stat-subjects">-</div></div>
        <div class="stat-card" style="cursor:pointer;" onclick="navigateTo('queries')"><div class="stat-label">미해결 Query</div><div class="stat-value" id="stat-queries">-</div></div>
        <div class="stat-card"><div class="stat-label">서명 대기</div><div class="stat-value" id="stat-signatures">-</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">빠른 작업</span>
        </div>
        <div class="card-body">
          <div class="quick-actions">
            <div class="quick-action" onclick="showSubjectSearch()"><i class="fas fa-search"></i><span>피험자 검색</span></div>
            <div class="quick-action" onclick="navigateTo('queries')"><i class="fas fa-comment-medical"></i><span>Query 관리</span></div>
            <div class="quick-action" onclick="navigateTo('reports')"><i class="fas fa-chart-bar"></i><span>리포트</span></div>
            <div class="quick-action" onclick="showExportOptions()"><i class="fas fa-file-export"></i><span>데이터 Export</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">임상시험 목록</span>
          ${ui.canManage() ? `<button class="btn btn-primary btn-sm" onclick="showNewStudyModal()"><i class="fas fa-plus"></i> 새 Study</button>` : ''}
        </div>
        <div class="card-body compact" id="studies-list">
          <div class="loading"><div class="spinner"></div><span>데이터를 불러오는 중...</span></div>
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
      ui.setHtml('#studies-list', `<div class="empty-state"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>데이터 로드 실패</h3></div>`);
    }
  }

  function renderStudiesList() {
    const container = document.getElementById('studies-list');
    if (!container) return;
    
    if (state.studies.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-flask"></i><h3>등록된 임상시험이 없습니다</h3><p>새로운 임상시험을 등록해 주세요.</p></div>`;
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
          <span class="study-meta-item"><i class="fas fa-building"></i> ${study.sponsor || '-'}</span>
          <span class="study-meta-item"><i class="fas fa-calendar"></i> ${ui.formatDate(study.study_start_date)}</span>
          ${study.therapeutic_area ? `<span class="study-meta-item"><i class="fas fa-heartbeat"></i> ${study.therapeutic_area}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  async function loadDashboardStats() {
    document.getElementById('stat-studies').textContent = state.studies.length.toString();
    
    let totalSubjects = 0, totalQueries = 0, totalSignatures = 0;

    for (const study of state.studies.slice(0, 5)) {
      try {
        const stats = await api.get(`/studies/${study.id}/stats`);
        if (stats.success && stats.data) {
          totalSubjects += (stats.data.subjects || []).reduce((sum, s) => sum + s.count, 0);
          const openQueries = (stats.data.queries || []).find(q => q.status === 'OPEN');
          totalQueries += openQueries?.count || 0;
        }
      } catch (e) {}
    }

    document.getElementById('stat-subjects').textContent = totalSubjects.toString();
    document.getElementById('stat-queries').textContent = totalQueries.toString();
    document.getElementById('stat-signatures').textContent = totalSignatures.toString();
  }

  // =====================================================
  // STUDY CRUD
  // =====================================================
  function showNewStudyModal() {
    showModal('새 Study 등록', `
      <div class="form-group">
        <label class="form-label">Protocol Number <span class="required">*</span></label>
        <input type="text" class="form-input" id="study-protocol" placeholder="예: ABC-001">
      </div>
      <div class="form-group">
        <label class="form-label">Study Title <span class="required">*</span></label>
        <input type="text" class="form-input" id="study-title" placeholder="임상시험 제목">
      </div>
      <div class="form-group">
        <label class="form-label">Sponsor</label>
        <input type="text" class="form-input" id="study-sponsor" placeholder="스폰서 기관명">
      </div>
      <div class="form-group">
        <label class="form-label">Phase</label>
        <select class="form-input" id="study-phase">
          <option value="">선택</option>
          <option value="1">Phase 1</option>
          <option value="2">Phase 2</option>
          <option value="3">Phase 3</option>
          <option value="4">Phase 4</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Therapeutic Area</label>
        <input type="text" class="form-input" id="study-therapeutic" placeholder="치료 영역">
      </div>
      <div class="form-group">
        <label class="form-label">시작일</label>
        <input type="date" class="form-input" id="study-start-date">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', primary: true, onclick: 'createStudy()' }
    ]);
  }
  window.showNewStudyModal = showNewStudyModal;

  async function createStudy() {
    const protocol = document.getElementById('study-protocol')?.value?.trim();
    const title = document.getElementById('study-title')?.value?.trim();
    const sponsor = document.getElementById('study-sponsor')?.value?.trim();
    const phase = document.getElementById('study-phase')?.value;
    const therapeutic = document.getElementById('study-therapeutic')?.value?.trim();
    const startDate = document.getElementById('study-start-date')?.value;

    if (!protocol || !title) {
      showToast('Protocol Number와 Title은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.post('/studies', {
        protocol_number: protocol,
        title,
        sponsor: sponsor || null,
        phase: phase ? parseInt(phase) : null,
        therapeutic_area: therapeutic || null,
        study_start_date: startDate || null,
        status: 'DRAFT'
      });
      
      if (result.success) {
        closeModal();
        showToast('Study가 등록되었습니다.', 'success');
        loadDashboard();
      }
    } catch (error) {
      showToast(error.error || '등록에 실패했습니다.', 'error');
    }
  }
  window.createStudy = createStudy;

  function showEditStudyModal(studyId) {
    const study = state.studies.find(s => s.id === studyId) || state.currentStudy;
    if (!study) return;

    showModal('Study 수정', `
      <div class="form-group">
        <label class="form-label">Protocol Number</label>
        <input type="text" class="form-input" id="edit-study-protocol" value="${study.protocol_number || ''}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">Study Title <span class="required">*</span></label>
        <input type="text" class="form-input" id="edit-study-title" value="${study.title || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Sponsor</label>
        <input type="text" class="form-input" id="edit-study-sponsor" value="${study.sponsor || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">상태</label>
        <select class="form-input" id="edit-study-status">
          <option value="DRAFT" ${study.status === 'DRAFT' ? 'selected' : ''}>초안</option>
          <option value="ACTIVE" ${study.status === 'ACTIVE' ? 'selected' : ''}>진행중</option>
          <option value="SUSPENDED" ${study.status === 'SUSPENDED' ? 'selected' : ''}>중단</option>
          <option value="COMPLETED" ${study.status === 'COMPLETED' ? 'selected' : ''}>완료</option>
          <option value="CLOSED" ${study.status === 'CLOSED' ? 'selected' : ''}>종료</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Phase</label>
        <select class="form-input" id="edit-study-phase">
          <option value="">선택</option>
          <option value="1" ${study.phase == 1 ? 'selected' : ''}>Phase 1</option>
          <option value="2" ${study.phase == 2 ? 'selected' : ''}>Phase 2</option>
          <option value="3" ${study.phase == 3 ? 'selected' : ''}>Phase 3</option>
          <option value="4" ${study.phase == 4 ? 'selected' : ''}>Phase 4</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Therapeutic Area</label>
        <input type="text" class="form-input" id="edit-study-therapeutic" value="${study.therapeutic_area || ''}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateStudy('${studyId}')` }
    ]);
  }
  window.showEditStudyModal = showEditStudyModal;

  async function updateStudy(studyId) {
    const title = document.getElementById('edit-study-title')?.value?.trim();
    const sponsor = document.getElementById('edit-study-sponsor')?.value?.trim();
    const status = document.getElementById('edit-study-status')?.value;
    const phase = document.getElementById('edit-study-phase')?.value;
    const therapeutic = document.getElementById('edit-study-therapeutic')?.value?.trim();

    if (!title) {
      showToast('Title은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.put(`/studies/${studyId}`, {
        title,
        sponsor: sponsor || null,
        status,
        phase: phase ? parseInt(phase) : null,
        therapeutic_area: therapeutic || null
      });
      
      if (result.success) {
        closeModal();
        showToast('Study가 수정되었습니다.', 'success');
        loadStudyDetail(studyId);
      }
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateStudy = updateStudy;

  // =====================================================
  // STUDY DETAIL
  // =====================================================
  async function loadStudyDetail(studyId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>Study 정보를 불러오는 중...</span></div>`;

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
                  <button class="btn btn-secondary btn-sm" onclick="showEditStudyModal('${study.id}')"><i class="fas fa-edit"></i> 수정</button>
                  ${study.status !== 'LOCKED' ? `<button class="btn btn-secondary btn-sm" onclick="lockStudy('${study.id}')"><i class="fas fa-lock"></i> 잠금</button>` : ''}
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">스폰서</div><div style="font-weight: 500;">${study.sponsor || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">IRB 승인번호</div><div style="font-weight: 500;">${study.irb_approval_number || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">시작일</div><div style="font-weight: 500;">${ui.formatDate(study.study_start_date)}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">치료 영역</div><div style="font-weight: 500;">${study.therapeutic_area || '-'}</div></div>
            </div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">연구기관</div><div class="stat-value">${sites.length}</div></div>
          <div class="stat-card"><div class="stat-label">피험자</div><div class="stat-value">${study.subjectsCount || 0}</div></div>
          <div class="stat-card"><div class="stat-label">CRF</div><div class="stat-value">${(stats.crfs || []).reduce((sum, c) => sum + c.count, 0)}</div></div>
          <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('queries', {studyId: '${study.id}'})"><div class="stat-label">미결 Query</div><div class="stat-value">${(stats.queries || []).find(q => q.status === 'OPEN')?.count || 0}</div></div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">연구기관 목록 (${sites.length})</span>
            ${ui.canManage() ? `<button class="btn btn-primary btn-sm" onclick="showNewSiteModal('${study.id}')"><i class="fas fa-plus"></i> 기관 추가</button>` : ''}
          </div>
          <div class="card-body compact">
            ${sites.length === 0 ? `<div class="empty-state"><i class="fas fa-hospital"></i><h3>등록된 연구기관이 없습니다</h3></div>` : `
              <table class="data-table">
                <thead><tr><th>기관번호</th><th>기관명</th><th>PI</th><th>상태</th><th>피험자</th><th></th></tr></thead>
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
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>Study 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  async function lockStudy(studyId) {
    if (!confirm('이 Study를 잠그시겠습니까? 잠금 후에는 데이터 수정이 제한됩니다.')) return;
    
    try {
      await api.put(`/studies/${studyId}`, { status: 'LOCKED' });
      showToast('Study가 잠금되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast('잠금에 실패했습니다.', 'error');
    }
  }
  window.lockStudy = lockStudy;

  // =====================================================
  // SITE CRUD
  // =====================================================
  function showNewSiteModal(studyId) {
    showModal('새 연구기관 등록', `
      <div class="form-group">
        <label class="form-label">기관번호 <span class="required">*</span></label>
        <input type="text" class="form-input" id="site-number" placeholder="예: 001">
      </div>
      <div class="form-group">
        <label class="form-label">기관명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="site-name" placeholder="병원/기관 이름">
      </div>
      <div class="form-group">
        <label class="form-label">PI 이름</label>
        <input type="text" class="form-input" id="site-pi-name" placeholder="책임연구자 이름">
      </div>
      <div class="form-group">
        <label class="form-label">PI 이메일</label>
        <input type="email" class="form-input" id="site-pi-email" placeholder="pi@hospital.com">
      </div>
      <div class="form-group">
        <label class="form-label">주소</label>
        <input type="text" class="form-input" id="site-address" placeholder="기관 주소">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', primary: true, onclick: `createSite('${studyId}')` }
    ]);
  }
  window.showNewSiteModal = showNewSiteModal;

  async function createSite(studyId) {
    const siteNumber = document.getElementById('site-number')?.value?.trim();
    const name = document.getElementById('site-name')?.value?.trim();
    const piName = document.getElementById('site-pi-name')?.value?.trim();
    const piEmail = document.getElementById('site-pi-email')?.value?.trim();
    const address = document.getElementById('site-address')?.value?.trim();

    if (!siteNumber || !name) {
      showToast('기관번호와 기관명은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.post(`/studies/${studyId}/sites`, {
        site_number: siteNumber,
        name,
        pi_name: piName || null,
        pi_email: piEmail || null,
        address: address || null,
        status: 'ACTIVE'
      });
      
      if (result.success) {
        closeModal();
        showToast('연구기관이 등록되었습니다.', 'success');
        loadStudyDetail(studyId);
      }
    } catch (error) {
      showToast(error.error || '등록에 실패했습니다.', 'error');
    }
  }
  window.createSite = createSite;

  // =====================================================
  // SITE DETAIL
  // =====================================================
  async function loadSiteDetail(siteId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>Site 정보를 불러오는 중...</span></div>`;

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
                ${ui.canManage() ? `<button class="btn btn-secondary btn-sm" onclick="showEditSiteModal('${site.id}')"><i class="fas fa-edit"></i> 수정</button>` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">PI</div><div style="font-weight: 500;">${site.pi_name || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">이메일</div><div style="font-weight: 500;">${site.pi_email || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">주소</div><div style="font-weight: 500;">${site.address || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">등록 피험자</div><div style="font-weight: 500;">${subjects.length}명</div></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">피험자 목록 (${subjects.length})</span>
            ${ui.canWrite() && site.status === 'ACTIVE' ? `<button class="btn btn-primary btn-sm" onclick="showNewSubjectModal('${site.id}')"><i class="fas fa-user-plus"></i> 피험자 등록</button>` : ''}
          </div>
          <div class="card-body compact">
            ${subjects.length === 0 ? `<div class="empty-state"><i class="fas fa-users"></i><h3>등록된 피험자가 없습니다</h3></div>` : `
              <table class="data-table">
                <thead><tr><th>Subject ID</th><th>Screening #</th><th>이니셜</th><th>상태</th><th>등록일</th><th></th></tr></thead>
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
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>Site 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  function showEditSiteModal(siteId) {
    const site = state.currentSite;
    if (!site) return;

    showModal('연구기관 수정', `
      <div class="form-group">
        <label class="form-label">기관번호</label>
        <input type="text" class="form-input" value="${site.site_number}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">기관명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="edit-site-name" value="${site.name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">상태</label>
        <select class="form-input" id="edit-site-status">
          <option value="ACTIVE" ${site.status === 'ACTIVE' ? 'selected' : ''}>활성</option>
          <option value="INACTIVE" ${site.status === 'INACTIVE' ? 'selected' : ''}>비활성</option>
          <option value="CLOSED" ${site.status === 'CLOSED' ? 'selected' : ''}>종료</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">PI 이름</label>
        <input type="text" class="form-input" id="edit-site-pi-name" value="${site.pi_name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">PI 이메일</label>
        <input type="email" class="form-input" id="edit-site-pi-email" value="${site.pi_email || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">주소</label>
        <input type="text" class="form-input" id="edit-site-address" value="${site.address || ''}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateSite('${siteId}')` }
    ]);
  }
  window.showEditSiteModal = showEditSiteModal;

  async function updateSite(siteId) {
    const name = document.getElementById('edit-site-name')?.value?.trim();
    const status = document.getElementById('edit-site-status')?.value;
    const piName = document.getElementById('edit-site-pi-name')?.value?.trim();
    const piEmail = document.getElementById('edit-site-pi-email')?.value?.trim();
    const address = document.getElementById('edit-site-address')?.value?.trim();

    if (!name) {
      showToast('기관명은 필수입니다.', 'error');
      return;
    }

    try {
      await api.put(`/sites/${siteId}`, { name, status, pi_name: piName, pi_email: piEmail, address });
      closeModal();
      showToast('연구기관이 수정되었습니다.', 'success');
      loadSiteDetail(siteId);
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateSite = updateSite;

  // =====================================================
  // SUBJECT CRUD
  // =====================================================
  function showNewSubjectModal(siteId) {
    showModal('피험자 등록', `
      <div class="form-group">
        <label class="form-label">Screening Number <span class="required">*</span></label>
        <input type="text" class="form-input" id="subj-screening" placeholder="예: SCR-001">
      </div>
      <div class="form-group">
        <label class="form-label">이니셜</label>
        <input type="text" class="form-input" id="subj-initials" placeholder="예: KHJ" maxlength="5">
      </div>
      <div class="form-group">
        <label class="form-label">스크리닝일 <span class="required">*</span></label>
        <input type="date" class="form-input" id="subj-screening-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', primary: true, onclick: `createSubject('${siteId}')` }
    ]);
  }
  window.showNewSubjectModal = showNewSubjectModal;

  async function createSubject(siteId) {
    const screening = document.getElementById('subj-screening')?.value?.trim();
    const initials = document.getElementById('subj-initials')?.value?.trim().toUpperCase();
    const screeningDate = document.getElementById('subj-screening-date')?.value;

    if (!screening || !screeningDate) {
      showToast('Screening Number와 스크리닝일은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.post(`/sites/${siteId}/subjects`, {
        screening_number: screening,
        initials: initials || null,
        screening_date: screeningDate,
        status: 'SCREENING'
      });
      
      if (result.success) {
        closeModal();
        showToast('피험자가 등록되었습니다.', 'success');
        loadSiteDetail(siteId);
      }
    } catch (error) {
      showToast(error.error || '등록에 실패했습니다.', 'error');
    }
  }
  window.createSubject = createSubject;

  // =====================================================
  // SUBJECT DETAIL
  // =====================================================
  async function loadSubjectDetail(subjectId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>피험자 정보를 불러오는 중...</span></div>`;

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
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">${subject.subject_number}</h1>
                  ${getStatusBadge(subject.status)}
                </div>
                <p style="color: var(--text-secondary);">
                  ${state.currentSite?.name || ''} · Screening #: ${subject.screening_number || '-'}
                  ${subject.randomization_number ? ` · Rand #: ${subject.randomization_number}` : ''}
                </p>
              </div>
              <div style="display: flex; gap: 8px;">
                ${ui.canWrite() && !['COMPLETED', 'WITHDRAWN'].includes(subject.status) ? `
                  <button class="btn btn-danger btn-sm" onclick="showWithdrawModal('${subject.id}')"><i class="fas fa-user-slash"></i> 중도탈락</button>
                ` : ''}
                ${ui.canWrite() && subject.status === 'SCREENING' ? `
                  <button class="btn btn-primary btn-sm" onclick="enrollSubject('${subject.id}')"><i class="fas fa-user-check"></i> 등록</button>
                ` : ''}
                ${ui.canWrite() && subject.status === 'ENROLLED' ? `
                  <button class="btn btn-primary btn-sm" onclick="randomizeSubject('${subject.id}')"><i class="fas fa-random"></i> 무작위배정</button>
                ` : ''}
                ${ui.canWrite() ? `
                  <button class="btn btn-secondary btn-sm" onclick="showEditSubjectModal('${subject.id}')"><i class="fas fa-edit"></i> 수정</button>
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">이니셜</div><div style="font-weight: 500;">${subject.initials || '-'}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">스크리닝일</div><div style="font-weight: 500;">${ui.formatDate(subject.screening_date)}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">등록일</div><div style="font-weight: 500;">${ui.formatDate(subject.enrolled_date)}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">무작위배정일</div><div style="font-weight: 500;">${ui.formatDate(subject.randomized_date)}</div></div>
            </div>
            
            ${subject.status === 'WITHDRAWN' ? `
              <div style="margin-top: 16px; padding: 12px; background: #ffebee; border-radius: 4px; color: #c62828; font-size: 13px;">
                <i class="fas fa-exclamation-triangle"></i> 중도탈락: ${subject.withdrawal_reason || '사유 미기재'} (${ui.formatDate(subject.withdrawn_date)})
              </div>
            ` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">방문 일정</span>
            ${ui.canWrite() && ['ENROLLED', 'RANDOMIZED'].includes(subject.status) ? `
              <button class="btn btn-primary btn-sm" onclick="showNewVisitModal('${subject.id}')"><i class="fas fa-plus"></i> 방문 추가</button>
            ` : ''}
          </div>
          <div class="card-body compact">
            ${visits.length === 0 ? `<div class="empty-state"><i class="fas fa-calendar-alt"></i><h3>방문 일정이 없습니다</h3></div>` : `
              <table class="data-table">
                <thead><tr><th>방문</th><th>방문명</th><th>상태</th><th>예정일</th><th>실제일</th><th>CRF</th><th></th></tr></thead>
                <tbody>
                  ${visits.map(visit => {
                    const crfStats = visit.crfStats || [];
                    const totalCRF = crfStats.reduce((sum, s) => sum + s.count, 0);
                    const completedCRF = crfStats.filter(s => ['COMPLETE', 'SIGNED', 'LOCKED'].includes(s.status)).reduce((sum, s) => sum + s.count, 0);
                    return `
                      <tr class="clickable" onclick="loadVisitDetail('${visit.id}')">
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
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>피험자 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  function showEditSubjectModal(subjectId) {
    const subj = state.currentSubject;
    if (!subj) return;

    showModal('피험자 수정', `
      <div class="form-group">
        <label class="form-label">Subject Number</label>
        <input type="text" class="form-input" value="${subj.subject_number}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">이니셜</label>
        <input type="text" class="form-input" id="edit-subj-initials" value="${subj.initials || ''}" maxlength="5">
      </div>
      <div class="form-group">
        <label class="form-label">스크리닝일</label>
        <input type="date" class="form-input" id="edit-subj-screening-date" value="${subj.screening_date?.split('T')[0] || ''}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateSubject('${subjectId}')` }
    ]);
  }
  window.showEditSubjectModal = showEditSubjectModal;

  async function updateSubject(subjectId) {
    const initials = document.getElementById('edit-subj-initials')?.value?.trim().toUpperCase();
    const screeningDate = document.getElementById('edit-subj-screening-date')?.value;

    try {
      await api.put(`/subjects/${subjectId}`, { initials, screening_date: screeningDate });
      closeModal();
      showToast('피험자 정보가 수정되었습니다.', 'success');
      loadSubjectDetail(subjectId);
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateSubject = updateSubject;

  async function enrollSubject(subjectId) {
    if (!confirm('이 피험자를 등록하시겠습니까?')) return;
    
    try {
      await api.put(`/subjects/${subjectId}`, { status: 'ENROLLED', enrolled_date: new Date().toISOString().split('T')[0] });
      showToast('피험자가 등록되었습니다.', 'success');
      loadSubjectDetail(subjectId);
    } catch (error) {
      showToast('등록에 실패했습니다.', 'error');
    }
  }
  window.enrollSubject = enrollSubject;

  async function randomizeSubject(subjectId) {
    const randNum = prompt('무작위 배정 번호를 입력하세요:');
    if (!randNum) return;
    
    try {
      await api.put(`/subjects/${subjectId}`, { 
        status: 'RANDOMIZED', 
        randomization_number: randNum,
        randomized_date: new Date().toISOString().split('T')[0] 
      });
      showToast('무작위 배정이 완료되었습니다.', 'success');
      loadSubjectDetail(subjectId);
    } catch (error) {
      showToast('무작위 배정에 실패했습니다.', 'error');
    }
  }
  window.randomizeSubject = randomizeSubject;

  function showWithdrawModal(subjectId) {
    showModal('중도탈락 처리', `
      <p style="margin-bottom: 16px; color: var(--text-secondary);">피험자를 중도탈락 처리합니다. 이 작업은 되돌릴 수 없습니다.</p>
      <div class="form-group">
        <label class="form-label">탈락 사유 <span class="required">*</span></label>
        <textarea class="form-input" id="withdraw-reason" rows="3" placeholder="중도탈락 사유를 입력하세요"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">탈락일</label>
        <input type="date" class="form-input" id="withdraw-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '중도탈락 처리', danger: true, onclick: `withdrawSubject('${subjectId}')` }
    ]);
  }
  window.showWithdrawModal = showWithdrawModal;

  async function withdrawSubject(subjectId) {
    const reason = document.getElementById('withdraw-reason')?.value?.trim();
    const withdrawDate = document.getElementById('withdraw-date')?.value;

    if (!reason) {
      showToast('탈락 사유를 입력해주세요.', 'error');
      return;
    }

    try {
      await api.put(`/subjects/${subjectId}`, {
        status: 'WITHDRAWN',
        withdrawal_reason: reason,
        withdrawn_date: withdrawDate
      });
      closeModal();
      showToast('중도탈락 처리되었습니다.', 'success');
      loadSubjectDetail(subjectId);
    } catch (error) {
      showToast('처리에 실패했습니다.', 'error');
    }
  }
  window.withdrawSubject = withdrawSubject;

  // =====================================================
  // VISIT
  // =====================================================
  function showNewVisitModal(subjectId) {
    showModal('방문 추가', `
      <div class="form-group">
        <label class="form-label">방문 번호 <span class="required">*</span></label>
        <input type="number" class="form-input" id="visit-number" placeholder="예: 1" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">방문명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="visit-name" placeholder="예: Screening Visit">
      </div>
      <div class="form-group">
        <label class="form-label">예정일</label>
        <input type="date" class="form-input" id="visit-scheduled-date">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', primary: true, onclick: `createVisit('${subjectId}')` }
    ]);
  }
  window.showNewVisitModal = showNewVisitModal;

  async function createVisit(subjectId) {
    const visitNumber = document.getElementById('visit-number')?.value;
    const visitName = document.getElementById('visit-name')?.value?.trim();
    const scheduledDate = document.getElementById('visit-scheduled-date')?.value;

    if (!visitNumber || !visitName) {
      showToast('방문 번호와 방문명은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.post(`/subjects/${subjectId}/visits`, {
        visit_number: parseInt(visitNumber),
        visit_name: visitName,
        scheduled_date: scheduledDate || null,
        status: 'SCHEDULED'
      });
      
      if (result.success) {
        closeModal();
        showToast('방문이 추가되었습니다.', 'success');
        loadSubjectDetail(subjectId);
      }
    } catch (error) {
      showToast(error.error || '추가에 실패했습니다.', 'error');
    }
  }
  window.createVisit = createVisit;

  async function loadVisitDetail(visitId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>방문 정보를 불러오는 중...</span></div>`;

    try {
      const result = await api.get(`/visits/${visitId}`);
      if (!result.success) throw new Error(result.error);

      state.currentVisit = result.data;
      const visit = result.data;
      const crfData = visit.crfData || [];

      mainContent.innerHTML = `
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">V${visit.visit_number} - ${visit.visit_name}</h1>
                  ${getStatusBadge(visit.status)}
                </div>
                <p style="color: var(--text-secondary);">Subject: ${state.currentSubject?.subject_number || '-'}</p>
              </div>
              <div style="display: flex; gap: 8px;">
                ${ui.canWrite() && visit.status === 'SCHEDULED' ? `
                  <button class="btn btn-primary btn-sm" onclick="startVisit('${visitId}')"><i class="fas fa-play"></i> 방문 시작</button>
                ` : ''}
                ${ui.canWrite() && visit.status === 'IN_PROGRESS' ? `
                  <button class="btn btn-primary btn-sm" onclick="completeVisit('${visitId}')"><i class="fas fa-check"></i> 방문 완료</button>
                ` : ''}
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light);">
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">예정일</div><div style="font-weight: 500;">${ui.formatDate(visit.scheduled_date)}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">실제 방문일</div><div style="font-weight: 500;">${ui.formatDate(visit.actual_date)}</div></div>
              <div><div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">상태</div><div style="font-weight: 500;">${visit.status}</div></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">CRF 데이터</span>
          </div>
          <div class="card-body">
            ${crfData.length === 0 ? `
              <div class="empty-state"><i class="fas fa-file-alt"></i><h3>CRF 데이터가 없습니다</h3></div>
            ` : `
              <div style="display: grid; gap: 16px;">
                ${crfData.map(crf => `
                  <div style="border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                      <div>
                        <strong>${crf.form_code}</strong> - ${crf.form_name || 'CRF Form'}
                        ${getStatusBadge(crf.status)}
                      </div>
                      ${ui.canWrite() ? `<button class="btn btn-secondary btn-sm" onclick="editCRF('${crf.id}')"><i class="fas fa-edit"></i> 편집</button>` : ''}
                    </div>
                    <div style="font-size: 13px; color: var(--text-muted);">
                      마지막 수정: ${ui.formatDateTime(crf.updated_at)}
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>방문 정보 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  async function startVisit(visitId) {
    try {
      await api.put(`/visits/${visitId}`, { status: 'IN_PROGRESS', actual_date: new Date().toISOString().split('T')[0] });
      showToast('방문이 시작되었습니다.', 'success');
      loadVisitDetail(visitId);
    } catch (error) {
      showToast('시작에 실패했습니다.', 'error');
    }
  }
  window.startVisit = startVisit;

  async function completeVisit(visitId) {
    try {
      await api.put(`/visits/${visitId}`, { status: 'COMPLETE' });
      showToast('방문이 완료되었습니다.', 'success');
      loadVisitDetail(visitId);
    } catch (error) {
      showToast('완료 처리에 실패했습니다.', 'error');
    }
  }
  window.completeVisit = completeVisit;

  function editCRF(crfId) {
    showToast('CRF 편집 기능 준비 중...', 'info');
  }
  window.editCRF = editCRF;

  // =====================================================
  // QUERIES
  // =====================================================
  async function loadQueriesList(params = {}) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>Query 목록을 불러오는 중...</span></div>`;

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
                <option value="OPEN" ${params.status === 'OPEN' ? 'selected' : ''}>미결</option>
                <option value="ANSWERED" ${params.status === 'ANSWERED' ? 'selected' : ''}>답변됨</option>
                <option value="CLOSED" ${params.status === 'CLOSED' ? 'selected' : ''}>종료</option>
              </select>
              ${ui.canManage() ? `<button class="btn btn-primary btn-sm" onclick="showNewQueryModal()"><i class="fas fa-plus"></i> Query 생성</button>` : ''}
            </div>
          </div>
          <div class="card-body compact">
            ${queries.length === 0 ? `<div class="empty-state"><i class="fas fa-comment-medical"></i><h3>Query가 없습니다</h3></div>` : `
              <table class="data-table">
                <thead><tr><th>Query ID</th><th>Subject</th><th>필드</th><th>내용</th><th>상태</th><th>우선순위</th><th>생성일</th><th></th></tr></thead>
                <tbody>
                  ${queries.map(q => `
                    <tr class="clickable" onclick="showQueryDetail('${q.id}')">
                      <td><strong>${q.id.substring(0, 8)}</strong></td>
                      <td>${q.subject_number || '-'}</td>
                      <td>${q.field_name || '-'}</td>
                      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${q.query_text || '-'}</td>
                      <td>${getStatusBadge(q.status)}</td>
                      <td><span class="badge ${q.priority === 'CRITICAL' ? 'badge-open' : q.priority === 'MAJOR' ? 'badge-pending' : 'badge-draft'}">${q.priority || 'MINOR'}</span></td>
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
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>Query 로드 실패</h3></div>`;
    }
  }

  window.filterQueries = function(status) {
    loadQueriesList({ status });
  };

  async function showQueryDetail(queryId) {
    try {
      const result = await api.get(`/queries/${queryId}`);
      if (!result.success) throw new Error();
      
      const q = result.data;
      
      showModal(`Query: ${q.id.substring(0, 8)}`, `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Subject</div>
          <div style="font-weight: 500;">${q.subject_number || '-'}</div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">필드</div>
          <div style="font-weight: 500;">${q.field_name || '-'}</div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">상태</div>
          <div>${getStatusBadge(q.status)}</div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Query 내용</div>
          <div style="padding: 12px; background: var(--bg-secondary); border-radius: 4px;">${q.query_text || '-'}</div>
        </div>
        ${q.response_text ? `
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">응답</div>
            <div style="padding: 12px; background: #e8f5e9; border-radius: 4px;">${q.response_text}</div>
          </div>
        ` : ''}
        ${q.status === 'OPEN' ? `
          <div class="form-group">
            <label class="form-label">응답 입력</label>
            <textarea class="form-input" id="query-response" rows="3" placeholder="Query에 대한 응답을 입력하세요"></textarea>
          </div>
        ` : ''}
      `, q.status === 'OPEN' ? [
        { label: '닫기', onclick: 'closeModal()' },
        { label: '응답 제출', primary: true, onclick: `respondToQuery('${q.id}')` }
      ] : [
        { label: '닫기', onclick: 'closeModal()' },
        ...(q.status === 'ANSWERED' && ui.canManage() ? [{ label: 'Query 종료', primary: true, onclick: `closeQuery('${q.id}')` }] : [])
      ]);
    } catch (error) {
      showToast('Query 정보를 불러올 수 없습니다.', 'error');
    }
  }
  window.showQueryDetail = showQueryDetail;

  async function respondToQuery(queryId) {
    const response = document.getElementById('query-response')?.value?.trim();
    if (!response) {
      showToast('응답 내용을 입력해주세요.', 'error');
      return;
    }

    try {
      await api.put(`/queries/${queryId}`, { response_text: response, status: 'ANSWERED' });
      closeModal();
      showToast('응답이 제출되었습니다.', 'success');
      loadQueriesList();
    } catch (error) {
      showToast('응답 제출에 실패했습니다.', 'error');
    }
  }
  window.respondToQuery = respondToQuery;

  async function closeQuery(queryId) {
    try {
      await api.put(`/queries/${queryId}`, { status: 'CLOSED' });
      closeModal();
      showToast('Query가 종료되었습니다.', 'success');
      loadQueriesList();
    } catch (error) {
      showToast('Query 종료에 실패했습니다.', 'error');
    }
  }
  window.closeQuery = closeQuery;

  function showNewQueryModal() {
    showModal('새 Query 생성', `
      <div class="form-group">
        <label class="form-label">Subject Number <span class="required">*</span></label>
        <input type="text" class="form-input" id="new-query-subject" placeholder="예: SUBJ-001">
      </div>
      <div class="form-group">
        <label class="form-label">필드명</label>
        <input type="text" class="form-input" id="new-query-field" placeholder="예: 체중">
      </div>
      <div class="form-group">
        <label class="form-label">우선순위</label>
        <select class="form-input" id="new-query-priority">
          <option value="MINOR">Minor</option>
          <option value="MAJOR">Major</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Query 내용 <span class="required">*</span></label>
        <textarea class="form-input" id="new-query-text" rows="4" placeholder="Query 내용을 입력하세요"></textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '생성', primary: true, onclick: 'createQuery()' }
    ]);
  }
  window.showNewQueryModal = showNewQueryModal;

  async function createQuery() {
    const subjectNumber = document.getElementById('new-query-subject')?.value?.trim();
    const fieldName = document.getElementById('new-query-field')?.value?.trim();
    const priority = document.getElementById('new-query-priority')?.value;
    const queryText = document.getElementById('new-query-text')?.value?.trim();

    if (!subjectNumber || !queryText) {
      showToast('Subject Number와 Query 내용은 필수입니다.', 'error');
      return;
    }

    try {
      await api.post('/queries', {
        subject_number: subjectNumber,
        field_name: fieldName || null,
        priority,
        query_text: queryText,
        status: 'OPEN'
      });
      closeModal();
      showToast('Query가 생성되었습니다.', 'success');
      loadQueriesList();
    } catch (error) {
      showToast(error.error || 'Query 생성에 실패했습니다.', 'error');
    }
  }
  window.createQuery = createQuery;

  // =====================================================
  // REPORTS
  // =====================================================
  async function loadReports() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Reports & Analytics</span></div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
            <div class="quick-action" onclick="generateReport('enrollment')"><i class="fas fa-user-plus"></i><span>Enrollment Report</span></div>
            <div class="quick-action" onclick="generateReport('query')"><i class="fas fa-comment-medical"></i><span>Query Status Report</span></div>
            <div class="quick-action" onclick="generateReport('crf')"><i class="fas fa-file-alt"></i><span>CRF Completion Report</span></div>
            <div class="quick-action" onclick="generateReport('audit')"><i class="fas fa-history"></i><span>Audit Trail Report</span></div>
          </div>
        </div>
      </div>
      
      <div id="report-result"></div>
    `;
  }

  async function generateReport(type) {
    const resultDiv = document.getElementById('report-result');
    if (!resultDiv) return;

    resultDiv.innerHTML = `<div class="card"><div class="card-body"><div class="loading"><div class="spinner"></div><span>리포트 생성 중...</span></div></div></div>`;

    try {
      const result = await api.get(`/reports/${type}`);
      const data = result.data || {};

      let reportHtml = '';
      
      if (type === 'enrollment') {
        reportHtml = `
          <div class="card">
            <div class="card-header"><span class="card-title">Enrollment Report</span></div>
            <div class="card-body">
              <div class="stats-grid">
                <div class="stat-card"><div class="stat-label">총 피험자</div><div class="stat-value">${data.total || 0}</div></div>
                <div class="stat-card"><div class="stat-label">스크리닝</div><div class="stat-value">${data.screening || 0}</div></div>
                <div class="stat-card"><div class="stat-label">등록</div><div class="stat-value">${data.enrolled || 0}</div></div>
                <div class="stat-card"><div class="stat-label">무작위배정</div><div class="stat-value">${data.randomized || 0}</div></div>
              </div>
              ${data.byStudy ? `
                <h4 style="margin-top: 20px; margin-bottom: 12px;">Study별 현황</h4>
                <table class="data-table">
                  <thead><tr><th>Study</th><th>스크리닝</th><th>등록</th><th>무작위배정</th><th>완료</th><th>탈락</th></tr></thead>
                  <tbody>
                    ${(data.byStudy || []).map(s => `
                      <tr>
                        <td><strong>${s.protocol_number}</strong></td>
                        <td>${s.screening || 0}</td>
                        <td>${s.enrolled || 0}</td>
                        <td>${s.randomized || 0}</td>
                        <td>${s.completed || 0}</td>
                        <td>${s.withdrawn || 0}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : ''}
            </div>
          </div>
        `;
      } else if (type === 'query') {
        reportHtml = `
          <div class="card">
            <div class="card-header"><span class="card-title">Query Status Report</span></div>
            <div class="card-body">
              <div class="stats-grid">
                <div class="stat-card"><div class="stat-label">총 Query</div><div class="stat-value">${data.total || 0}</div></div>
                <div class="stat-card"><div class="stat-label">미결</div><div class="stat-value" style="color: var(--danger);">${data.open || 0}</div></div>
                <div class="stat-card"><div class="stat-label">답변됨</div><div class="stat-value" style="color: var(--warning);">${data.answered || 0}</div></div>
                <div class="stat-card"><div class="stat-label">종료</div><div class="stat-value" style="color: var(--success);">${data.closed || 0}</div></div>
              </div>
            </div>
          </div>
        `;
      } else {
        reportHtml = `
          <div class="card">
            <div class="card-header"><span class="card-title">${type.charAt(0).toUpperCase() + type.slice(1)} Report</span></div>
            <div class="card-body">
              <pre style="background: var(--bg-secondary); padding: 16px; border-radius: 4px; overflow: auto;">${JSON.stringify(data, null, 2)}</pre>
            </div>
          </div>
        `;
      }

      resultDiv.innerHTML = reportHtml;
    } catch (error) {
      resultDiv.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>리포트 생성 실패</h3></div></div></div>`;
    }
  }
  window.generateReport = generateReport;

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

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>사용자 목록을 불러오는 중...</span></div>`;

    try {
      const result = await api.get('/auth/users?limit=100');
      const users = result.data || [];

      mainContent.innerHTML = `
        <div class="card">
          <div class="card-header">
            <span class="card-title">사용자 관리 (${users.length})</span>
            <button class="btn btn-primary btn-sm" onclick="showNewUserModal()"><i class="fas fa-user-plus"></i> 사용자 추가</button>
          </div>
          <div class="card-body compact">
            <table class="data-table">
              <thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th>2FA</th><th>마지막 접속</th><th></th></tr></thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td><strong>${u.name}</strong></td>
                    <td>${u.email}</td>
                    <td><span class="badge badge-draft">${ui.getRoleShort(u.role)}</span></td>
                    <td>${getStatusBadge(u.status)}</td>
                    <td>${u.two_factor_enabled ? '<i class="fas fa-shield-alt" style="color: var(--success);"></i>' : '-'}</td>
                    <td>${ui.formatDateTime(u.last_login)}</td>
                    <td><button class="btn-icon" onclick="showEditUserModal('${u.id}')" title="수정"><i class="fas fa-edit"></i></button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>사용자 목록 로드 실패</h3></div>`;
    }
  }
  window.showUserManagement = showUserManagement;

  function showNewUserModal() {
    showModal('사용자 추가', `
      <div class="form-group">
        <label class="form-label">이름 <span class="required">*</span></label>
        <input type="text" class="form-input" id="new-user-name" placeholder="홍길동">
      </div>
      <div class="form-group">
        <label class="form-label">이메일 <span class="required">*</span></label>
        <input type="email" class="form-input" id="new-user-email" placeholder="user@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">비밀번호 <span class="required">*</span></label>
        <input type="password" class="form-input" id="new-user-password" placeholder="비밀번호">
      </div>
      <div class="form-group">
        <label class="form-label">역할 <span class="required">*</span></label>
        <select class="form-input" id="new-user-role">
          <option value="CRC">CRC (연구간호사)</option>
          <option value="CRA">CRA (모니터)</option>
          <option value="PI">PI (책임연구자)</option>
          <option value="SUB_INV">Sub-Inv (공동연구자)</option>
          <option value="DM">DM (데이터 관리자)</option>
          <option value="ADMIN">Admin (시스템 관리자)</option>
        </select>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', primary: true, onclick: 'createUser()' }
    ]);
  }
  window.showNewUserModal = showNewUserModal;

  async function createUser() {
    const name = document.getElementById('new-user-name')?.value?.trim();
    const email = document.getElementById('new-user-email')?.value?.trim();
    const password = document.getElementById('new-user-password')?.value;
    const role = document.getElementById('new-user-role')?.value;

    if (!name || !email || !password) {
      showToast('필수 항목을 모두 입력해주세요.', 'error');
      return;
    }

    try {
      await api.post('/auth/users', { name, email, password, role });
      closeModal();
      showToast('사용자가 추가되었습니다.', 'success');
      showUserManagement();
    } catch (error) {
      showToast(error.error || '사용자 추가에 실패했습니다.', 'error');
    }
  }
  window.createUser = createUser;

  async function showEditUserModal(userId) {
    try {
      const result = await api.get(`/auth/users/${userId}`);
      const user = result.data;

      showModal('사용자 수정', `
        <div class="form-group">
          <label class="form-label">이름 <span class="required">*</span></label>
          <input type="text" class="form-input" id="edit-user-name" value="${user.name || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">이메일</label>
          <input type="email" class="form-input" value="${user.email}" readonly style="background: var(--bg-tertiary);">
        </div>
        <div class="form-group">
          <label class="form-label">역할</label>
          <select class="form-input" id="edit-user-role">
            <option value="CRC" ${user.role === 'CRC' ? 'selected' : ''}>CRC</option>
            <option value="CRA" ${user.role === 'CRA' ? 'selected' : ''}>CRA</option>
            <option value="PI" ${user.role === 'PI' ? 'selected' : ''}>PI</option>
            <option value="SUB_INV" ${user.role === 'SUB_INV' ? 'selected' : ''}>Sub-Inv</option>
            <option value="DM" ${user.role === 'DM' ? 'selected' : ''}>DM</option>
            <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">상태</label>
          <select class="form-input" id="edit-user-status">
            <option value="ACTIVE" ${user.status === 'ACTIVE' ? 'selected' : ''}>활성</option>
            <option value="INACTIVE" ${user.status === 'INACTIVE' ? 'selected' : ''}>비활성</option>
            <option value="LOCKED" ${user.status === 'LOCKED' ? 'selected' : ''}>잠금</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">새 비밀번호 (변경 시에만 입력)</label>
          <input type="password" class="form-input" id="edit-user-password" placeholder="새 비밀번호">
        </div>
      `, [
        { label: '취소', onclick: 'closeModal()' },
        { label: '저장', primary: true, onclick: `updateUser('${userId}')` }
      ]);
    } catch (error) {
      showToast('사용자 정보를 불러올 수 없습니다.', 'error');
    }
  }
  window.showEditUserModal = showEditUserModal;

  async function updateUser(userId) {
    const name = document.getElementById('edit-user-name')?.value?.trim();
    const role = document.getElementById('edit-user-role')?.value;
    const status = document.getElementById('edit-user-status')?.value;
    const password = document.getElementById('edit-user-password')?.value;

    if (!name) {
      showToast('이름은 필수입니다.', 'error');
      return;
    }

    const data = { name, role, status };
    if (password) data.password = password;

    try {
      await api.put(`/auth/users/${userId}`, data);
      closeModal();
      showToast('사용자 정보가 수정되었습니다.', 'success');
      showUserManagement();
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateUser = updateUser;

  // =====================================================
  // SETTINGS & OTHER
  // =====================================================
  function showSettings() {
    showModal('설정', `
      <div class="form-group">
        <label class="form-label">알림 설정</label>
        <select class="form-input" id="setting-notifications">
          <option>모든 알림 받기</option>
          <option>중요 알림만</option>
          <option>알림 끄기</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">언어</label>
        <select class="form-input" id="setting-language">
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
      { label: state.user?.two_factor_enabled ? '비활성화' : '활성화', primary: true, onclick: 'toggle2FA()' }
    ]);
  }
  window.show2FASettings = show2FASettings;

  async function toggle2FA() {
    try {
      if (state.user?.two_factor_enabled) {
        await api.post('/2fa/disable');
        state.user.two_factor_enabled = false;
      } else {
        await api.post('/2fa/setup');
        state.user.two_factor_enabled = true;
      }
      localStorage.setItem('ecrf_user', JSON.stringify(state.user));
      closeModal();
      showToast(`2FA가 ${state.user.two_factor_enabled ? '활성화' : '비활성화'}되었습니다.`, 'success');
    } catch (error) {
      showToast('2FA 설정 변경에 실패했습니다.', 'error');
    }
  }
  window.toggle2FA = toggle2FA;

  function showSubjectSearch() {
    showModal('피험자 검색', `
      <div class="form-group">
        <label class="form-label">Subject ID 또는 Screening #</label>
        <input type="text" class="form-input" id="subject-search-input" placeholder="검색어 입력...">
      </div>
      <div id="search-results" style="margin-top: 16px;"></div>
    `, [
      { label: '닫기', onclick: 'closeModal()' },
      { label: '검색', primary: true, onclick: 'searchSubject()' }
    ]);
  }
  window.showSubjectSearch = showSubjectSearch;

  async function searchSubject() {
    const query = document.getElementById('subject-search-input')?.value?.trim();
    const resultsDiv = document.getElementById('search-results');
    
    if (!query) {
      showToast('검색어를 입력해주세요.', 'error');
      return;
    }

    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const result = await api.get(`/subjects/search?q=${encodeURIComponent(query)}`);
      const subjects = result.data || [];

      if (subjects.length === 0) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted);">검색 결과가 없습니다.</p>';
      } else {
        resultsDiv.innerHTML = subjects.map(s => `
          <div style="padding: 12px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 8px; cursor: pointer;" 
               onclick="closeModal(); navigateTo('subject', {subjectId: '${s.id}'})">
            <strong>${s.subject_number}</strong> - ${s.screening_number || '-'}
            <br><span style="font-size: 12px; color: var(--text-muted);">${s.site_name || '-'} | ${getStatusBadge(s.status)}</span>
          </div>
        `).join('');
      }
    } catch (error) {
      resultsDiv.innerHTML = '<p style="text-align: center; color: var(--danger);">검색에 실패했습니다.</p>';
    }
  }
  window.searchSubject = searchSubject;

  function showExportOptions() {
    showModal('데이터 Export', `
      <p style="margin-bottom: 16px; color: var(--text-secondary);">Export할 Study와 형식을 선택하세요.</p>
      <div class="form-group">
        <label class="form-label">Study</label>
        <select class="form-input" id="export-study">
          <option value="">전체 Study</option>
          ${state.studies.map(s => `<option value="${s.id}">${s.protocol_number}</option>`).join('')}
        </select>
      </div>
      <div style="display: grid; gap: 8px; margin-top: 16px;">
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="exportData('odm')">
          <i class="fas fa-file-code"></i> CDISC ODM 1.3
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="exportData('sdtm')">
          <i class="fas fa-database"></i> CDISC SDTM
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="exportData('excel')">
          <i class="fas fa-file-excel"></i> Excel (.xlsx)
        </button>
        <button class="btn btn-secondary" style="justify-content: flex-start;" onclick="exportData('csv')">
          <i class="fas fa-file-csv"></i> CSV
        </button>
      </div>
    `, [{ label: '닫기', onclick: 'closeModal()' }]);
  }
  window.showExportOptions = showExportOptions;

  async function exportData(format) {
    const studyId = document.getElementById('export-study')?.value;
    
    closeModal();
    showToast(`${format.toUpperCase()} Export를 시작합니다...`, 'info');

    try {
      const result = await api.get(`/exports/${format}${studyId ? `?studyId=${studyId}` : ''}`);
      
      if (result.success && result.data?.downloadUrl) {
        window.open(result.data.downloadUrl, '_blank');
        showToast('Export 파일이 준비되었습니다.', 'success');
      } else if (result.data) {
        // Create downloadable file
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${format}_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Export가 완료되었습니다.', 'success');
      }
    } catch (error) {
      showToast('Export에 실패했습니다.', 'error');
    }
  }
  window.exportData = exportData;

  // =====================================================
  // INITIALIZATION
  // =====================================================
  function init() {
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

    updateAuthUI();
    
    if (state.token && state.user) {
      loadDashboard();
    }

    setInterval(() => {
      if (state.token && Date.now() - state.lastActivity > CONFIG.sessionTimeout) {
        logout(false);
        showToast('세션이 만료되었습니다.', 'warning');
      }
    }, 60000);

    window.addEventListener('online', () => showToast('온라인 상태로 전환되었습니다.', 'success'));
    window.addEventListener('offline', () => showToast('오프라인 상태입니다.', 'warning'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.offline = { showSyncDashboard: () => showToast('동기화 대시보드 준비 중...', 'info') };

})();
