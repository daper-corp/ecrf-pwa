// eCRF PWA - Frontend Application
// Professional Clinical Data Management System
// Version 4.0 - Production Ready

(function() {
  'use strict';

  // =====================================================
  // CONFIGURATION
  // =====================================================
  const CONFIG = {
    sessionTimeout: 30 * 60 * 1000,
    autoSaveInterval: 30 * 1000,
    apiTimeout: 30000,
    maxRetries: 3,
    debounceDelay: 300,
  };

  // Error tracking
  const errorLog = [];
  const MAX_ERROR_LOG = 50;

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
  // UTILITY FUNCTIONS
  // =====================================================
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function logError(context, error) {
    const entry = {
      timestamp: new Date().toISOString(),
      context,
      message: error?.message || error?.error || String(error),
      stack: error?.stack
    };
    errorLog.unshift(entry);
    if (errorLog.length > MAX_ERROR_LOG) errorLog.pop();
    console.error(`[${context}]`, error);
  }

  // =====================================================
  // API CLIENT
  // =====================================================
  const api = {
    baseUrl: '/api',
    pendingRequests: new Map(),
    
    async request(method, path, data = null, options = {}) {
      state.lastActivity = Date.now();
      
      const requestKey = `${method}:${path}`;
      
      // Prevent duplicate requests
      if (options.dedupe && this.pendingRequests.has(requestKey)) {
        return this.pendingRequests.get(requestKey);
      }
      
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: { 'Content-Type': 'application/json' },
        timeout: options.timeout || CONFIG.apiTimeout,
      };

      if (state.token) {
        config.headers['Authorization'] = `Bearer ${state.token}`;
      }

      if (data) config.data = data;

      const requestPromise = (async () => {
        let lastError;
        const retries = options.retries ?? (method === 'GET' ? CONFIG.maxRetries : 0);
        
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const response = await axios(config);
            return response.data;
          } catch (error) {
            lastError = error;
            
            if (error.response?.status === 401) {
              logout(false);
              showToast('세션이 만료되었습니다. 다시 로그인해 주세요.', 'error');
              throw { error: '인증이 만료되었습니다.' };
            }
            
            if (error.response?.status === 403) {
              showToast('권한이 없습니다.', 'error');
              throw error.response.data || { error: '접근 권한이 없습니다.' };
            }
            
            if (error.response?.status === 404) {
              throw error.response.data || { error: '요청한 리소스를 찾을 수 없습니다.' };
            }
            
            if (error.response?.status >= 500) {
              logError('API Server Error', { path, status: error.response.status, data: error.response.data });
              if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                continue;
              }
            }
            
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
              logError('API Timeout', { path, attempt });
              if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
              throw { error: '서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' };
            }
            
            if (!navigator.onLine) {
              throw { error: '네트워크 연결을 확인해 주세요.' };
            }
            
            throw error.response?.data || { error: '요청 처리 중 오류가 발생했습니다.' };
          }
        }
        
        throw lastError?.response?.data || { error: '요청 처리에 실패했습니다.' };
      })();
      
      if (options.dedupe) {
        this.pendingRequests.set(requestKey, requestPromise);
        requestPromise.finally(() => this.pendingRequests.delete(requestKey));
      }
      
      return requestPromise;
    },

    get(path, options) { return this.request('GET', path, null, options); },
    post(path, data, options) { return this.request('POST', path, data, options); },
    put(path, data, options) { return this.request('PUT', path, data, options); },
    delete(path, options) { return this.request('DELETE', path, null, options); },
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
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
      } catch {
        return '-';
      }
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch {
        return '-';
      }
    },
    
    formatRelativeTime(dateStr) {
      if (!dateStr) return '-';
      try {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '방금';
        if (minutes < 60) return `${minutes}분 전`;
        if (hours < 24) return `${hours}시간 전`;
        if (days < 7) return `${days}일 전`;
        return this.formatDate(dateStr);
      } catch {
        return '-';
      }
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

    // CRF 서명 권한 확인 (ADMIN 또는 PI만 가능)
    canSign() {
      return state.user && ['ADMIN', 'PI'].includes(state.user.role);
    },

    hasPermission(permission) {
      const rolePermissions = {
        ADMIN: ['VIEW_AUDIT', 'EXPORT_DATA', 'MANAGE_USERS', 'MANAGE_STUDIES', 'VIEW_ALL'],
        DM: ['VIEW_AUDIT', 'EXPORT_DATA', 'MANAGE_STUDIES'],
        PI: ['VIEW_AUDIT', 'EXPORT_DATA'],
        CRA: ['VIEW_AUDIT', 'EXPORT_DATA'],
        SUB_INV: ['VIEW_AUDIT'],
        CRC: ['VIEW_AUDIT'],
      };
      if (!state.user) return false;
      const perms = rolePermissions[state.user.role] || [];
      return perms.includes(permission);
    },
  };

  // =====================================================
  // DATA TABLE COMPONENT - Sorting, Filtering, Pagination
  // =====================================================
  const DataTable = {
    instances: new Map(),
    
    create(containerId, config) {
      const instance = {
        id: containerId,
        data: config.data || [],
        columns: config.columns || [],
        pageSize: config.pageSize || 10,
        currentPage: 1,
        sortColumn: config.defaultSort || null,
        sortDirection: config.defaultSortDir || 'asc',
        filters: {},
        searchQuery: '',
        onRowClick: config.onRowClick || null,
        emptyMessage: config.emptyMessage || '데이터가 없습니다.',
        showSearch: config.showSearch !== false,
        showPagination: config.showPagination !== false,
        showFilters: config.showFilters !== false,
        pageSizeOptions: config.pageSizeOptions || [10, 25, 50, 100],
        actionColumn: config.actionColumn || null
      };
      
      this.instances.set(containerId, instance);
      this.render(containerId);
      return instance;
    },
    
    getData(containerId) {
      const instance = this.instances.get(containerId);
      if (!instance) return [];
      
      let data = [...instance.data];
      
      // Apply search filter
      if (instance.searchQuery) {
        const query = instance.searchQuery.toLowerCase();
        data = data.filter(row => {
          return instance.columns.some(col => {
            const value = this.getNestedValue(row, col.field);
            return value && String(value).toLowerCase().includes(query);
          });
        });
      }
      
      // Apply column filters
      Object.entries(instance.filters).forEach(([field, filterValue]) => {
        if (filterValue && filterValue !== '') {
          data = data.filter(row => {
            const value = this.getNestedValue(row, field);
            return value && String(value).toLowerCase().includes(filterValue.toLowerCase());
          });
        }
      });
      
      // Apply sorting
      if (instance.sortColumn) {
        data.sort((a, b) => {
          const aVal = this.getNestedValue(a, instance.sortColumn);
          const bVal = this.getNestedValue(b, instance.sortColumn);
          
          let comparison = 0;
          if (aVal === null || aVal === undefined) comparison = 1;
          else if (bVal === null || bVal === undefined) comparison = -1;
          else if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
          } else {
            comparison = String(aVal).localeCompare(String(bVal), 'ko');
          }
          
          return instance.sortDirection === 'asc' ? comparison : -comparison;
        });
      }
      
      return data;
    },
    
    getNestedValue(obj, path) {
      if (!path) return obj;
      return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    },
    
    getPagedData(containerId) {
      const instance = this.instances.get(containerId);
      if (!instance) return [];
      
      const data = this.getData(containerId);
      const start = (instance.currentPage - 1) * instance.pageSize;
      return data.slice(start, start + instance.pageSize);
    },
    
    getTotalPages(containerId) {
      const instance = this.instances.get(containerId);
      if (!instance) return 0;
      const data = this.getData(containerId);
      return Math.ceil(data.length / instance.pageSize);
    },
    
    sort(containerId, column) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      if (instance.sortColumn === column) {
        instance.sortDirection = instance.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        instance.sortColumn = column;
        instance.sortDirection = 'asc';
      }
      instance.currentPage = 1;
      this.render(containerId);
    },
    
    filter(containerId, field, value) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      instance.filters[field] = value;
      instance.currentPage = 1;
      this.render(containerId);
    },
    
    search(containerId, query) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      instance.searchQuery = query;
      instance.currentPage = 1;
      this.render(containerId);
    },
    
    goToPage(containerId, page) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      const totalPages = this.getTotalPages(containerId);
      instance.currentPage = Math.max(1, Math.min(page, totalPages));
      this.render(containerId);
    },
    
    setPageSize(containerId, size) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      instance.pageSize = parseInt(size);
      instance.currentPage = 1;
      this.render(containerId);
    },
    
    updateData(containerId, newData) {
      const instance = this.instances.get(containerId);
      if (!instance) return;
      
      instance.data = newData;
      instance.currentPage = 1;
      this.render(containerId);
    },
    
    render(containerId) {
      const container = document.getElementById(containerId);
      const instance = this.instances.get(containerId);
      if (!container || !instance) return;
      
      const filteredData = this.getData(containerId);
      const pagedData = this.getPagedData(containerId);
      const totalPages = this.getTotalPages(containerId);
      const totalRecords = filteredData.length;
      const start = (instance.currentPage - 1) * instance.pageSize + 1;
      const end = Math.min(instance.currentPage * instance.pageSize, totalRecords);
      
      // Build unique filter values for each column
      const filterOptions = {};
      instance.columns.forEach(col => {
        if (col.filterable) {
          const values = new Set();
          instance.data.forEach(row => {
            const val = this.getNestedValue(row, col.field);
            if (val !== null && val !== undefined && val !== '') {
              values.add(String(val));
            }
          });
          filterOptions[col.field] = Array.from(values).sort();
        }
      });
      
      container.innerHTML = `
        ${instance.showSearch || instance.showFilters ? `
          <div class="dt-toolbar" style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; align-items: center;">
            ${instance.showSearch ? `
              <div class="dt-search" style="flex: 1; min-width: 200px; max-width: 300px;">
                <div style="position: relative;">
                  <input type="text" 
                         class="form-input" 
                         placeholder="검색..." 
                         value="${sanitizeHTML(instance.searchQuery)}"
                         oninput="DataTable.search('${containerId}', this.value)"
                         style="padding-left: 36px;">
                  <i class="fas fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted);"></i>
                </div>
              </div>
            ` : ''}
            ${instance.showFilters && Object.keys(filterOptions).length > 0 ? `
              <div class="dt-filters" style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${instance.columns.filter(col => col.filterable).map(col => `
                  <select class="form-input" 
                          style="width: auto; min-width: 120px; padding: 6px 12px; font-size: 13px;"
                          onchange="DataTable.filter('${containerId}', '${col.field}', this.value)">
                    <option value="">${col.header || col.field}</option>
                    ${(filterOptions[col.field] || []).map(val => `
                      <option value="${sanitizeHTML(val)}" ${instance.filters[col.field] === val ? 'selected' : ''}>${sanitizeHTML(val)}</option>
                    `).join('')}
                  </select>
                `).join('')}
              </div>
            ` : ''}
            <div class="dt-info" style="margin-left: auto; font-size: 13px; color: var(--text-muted);">
              ${totalRecords > 0 ? `${start}-${end} / ${totalRecords}건` : '0건'}
            </div>
          </div>
        ` : ''}
        
        ${totalRecords === 0 ? `
          <div class="empty-state" style="padding: 40px 20px;">
            <i class="fas fa-inbox" style="font-size: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
            <h3>${sanitizeHTML(instance.emptyMessage)}</h3>
          </div>
        ` : `
          <div class="dt-table-wrapper" style="overflow-x: auto;">
            <table class="data-table" style="width: 100%;">
              <thead>
                <tr>
                  ${instance.columns.map(col => `
                    <th style="${col.width ? `width: ${col.width};` : ''} ${col.sortable !== false ? 'cursor: pointer; user-select: none;' : ''}"
                        ${col.sortable !== false ? `onclick="DataTable.sort('${containerId}', '${col.field}')"` : ''}>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span>${col.header || col.field}</span>
                        ${col.sortable !== false ? `
                          <span class="dt-sort-icon" style="opacity: ${instance.sortColumn === col.field ? '1' : '0.3'}; font-size: 10px;">
                            ${instance.sortColumn === col.field 
                              ? (instance.sortDirection === 'asc' ? '<i class="fas fa-sort-up"></i>' : '<i class="fas fa-sort-down"></i>')
                              : '<i class="fas fa-sort"></i>'
                            }
                          </span>
                        ` : ''}
                      </div>
                    </th>
                  `).join('')}
                  ${instance.actionColumn ? '<th style="width: 80px;"></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${pagedData.map((row, idx) => `
                  <tr ${instance.onRowClick ? `class="clickable" onclick="${instance.onRowClick}('${row.id || idx}')"` : ''}>
                    ${instance.columns.map(col => {
                      let value = this.getNestedValue(row, col.field);
                      if (col.render) {
                        value = col.render(value, row);
                      } else if (col.type === 'date') {
                        value = ui.formatDate(value);
                      } else if (col.type === 'datetime') {
                        value = ui.formatDateTime(value);
                      } else if (col.type === 'badge') {
                        value = getStatusBadge(value);
                      } else {
                        value = value !== null && value !== undefined ? sanitizeHTML(String(value)) : '-';
                      }
                      return `<td style="${col.align ? `text-align: ${col.align};` : ''}">${value}</td>`;
                    }).join('')}
                    ${instance.actionColumn ? `<td onclick="event.stopPropagation();">${instance.actionColumn(row)}</td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          ${instance.showPagination && totalPages > 1 ? `
            <div class="dt-pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light); flex-wrap: wrap; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; color: var(--text-muted);">페이지당</span>
                <select class="form-input" 
                        style="width: auto; padding: 4px 8px; font-size: 13px;"
                        onchange="DataTable.setPageSize('${containerId}', this.value)">
                  ${instance.pageSizeOptions.map(size => `
                    <option value="${size}" ${instance.pageSize === size ? 'selected' : ''}>${size}개</option>
                  `).join('')}
                </select>
              </div>
              <div class="dt-page-buttons" style="display: flex; gap: 4px; align-items: center;">
                <button class="btn btn-secondary btn-sm" 
                        onclick="DataTable.goToPage('${containerId}', 1)" 
                        ${instance.currentPage === 1 ? 'disabled' : ''}
                        style="padding: 6px 10px;">
                  <i class="fas fa-angle-double-left"></i>
                </button>
                <button class="btn btn-secondary btn-sm" 
                        onclick="DataTable.goToPage('${containerId}', ${instance.currentPage - 1})" 
                        ${instance.currentPage === 1 ? 'disabled' : ''}
                        style="padding: 6px 10px;">
                  <i class="fas fa-angle-left"></i>
                </button>
                <span style="padding: 0 12px; font-size: 13px; color: var(--text-secondary);">
                  ${instance.currentPage} / ${totalPages}
                </span>
                <button class="btn btn-secondary btn-sm" 
                        onclick="DataTable.goToPage('${containerId}', ${instance.currentPage + 1})" 
                        ${instance.currentPage === totalPages ? 'disabled' : ''}
                        style="padding: 6px 10px;">
                  <i class="fas fa-angle-right"></i>
                </button>
                <button class="btn btn-secondary btn-sm" 
                        onclick="DataTable.goToPage('${containerId}', ${totalPages})" 
                        ${instance.currentPage === totalPages ? 'disabled' : ''}
                        style="padding: 6px 10px;">
                  <i class="fas fa-angle-double-right"></i>
                </button>
              </div>
            </div>
          ` : ''}
        `}
      `;
    },
    
    destroy(containerId) {
      this.instances.delete(containerId);
      const container = document.getElementById(containerId);
      if (container) container.innerHTML = '';
    }
  };
  window.DataTable = DataTable;

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
  const toastQueue = [];
  let isProcessingToast = false;
  
  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    // Prevent duplicate messages
    const existing = Array.from(container.querySelectorAll('.toast span'));
    if (existing.some(el => el.textContent === message)) return;
    
    const icons = {
      success: 'check-circle',
      error: 'times-circle',
      warning: 'exclamation-triangle',
      info: 'info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <i class="fas fa-${icons[type] || 'info-circle'}" aria-hidden="true"></i>
      <span>${sanitizeHTML(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()" aria-label="닫기">
        <i class="fas fa-times"></i>
      </button>
    `;
    
    // Add toast close button styles inline if not present
    const style = toast.querySelector('.toast-close');
    if (style) {
      style.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;padding:4px;margin-left:8px;opacity:0.7;';
    }
    
    container.appendChild(toast);
    
    // Animate in
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    requestAnimationFrame(() => {
      toast.style.transition = 'transform 0.2s, opacity 0.2s';
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    
    setTimeout(() => {
      toast.style.transform = 'translateY(-20px)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
  window.showToast = showToast;

  // =====================================================
  // MODAL
  // =====================================================
  let modalStack = [];
  let previousActiveElement = null;
  
  function showModal(title, content, actions = [], options = {}) {
    const container = document.getElementById('modal-container');
    if (!container) return;
    
    previousActiveElement = document.activeElement;
    
    const modalId = `modal-${Date.now()}`;
    const size = options.size || 'default'; // 'small', 'default', 'large', 'fullscreen'
    const sizeClass = size === 'small' ? 'max-width: 400px;' : size === 'large' ? 'max-width: 800px;' : size === 'fullscreen' ? 'max-width: 95%; max-height: 95%;' : 'max-width: 560px;';
    
    container.innerHTML = `
      <div class="modal-overlay" id="${modalId}" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
        <div class="modal" style="${sizeClass}" onclick="event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title" id="${modalId}-title">${sanitizeHTML(title)}</span>
            <button class="modal-close" onclick="closeModal()" aria-label="닫기">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <div class="modal-body" tabindex="-1">${content}</div>
          ${actions.length > 0 ? `
            <div class="modal-footer">
              ${actions.map((a, i) => `
                <button 
                  class="btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-secondary'}" 
                  onclick="${a.onclick}"
                  ${a.disabled ? 'disabled' : ''}
                  ${i === actions.length - 1 ? 'data-autofocus' : ''}
                >
                  ${a.icon ? `<i class="fas fa-${a.icon}" aria-hidden="true"></i> ` : ''}${sanitizeHTML(a.label)}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    modalStack.push(modalId);
    document.body.style.overflow = 'hidden';
    
    // Focus management
    requestAnimationFrame(() => {
      const autofocus = container.querySelector('[data-autofocus]');
      const firstInput = container.querySelector('input:not([type="hidden"]), select, textarea');
      (autofocus || firstInput || container.querySelector('.modal-body'))?.focus();
    });
    
    // Keyboard handling
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
      // Trap focus within modal
      if (e.key === 'Tab') {
        const modal = container.querySelector('.modal');
        const focusables = modal?.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables?.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeydown);
    container._keydownHandler = handleKeydown;
    
    // Click outside to close
    const overlay = container.querySelector('.modal-overlay');
    if (overlay && !options.persistent) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });
    }
  }
  window.showModal = showModal;

  function closeModal() {
    const container = document.getElementById('modal-container');
    if (!container || !modalStack.length) return;
    
    modalStack.pop();
    
    if (container._keydownHandler) {
      document.removeEventListener('keydown', container._keydownHandler);
      delete container._keydownHandler;
    }
    
    container.innerHTML = '';
    document.body.style.overflow = '';
    
    // Restore focus
    if (previousActiveElement && previousActiveElement.focus) {
      previousActiveElement.focus();
    }
  }
  window.closeModal = closeModal;
  
  // Confirmation dialog helper
  function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
      const title = options.title || '확인';
      const confirmLabel = options.confirmLabel || '확인';
      const cancelLabel = options.cancelLabel || '취소';
      const isDanger = options.danger || false;
      
      window._confirmResolve = resolve;
      
      showModal(title, `
        <p style="color: var(--text-secondary); line-height: 1.6;">${sanitizeHTML(message)}</p>
      `, [
        { label: cancelLabel, onclick: 'window._confirmResolve(false); closeModal();' },
        { label: confirmLabel, [isDanger ? 'danger' : 'primary']: true, onclick: 'window._confirmResolve(true); closeModal();' }
      ], { size: 'small' });
    });
  }
  window.showConfirm = showConfirm;

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
          <!-- Global Search -->
          <div class="global-search-container" style="position: relative; margin-right: 8px;">
            <input type="text" 
                   id="global-search-input" 
                   class="form-input" 
                   placeholder="검색 (Ctrl+K)" 
                   style="width: 200px; padding: 6px 12px 6px 32px; font-size: 13px; border-radius: 20px; background: var(--bg-secondary);"
                   onfocus="showGlobalSearchDropdown()"
                   oninput="debounce(() => performGlobalSearch(this.value), 300)()"
                   onkeydown="handleGlobalSearchKeydown(event)">
            <i class="fas fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 12px;"></i>
            <div id="global-search-dropdown" class="global-search-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; min-width: 350px; max-height: 400px; overflow-y: auto; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-top: 4px; z-index: 1000;"></div>
          </div>
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
  // NAVIGATION WITH BROWSER HISTORY SUPPORT
  // =====================================================
  
  // History management flag to prevent double navigation
  let isNavigatingFromPopState = false;
  
  function navigateTo(view, params = {}, pushToHistory = true) {
    state.currentView = view;
    
    document.querySelectorAll('.header-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    
    // Push to browser history (unless navigating from popstate)
    if (pushToHistory && !isNavigatingFromPopState) {
      const historyState = { view, params };
      const url = buildUrlFromState(view, params);
      history.pushState(historyState, '', url);
    }
    
    updateBreadcrumb(view, params);
    
    switch (view) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'studies':
        loadStudiesPage();
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
      case 'form':
        loadFormDefinitionDetail(params.studyId, params.formId);
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

  // Build URL hash from view and params
  function buildUrlFromState(view, params) {
    let hash = `#/${view}`;
    const paramKeys = Object.keys(params);
    if (paramKeys.length > 0) {
      const paramStr = paramKeys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
      hash += `?${paramStr}`;
    }
    return hash;
  }

  // Parse URL hash to view and params
  function parseUrlHash(hash) {
    if (!hash || hash === '#' || hash === '#/') {
      return { view: 'dashboard', params: {} };
    }
    
    // Remove leading #/
    let path = hash.replace(/^#\/?/, '');
    
    // Split view and query string
    const [viewPart, queryPart] = path.split('?');
    const view = viewPart || 'dashboard';
    
    // Parse query params
    const params = {};
    if (queryPart) {
      queryPart.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key) {
          params[key] = decodeURIComponent(value || '');
        }
      });
    }
    
    return { view, params };
  }

  // Handle browser back/forward button
  function handlePopState(event) {
    isNavigatingFromPopState = true;
    
    if (event.state && event.state.view) {
      // Use saved state
      navigateTo(event.state.view, event.state.params || {}, false);
    } else {
      // Parse from URL hash
      const { view, params } = parseUrlHash(window.location.hash);
      navigateTo(view, params, false);
    }
    
    isNavigatingFromPopState = false;
  }

  // Initialize history handling
  function initHistoryHandling() {
    // Listen for back/forward button
    window.addEventListener('popstate', handlePopState);
    
    // Handle initial URL on page load
    const { view, params } = parseUrlHash(window.location.hash);
    if (view !== 'dashboard' || Object.keys(params).length > 0) {
      // If URL has specific view, navigate to it after login
      state.initialRoute = { view, params };
    }
    
    // Replace initial state
    const initialState = { view: 'dashboard', params: {} };
    history.replaceState(initialState, '', '#/dashboard');
  }

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

      <!-- Dashboard Charts Section -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 20px;">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-pie" style="margin-right: 8px;"></i>피험자 등록 현황</span>
          </div>
          <div class="card-body" style="height: 250px;">
            <canvas id="chart-enrollment"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-bar" style="margin-right: 8px;"></i>Query 현황</span>
          </div>
          <div class="card-body" style="height: 250px;">
            <canvas id="chart-queries"></canvas>
          </div>
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 20px;">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-line" style="margin-right: 8px;"></i>등록 추이 (최근 7일)</span>
          </div>
          <div class="card-body" style="height: 200px;">
            <canvas id="chart-trend"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-tasks" style="margin-right: 8px;"></i>CRF 완료율</span>
          </div>
          <div class="card-body" style="height: 200px;">
            <canvas id="chart-crf"></canvas>
          </div>
        </div>
      </div>

      <!-- Recent Studies (최근 3개만 표시) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">최근 임상시험</span>
          <button class="btn btn-secondary btn-sm" onclick="navigateTo('studies')">전체 보기 <i class="fas fa-arrow-right"></i></button>
        </div>
        <div class="card-body compact" id="recent-studies-list">
          <div class="loading"><div class="spinner"></div><span>데이터를 불러오는 중...</span></div>
        </div>
      </div>
    `;

    try {
      const studiesResult = await api.get('/studies');
      state.studies = studiesResult.data || [];
      renderRecentStudiesList();
      loadDashboardStats();
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      ui.setHtml('#recent-studies-list', `<div class="empty-state"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>데이터 로드 실패</h3></div>`);
    }
  }

  function renderRecentStudiesList() {
    const container = document.getElementById('recent-studies-list');
    if (!container) return;
    
    if (state.studies.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-flask"></i>
          <h3>등록된 임상시험이 없습니다</h3>
          <p>새로운 임상시험을 등록해 주세요.</p>
          ${ui.canManage() ? `<button class="btn btn-primary" style="margin-top: 12px;" onclick="showNewStudyModal()"><i class="fas fa-plus"></i> 새 Study 등록</button>` : ''}
        </div>
      `;
      return;
    }

    // Show only recent 3 studies
    const recentStudies = state.studies.slice(0, 3);
    
    container.innerHTML = recentStudies.map(study => `
      <div class="study-item" onclick="navigateTo('study', {studyId: '${study.id}'})">
        <div class="study-item-header">
          <span class="study-protocol">${sanitizeHTML(study.protocol_number)}</span>
          ${getStatusBadge(study.status)}
          ${study.phase ? `<span class="badge badge-draft">Phase ${study.phase}</span>` : ''}
        </div>
        <div class="study-title">${sanitizeHTML(study.title || '')}</div>
        <div class="study-meta">
          <span class="study-meta-item"><i class="fas fa-building"></i> ${sanitizeHTML(study.sponsor || '-')}</span>
          <span class="study-meta-item"><i class="fas fa-calendar"></i> ${ui.formatDate(study.study_start_date)}</span>
          <span class="study-meta-item"><i class="fas fa-users"></i> ${study.subject_count || 0}명</span>
        </div>
      </div>
    `).join('') + (state.studies.length > 3 ? `
      <div style="text-align: center; padding: 12px;">
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('studies')">
          +${state.studies.length - 3}개 더 보기
        </button>
      </div>
    ` : '');
  }

  // Old function kept for backward compatibility but redirects to new one
  function renderStudiesList() {
    const container = document.getElementById('studies-list');
    if (!container) return;
    
    if (state.studies.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-flask"></i><h3>등록된 임상시험이 없습니다</h3><p>새로운 임상시험을 등록해 주세요.</p></div>`;
      return;
    }

    // Use DataTable for studies list if more than 5 studies (legacy)
    if (state.studies.length > 5) {
      DataTable.create('studies-list', {
        data: state.studies,
        columns: [
          { field: 'protocol_number', header: 'Protocol', sortable: true, filterable: true,
            render: (val) => `<strong>${sanitizeHTML(val)}</strong>` },
          { field: 'title', header: '제목', sortable: true },
          { field: 'status', header: '상태', sortable: true, filterable: true, type: 'badge' },
          { field: 'phase', header: 'Phase', sortable: true, filterable: true,
            render: (val) => val ? `Phase ${val}` : '-' },
          { field: 'sponsor', header: '스폰서', sortable: true },
          { field: 'study_start_date', header: '시작일', sortable: true, type: 'date' }
        ],
        onRowClick: "(id) => navigateTo('study', {studyId: id})".replace(/'/g, "\\'"),
        emptyMessage: '등록된 임상시험이 없습니다',
        pageSize: 10
      });
      // Re-attach row click handler properly
      setTimeout(() => {
        container.querySelectorAll('tbody tr').forEach((tr, idx) => {
          tr.onclick = () => navigateTo('study', { studyId: state.studies[idx]?.id });
        });
      }, 0);
    } else {
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
  }

  // Store chart instances for cleanup
  let dashboardCharts = {};

  async function loadDashboardStats() {
    const statStudies = document.getElementById('stat-studies');
    const statSubjects = document.getElementById('stat-subjects');
    const statQueries = document.getElementById('stat-queries');
    const statSignatures = document.getElementById('stat-signatures');

    if (statStudies) statStudies.textContent = state.studies.length.toString();
    
    let totalSubjects = 0, totalQueries = 0, totalSignatures = 0;
    let subjectsByStatus = { SCREENING: 0, ENROLLED: 0, RANDOMIZED: 0, COMPLETED: 0, WITHDRAWN: 0 };
    let queriesByStatus = { OPEN: 0, ANSWERED: 0, CLOSED: 0, CANCELLED: 0 };
    let crfStats = { completed: 0, inProgress: 0, notStarted: 0 };

    for (const study of state.studies.slice(0, 5)) {
      try {
        const stats = await api.get(`/studies/${study.id}/stats`);
        if (stats.success && stats.data) {
          // Subject stats
          (stats.data.subjects || []).forEach(s => {
            totalSubjects += s.count;
            if (subjectsByStatus[s.status] !== undefined) {
              subjectsByStatus[s.status] += s.count;
            }
          });
          
          // Query stats
          (stats.data.queries || []).forEach(q => {
            if (q.status === 'OPEN') totalQueries += q.count;
            if (queriesByStatus[q.status] !== undefined) {
              queriesByStatus[q.status] += q.count;
            }
          });
          
          // CRF stats
          (stats.data.crfs || []).forEach(c => {
            if (['COMPLETE', 'SIGNED', 'LOCKED'].includes(c.status)) {
              crfStats.completed += c.count;
            } else if (c.status === 'IN_PROGRESS') {
              crfStats.inProgress += c.count;
            } else {
              crfStats.notStarted += c.count;
            }
          });
        }
      } catch (e) {}
    }

    if (statSubjects) statSubjects.textContent = totalSubjects.toString();
    if (statQueries) statQueries.textContent = totalQueries.toString();
    if (statSignatures) statSignatures.textContent = totalSignatures.toString();

    // Initialize charts
    initDashboardCharts(subjectsByStatus, queriesByStatus, crfStats);
  }

  function initDashboardCharts(subjectsByStatus, queriesByStatus, crfStats) {
    // Destroy existing charts
    Object.values(dashboardCharts).forEach(chart => {
      if (chart) chart.destroy();
    });
    dashboardCharts = {};

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.log('Chart.js not loaded');
      return;
    }

    const chartColors = {
      primary: '#4f46e5',
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#ef4444',
      info: '#3b82f6',
      secondary: '#6b7280',
      purple: '#8b5cf6',
      pink: '#ec4899'
    };

    // 1. Enrollment Pie Chart
    const enrollmentCtx = document.getElementById('chart-enrollment')?.getContext('2d');
    if (enrollmentCtx) {
      const enrollmentData = [
        subjectsByStatus.SCREENING,
        subjectsByStatus.ENROLLED,
        subjectsByStatus.RANDOMIZED,
        subjectsByStatus.COMPLETED,
        subjectsByStatus.WITHDRAWN
      ];
      
      if (enrollmentData.some(v => v > 0)) {
        dashboardCharts.enrollment = new Chart(enrollmentCtx, {
          type: 'doughnut',
          data: {
            labels: ['스크리닝', '등록', '무작위배정', '완료', '중도탈락'],
            datasets: [{
              data: enrollmentData,
              backgroundColor: [chartColors.info, chartColors.primary, chartColors.purple, chartColors.success, chartColors.danger],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'right',
                labels: { font: { size: 11 }, padding: 12 }
              }
            },
            cutout: '60%'
          }
        });
      } else {
        enrollmentCtx.canvas.parentElement.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);"><i class="fas fa-chart-pie" style="font-size: 48px; opacity: 0.3;"></i></div>';
      }
    }

    // 2. Query Bar Chart
    const queryCtx = document.getElementById('chart-queries')?.getContext('2d');
    if (queryCtx) {
      dashboardCharts.queries = new Chart(queryCtx, {
        type: 'bar',
        data: {
          labels: ['미결', '답변됨', '종결', '취소'],
          datasets: [{
            label: 'Query 수',
            data: [queriesByStatus.OPEN, queriesByStatus.ANSWERED, queriesByStatus.CLOSED, queriesByStatus.CANCELLED],
            backgroundColor: [chartColors.warning, chartColors.info, chartColors.success, chartColors.secondary],
            borderRadius: 6,
            barThickness: 40
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1 }
            }
          }
        }
      });
    }

    // 3. Trend Line Chart (simulated data for demo)
    const trendCtx = document.getElementById('chart-trend')?.getContext('2d');
    if (trendCtx) {
      const today = new Date();
      const labels = [];
      const data = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));
        // Simulated cumulative data
        data.push(Math.floor(Math.random() * 3) + (i === 0 ? subjectsByStatus.ENROLLED : 0));
      }
      
      dashboardCharts.trend = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: '신규 등록',
            data: data,
            borderColor: chartColors.primary,
            backgroundColor: chartColors.primary + '20',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: chartColors.primary,
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1 }
            }
          }
        }
      });
    }

    // 4. CRF Completion Chart
    const crfCtx = document.getElementById('chart-crf')?.getContext('2d');
    if (crfCtx) {
      const totalCrf = crfStats.completed + crfStats.inProgress + crfStats.notStarted;
      const completionRate = totalCrf > 0 ? Math.round((crfStats.completed / totalCrf) * 100) : 0;
      
      dashboardCharts.crf = new Chart(crfCtx, {
        type: 'doughnut',
        data: {
          labels: ['완료', '진행중', '미시작'],
          datasets: [{
            data: [crfStats.completed, crfStats.inProgress, crfStats.notStarted],
            backgroundColor: [chartColors.success, chartColors.warning, chartColors.secondary],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { font: { size: 11 }, padding: 12 }
            }
          },
          cutout: '70%'
        },
        plugins: [{
          id: 'centerText',
          beforeDraw: function(chart) {
            const ctx = chart.ctx;
            const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
            const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
            
            ctx.save();
            ctx.font = 'bold 24px system-ui';
            ctx.fillStyle = chartColors.success;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(completionRate + '%', centerX, centerY);
            ctx.restore();
          }
        }]
      });
    }
  }

  // =====================================================
  // STUDIES PAGE (별도 페이지)
  // =====================================================
  async function loadStudiesPage() {
    state.currentStudy = null;
    state.currentSite = null;
    state.currentSubject = null;
    state.currentVisit = null;

    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <div>
          <h1 style="font-size: 24px; font-weight: 600; margin: 0;">임상시험 관리</h1>
          <p style="color: var(--text-muted); margin: 4px 0 0 0;">등록된 모든 임상시험을 관리합니다.</p>
        </div>
        ${ui.canManage() ? `<button class="btn btn-primary" onclick="showNewStudyModal()"><i class="fas fa-plus"></i> 새 Study 등록</button>` : ''}
      </div>

      <!-- Filter & Search -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-body" style="padding: 16px;">
          <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            <div style="flex: 1; min-width: 200px;">
              <input type="text" class="form-input" id="studies-search" placeholder="Protocol, 제목, 스폰서 검색..." oninput="filterStudies()">
            </div>
            <div style="min-width: 150px;">
              <select class="form-input" id="studies-status-filter" onchange="filterStudies()">
                <option value="">모든 상태</option>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="LOCKED">Locked</option>
              </select>
            </div>
            <div style="min-width: 120px;">
              <select class="form-input" id="studies-phase-filter" onchange="filterStudies()">
                <option value="">모든 Phase</option>
                <option value="1">Phase 1</option>
                <option value="2">Phase 2</option>
                <option value="3">Phase 3</option>
                <option value="4">Phase 4</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Studies Grid -->
      <div id="studies-grid" class="studies-grid">
        <div class="loading"><div class="spinner"></div><span>임상시험 목록을 불러오는 중...</span></div>
      </div>
    `;

    // Add grid styles if not exists
    if (!document.getElementById('studies-grid-styles')) {
      const style = document.createElement('style');
      style.id = 'studies-grid-styles';
      style.textContent = `
        .studies-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .study-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .study-card:hover {
          border-color: var(--primary);
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.1);
          transform: translateY(-2px);
        }
        .study-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .study-card-protocol {
          font-size: 18px;
          font-weight: 600;
          color: var(--primary);
        }
        .study-card-title {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 16px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .study-card-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          padding-top: 16px;
          border-top: 1px solid var(--border-light);
        }
        .study-card-stat {
          text-align: center;
        }
        .study-card-stat-value {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .study-card-stat-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .study-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--border-light);
          font-size: 12px;
          color: var(--text-muted);
        }
      `;
      document.head.appendChild(style);
    }

    try {
      const studiesResult = await api.get('/studies');
      state.studies = studiesResult.data || [];
      renderStudiesGrid();
    } catch (error) {
      console.error('Failed to load studies:', error);
      document.getElementById('studies-grid').innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>데이터 로드 실패</h3>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="loadStudiesPage()">다시 시도</button>
        </div>
      `;
    }
  }

  function renderStudiesGrid() {
    const container = document.getElementById('studies-grid');
    if (!container) return;

    const searchQuery = document.getElementById('studies-search')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('studies-status-filter')?.value || '';
    const phaseFilter = document.getElementById('studies-phase-filter')?.value || '';

    let filteredStudies = state.studies.filter(study => {
      const matchesSearch = !searchQuery || 
        study.protocol_number?.toLowerCase().includes(searchQuery) ||
        study.title?.toLowerCase().includes(searchQuery) ||
        study.sponsor?.toLowerCase().includes(searchQuery);
      const matchesStatus = !statusFilter || study.status === statusFilter;
      const matchesPhase = !phaseFilter || study.phase === phaseFilter;
      return matchesSearch && matchesStatus && matchesPhase;
    });

    if (filteredStudies.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 20px;">
          <i class="fas fa-flask" style="font-size: 48px; opacity: 0.3;"></i>
          <h3>${state.studies.length === 0 ? '등록된 임상시험이 없습니다' : '검색 결과가 없습니다'}</h3>
          <p style="color: var(--text-muted);">${state.studies.length === 0 ? '새로운 임상시험을 등록해 주세요.' : '다른 검색어를 시도해 보세요.'}</p>
          ${state.studies.length === 0 && ui.canManage() ? `<button class="btn btn-primary" style="margin-top: 16px;" onclick="showNewStudyModal()"><i class="fas fa-plus"></i> 새 Study 등록</button>` : ''}
        </div>
      `;
      return;
    }

    container.innerHTML = filteredStudies.map(study => `
      <div class="study-card" onclick="navigateTo('study', {studyId: '${study.id}'})">
        <div class="study-card-header">
          <div>
            <div class="study-card-protocol">${sanitizeHTML(study.protocol_number)}</div>
            ${study.phase ? `<span class="badge badge-draft" style="margin-top: 4px;">Phase ${study.phase}</span>` : ''}
          </div>
          ${getStatusBadge(study.status)}
        </div>
        <div class="study-card-title">${sanitizeHTML(study.title || '제목 없음')}</div>
        <div class="study-card-stats">
          <div class="study-card-stat">
            <div class="study-card-stat-value">${study.site_count || 0}</div>
            <div class="study-card-stat-label">Sites</div>
          </div>
          <div class="study-card-stat">
            <div class="study-card-stat-value">${study.subject_count || 0}</div>
            <div class="study-card-stat-label">Subjects</div>
          </div>
          <div class="study-card-stat">
            <div class="study-card-stat-value">${study.open_query_count || 0}</div>
            <div class="study-card-stat-label">Queries</div>
          </div>
        </div>
        <div class="study-card-footer">
          <span><i class="fas fa-building"></i> ${sanitizeHTML(study.sponsor || '-')}</span>
          <span><i class="fas fa-calendar"></i> ${ui.formatDate(study.study_start_date) || '-'}</span>
        </div>
      </div>
    `).join('');
  }
  window.renderStudiesGrid = renderStudiesGrid;

  function filterStudies() {
    renderStudiesGrid();
  }
  window.filterStudies = filterStudies;

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
        <label class="form-label">Short Title</label>
        <input type="text" class="form-input" id="study-short-title" placeholder="간략 제목">
      </div>
      <div class="form-group">
        <label class="form-label">Sponsor</label>
        <input type="text" class="form-input" id="study-sponsor" placeholder="스폰서 기관명">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Phase</label>
          <select class="form-input" id="study-phase">
            <option value="">선택</option>
            <option value="I">Phase I</option>
            <option value="II">Phase II</option>
            <option value="III">Phase III</option>
            <option value="IV">Phase IV</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">치료 영역</label>
          <input type="text" class="form-input" id="study-therapeutic" placeholder="예: 종양학, 심혈관">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">IRB 승인번호</label>
          <input type="text" class="form-input" id="study-irb-number" placeholder="예: IRB-2025-001">
        </div>
        <div class="form-group">
          <label class="form-label">IRB 승인일</label>
          <input type="date" class="form-input" id="study-irb-date">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">시작일</label>
        <input type="date" class="form-input" id="study-start-date">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-input" id="study-description" rows="2" placeholder="임상시험 설명"></textarea>
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
    const shortTitle = document.getElementById('study-short-title')?.value?.trim();
    const sponsor = document.getElementById('study-sponsor')?.value?.trim();
    const phase = document.getElementById('study-phase')?.value;
    const therapeutic = document.getElementById('study-therapeutic')?.value?.trim();
    const irbNumber = document.getElementById('study-irb-number')?.value?.trim();
    const irbDate = document.getElementById('study-irb-date')?.value;
    const startDate = document.getElementById('study-start-date')?.value;
    const description = document.getElementById('study-description')?.value?.trim();

    if (!protocol || !title) {
      showToast('Protocol Number와 Title은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.post('/studies', {
        protocol_number: protocol,
        title,
        short_title: shortTitle || null,
        sponsor: sponsor || null,
        phase: phase || null,
        therapeutic_area: therapeutic || null,
        irb_approval_number: irbNumber || null,
        irb_approval_date: irbDate || null,
        study_start_date: startDate || null,
        description: description || null
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
        <input type="text" class="form-input" value="${study.protocol_number || ''}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">Study Title <span class="required">*</span></label>
        <input type="text" class="form-input" id="edit-study-title" value="${study.title || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Short Title</label>
        <input type="text" class="form-input" id="edit-study-short-title" value="${study.short_title || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Sponsor</label>
        <input type="text" class="form-input" id="edit-study-sponsor" value="${study.sponsor || ''}">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
            <option value="I" ${study.phase === 'I' ? 'selected' : ''}>Phase I</option>
            <option value="II" ${study.phase === 'II' ? 'selected' : ''}>Phase II</option>
            <option value="III" ${study.phase === 'III' ? 'selected' : ''}>Phase III</option>
            <option value="IV" ${study.phase === 'IV' ? 'selected' : ''}>Phase IV</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">치료 영역</label>
        <input type="text" class="form-input" id="edit-study-therapeutic" value="${study.therapeutic_area || ''}" placeholder="예: 종양학, 심혈관">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">IRB 승인번호</label>
          <input type="text" class="form-input" id="edit-study-irb-number" value="${study.irb_approval_number || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">IRB 승인일</label>
          <input type="date" class="form-input" id="edit-study-irb-date" value="${study.irb_approval_date?.split('T')[0] || ''}">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">시작일</label>
          <input type="date" class="form-input" id="edit-study-start-date" value="${study.study_start_date?.split('T')[0] || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">종료일</label>
          <input type="date" class="form-input" id="edit-study-end-date" value="${study.study_end_date?.split('T')[0] || ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-input" id="edit-study-description" rows="2">${study.description || ''}</textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateStudy('${studyId}')` }
    ]);
  }
  window.showEditStudyModal = showEditStudyModal;

  async function updateStudy(studyId) {
    const title = document.getElementById('edit-study-title')?.value?.trim();
    const shortTitle = document.getElementById('edit-study-short-title')?.value?.trim();
    const sponsor = document.getElementById('edit-study-sponsor')?.value?.trim();
    const status = document.getElementById('edit-study-status')?.value;
    const phase = document.getElementById('edit-study-phase')?.value;
    const therapeutic = document.getElementById('edit-study-therapeutic')?.value?.trim();
    const irbNumber = document.getElementById('edit-study-irb-number')?.value?.trim();
    const irbDate = document.getElementById('edit-study-irb-date')?.value;
    const startDate = document.getElementById('edit-study-start-date')?.value;
    const endDate = document.getElementById('edit-study-end-date')?.value;
    const description = document.getElementById('edit-study-description')?.value?.trim();

    if (!title) {
      showToast('Title은 필수입니다.', 'error');
      return;
    }

    try {
      const result = await api.put(`/studies/${studyId}`, {
        title,
        short_title: shortTitle || null,
        sponsor: sponsor || null,
        status: status || null,
        phase: phase || null,
        therapeutic_area: therapeutic || null,
        irb_approval_number: irbNumber || null,
        irb_approval_date: irbDate || null,
        study_start_date: startDate || null,
        study_end_date: endDate || null,
        description: description || null
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
                  ${study.status !== 'LOCKED' 
                    ? `<button class="btn btn-secondary btn-sm" onclick="showLockStudyModal('${study.id}')"><i class="fas fa-lock"></i> 잠금</button>` 
                    : `<button class="btn btn-warning btn-sm" onclick="showUnlockStudyModal('${study.id}')"><i class="fas fa-unlock"></i> 잠금해제</button>`}
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
          <div class="stat-card" style="cursor: pointer;" onclick="switchStudyTab('sites')"><div class="stat-label">연구기관</div><div class="stat-value">${sites.length}</div></div>
          <div class="stat-card"><div class="stat-label">피험자</div><div class="stat-value">${study.subjectsCount || 0}</div></div>
          <div class="stat-card" style="cursor: pointer;" onclick="switchStudyTab('forms')"><div class="stat-label">CRF 양식</div><div class="stat-value">${(study.formDefinitions || []).length}</div></div>
          <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('queries', {studyId: '${study.id}'})"><div class="stat-label">미결 Query</div><div class="stat-value">${(stats.queries || []).find(q => q.status === 'OPEN')?.count || 0}</div></div>
        </div>

        <!-- 탭 네비게이션 -->
        <div class="tabs" id="study-tabs">
          <button class="tab-btn active" data-tab="sites" onclick="switchStudyTab('sites')">
            <i class="fas fa-hospital"></i> 연구기관 <span class="badge badge-info">${sites.length}</span>
          </button>
          <button class="tab-btn" data-tab="visits" onclick="switchStudyTab('visits')">
            <i class="fas fa-calendar-alt"></i> 방문일정 <span class="badge badge-info">${(study.visitSchedules || []).length}</span>
          </button>
          <button class="tab-btn" data-tab="forms" onclick="switchStudyTab('forms')">
            <i class="fas fa-file-medical"></i> CRF 양식 <span class="badge badge-info">${(study.formDefinitions || []).length}</span>
          </button>
          ${ui.canManage() ? `
          <button class="tab-btn" data-tab="users" onclick="switchStudyTab('users')">
            <i class="fas fa-user-tie"></i> 담당자
          </button>
          ` : ''}
        </div>

        <!-- 연구기관 탭 -->
        <div class="tab-content active" id="tab-sites">
          <div class="card">
            <div class="card-header">
              <span class="card-title">연구기관 목록</span>
              ${ui.canManage() ? `<button class="btn btn-primary btn-sm" onclick="showNewSiteModal('${study.id}')"><i class="fas fa-plus"></i> 기관 추가</button>` : ''}
            </div>
            <div class="card-body compact">
              ${sites.length === 0 ? `<div class="empty-state"><i class="fas fa-hospital"></i><h3>등록된 연구기관이 없습니다</h3>${ui.canManage() ? `<p style="color: var(--text-secondary); margin-bottom: 16px;">연구기관을 추가하여 피험자를 등록하세요</p><button class="btn btn-primary" onclick="showNewSiteModal('${study.id}')"><i class="fas fa-plus"></i> 기관 추가</button>` : ''}</div>` : `
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
        </div>

        <!-- 방문일정 탭 -->
        <div class="tab-content" id="tab-visits">
          <div class="card">
            <div class="card-header">
              <span class="card-title">방문 일정</span>
              ${ui.canManage() && study.status !== 'LOCKED' ? `<button class="btn btn-primary btn-sm" onclick="showNewVisitScheduleModal('${study.id}')"><i class="fas fa-plus"></i> 방문 추가</button>` : ''}
            </div>
            <div class="card-body compact">
              ${(study.visitSchedules || []).length === 0 ? `<div class="empty-state"><i class="fas fa-calendar-alt"></i><h3>등록된 방문 일정이 없습니다</h3>${ui.canManage() && study.status !== 'LOCKED' ? `<p style="color: var(--text-secondary); margin-bottom: 16px;">Study에 방문 일정을 추가해 주세요</p><button class="btn btn-primary" onclick="showNewVisitScheduleModal('${study.id}')"><i class="fas fa-plus"></i> 방문 추가</button>` : ''}</div>` : `
                <table class="data-table">
                  <thead><tr><th>번호</th><th>방문명</th><th>예정일(Day)</th><th>Window</th><th>필수</th><th></th></tr></thead>
                  <tbody>
                    ${(study.visitSchedules || []).map(vs => `
                      <tr>
                        <td><strong>V${vs.visit_number}</strong></td>
                        <td>${vs.visit_name}</td>
                        <td>Day ${vs.target_day || 0}</td>
                        <td>-${vs.visit_window_before || 0} / +${vs.visit_window_after || 0}</td>
                        <td>${vs.is_required ? '<span class="badge badge-active">필수</span>' : '<span class="badge badge-draft">선택</span>'}</td>
                        <td>
                          ${ui.canManage() && study.status !== 'LOCKED' ? `
                            <button class="btn btn-secondary btn-sm" onclick="showEditVisitScheduleModal('${study.id}', '${vs.id}')" style="padding: 4px 8px;"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-secondary btn-sm" onclick="deleteVisitSchedule('${study.id}', '${vs.id}')" style="padding: 4px 8px;"><i class="fas fa-trash"></i></button>
                          ` : ''}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        </div>

        <!-- CRF 양식 탭 -->
        <div class="tab-content" id="tab-forms">
          <div class="card">
            <div class="card-header">
              <span class="card-title">CRF 양식</span>
              ${ui.canManage() && study.status !== 'LOCKED' ? `<button class="btn btn-primary btn-sm" onclick="showNewFormDefinitionModal('${study.id}')"><i class="fas fa-plus"></i> 양식 추가</button>` : ''}
            </div>
            <div class="card-body compact">
              ${(study.formDefinitions || []).length === 0 ? `<div class="empty-state"><i class="fas fa-file-medical"></i><h3>등록된 CRF 양식이 없습니다</h3>${ui.canManage() && study.status !== 'LOCKED' ? `<p style="color: var(--text-secondary); margin-bottom: 16px;">CRF 데이터 수집을 위해 양식을 추가해 주세요</p><button class="btn btn-primary" onclick="showNewFormDefinitionModal('${study.id}')"><i class="fas fa-plus"></i> 양식 추가</button>` : ''}</div>` : `
                <table class="data-table">
                  <thead><tr><th>순서</th><th>양식 코드</th><th>양식명</th><th>방문</th><th>필드</th><th>필수</th><th></th></tr></thead>
                  <tbody>
                    ${(study.formDefinitions || []).map(form => {
                      const visitSchedule = (study.visitSchedules || []).find(vs => vs.id === form.visit_schedule_id);
                      return `
                      <tr class="clickable" onclick="navigateTo('form', {studyId: '${study.id}', formId: '${form.id}'})">
                        <td>${form.form_order || '-'}</td>
                        <td><strong>${form.form_code}</strong></td>
                        <td>${form.form_name}</td>
                        <td>${visitSchedule ? visitSchedule.visit_name : '전체'}</td>
                        <td>${form.field_count || 0}개</td>
                        <td>${form.is_required ? '<span class="badge badge-active">필수</span>' : '<span class="badge badge-draft">선택</span>'}</td>
                        <td onclick="event.stopPropagation();">
                          ${ui.canManage() && study.status !== 'LOCKED' ? `
                            <button class="btn btn-secondary btn-sm" onclick="showEditFormDefinitionModal('${study.id}', '${form.id}')" style="padding: 4px 8px;"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-secondary btn-sm" onclick="deleteFormDefinition('${study.id}', '${form.id}')" style="padding: 4px 8px;"><i class="fas fa-trash"></i></button>
                          ` : ''}
                        </td>
                      </tr>
                    `}).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        </div>

        <!-- 담당자 관리 탭 -->
        ${ui.canManage() ? `
        <div class="tab-content" id="tab-users">
          <div class="card" id="study-users-section">
            <div class="card-header">
              <span class="card-title">담당자 관리 (DM/CRA)</span>
              <button class="btn btn-primary btn-sm" onclick="showAssignStudyUserModal('${study.id}')"><i class="fas fa-user-plus"></i> 담당자 추가</button>
            </div>
            <div class="card-body compact" id="study-users-list">
              <div class="loading"><div class="spinner"></div><span>담당자 목록 로딩 중...</span></div>
            </div>
          </div>
        </div>
        ` : ''}
      `;

      // 탭 전환 함수 등록
      window.switchStudyTab = function(tabName) {
        // 모든 탭 버튼 비활성화
        document.querySelectorAll('#study-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
        // 모든 탭 콘텐츠 숨기기
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        // 선택된 탭 활성화
        document.querySelector(`#study-tabs .tab-btn[data-tab="${tabName}"]`)?.classList.add('active');
        document.getElementById(`tab-${tabName}`)?.classList.add('active');
        
        // 담당자 탭 선택 시 데이터 로드
        if (tabName === 'users' && ui.canManage()) {
          loadStudyUsers('${study.id}');
        }
      };

      // 담당자 목록 로드 (초기에는 sites 탭이 활성화되므로 바로 로드하지 않음)
      // 담당자 탭 클릭 시 로드됨
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>Study 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  // =====================================================
  // Study 사용자 관리 (DM/CRA 할당)
  // =====================================================

  const STUDY_ROLES = {
    SPONSOR_PM: '스폰서 PM',
    SPONSOR_DM: '스폰서 DM',
    SPONSOR_CRA: '스폰서 CRA',
    CRO_PM: 'CRO PM',
    CRO_DM: 'CRO DM',
    CRO_CRA: 'CRO CRA',
  };

  async function loadStudyUsers(studyId) {
    const container = document.getElementById('study-users-list');
    if (!container) return;

    try {
      const result = await api.get(`/studies/${studyId}/users`);
      const users = result.data || [];

      if (users.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 32px;">
            <i class="fas fa-user-tie" style="font-size: 32px; color: var(--text-muted);"></i>
            <h3 style="margin-top: 12px;">할당된 담당자가 없습니다</h3>
            <p style="color: var(--text-secondary); margin-bottom: 16px;">DM 또는 CRA를 이 Study에 할당해 주세요.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>담당자</th>
              <th>시스템 역할</th>
              <th>Study 내 역할</th>
              <th>주담당</th>
              <th>할당일</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="user-avatar" style="width: 32px; height: 32px; font-size: 12px;">${ui.getInitials(u.name)}</div>
                    <div>
                      <div style="font-weight: 500;">${u.name}</div>
                      <div style="font-size: 12px; color: var(--text-muted);">${u.email}</div>
                    </div>
                  </div>
                </td>
                <td><span class="badge badge-info">${ui.getRoleShort(u.system_role)}</span></td>
                <td>${STUDY_ROLES[u.role_in_study] || u.role_in_study}</td>
                <td>${u.is_primary ? '<i class="fas fa-star" style="color: var(--warning);"></i>' : '-'}</td>
                <td>${ui.formatDate(u.assigned_at)}</td>
                <td>${u.status === 'ACTIVE' ? '<span class="badge badge-active">활성</span>' : '<span class="badge badge-inactive">비활성</span>'}</td>
                <td>
                  <button class="btn btn-secondary btn-sm" onclick="showEditStudyUserModal('${studyId}', ${JSON.stringify(u).replace(/"/g, '&quot;')})" style="padding: 4px 8px;" title="수정">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="removeStudyUser('${studyId}', '${u.id}', '${u.name}')" style="padding: 4px 8px;" title="할당 해제">
                    <i class="fas fa-user-minus"></i>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><p>담당자 목록을 불러올 수 없습니다.</p></div>`;
    }
  }
  window.loadStudyUsers = loadStudyUsers;

  async function showAssignStudyUserModal(studyId) {
    // 할당 가능한 사용자 목록 조회
    try {
      const result = await api.get(`/studies/${studyId}/assignable-users`);
      const users = result.data || [];

      if (users.length === 0) {
        showToast('할당 가능한 DM/CRA 사용자가 없습니다. 먼저 사용자를 생성해 주세요.', 'warning');
        return;
      }

      showModal('Study 담당자 추가', `
        <div class="form-group">
          <label class="form-label">사용자 선택 <span class="required">*</span></label>
          <select class="form-input" id="assign-user-id">
            <option value="">-- 사용자 선택 --</option>
            ${users.map(u => `<option value="${u.id}">${u.name} (${u.email}) - ${ui.getRoleShort(u.role)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Study 내 역할 <span class="required">*</span></label>
          <select class="form-input" id="assign-role-in-study">
            <option value="">-- 역할 선택 --</option>
            ${Object.entries(STUDY_ROLES).map(([code, label]) => `<option value="${code}">${label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">
            <input type="checkbox" id="assign-is-primary" style="margin-right: 8px;">
            주담당자로 지정
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">메모</label>
          <textarea class="form-input" id="assign-notes" rows="2" placeholder="예: 2024년 1월부터 담당"></textarea>
        </div>
      `, [
        { label: '취소', onclick: 'closeModal()' },
        { label: '할당', primary: true, onclick: `assignStudyUser('${studyId}')` }
      ]);
    } catch (error) {
      showToast('할당 가능한 사용자 목록을 불러올 수 없습니다.', 'error');
    }
  }
  window.showAssignStudyUserModal = showAssignStudyUserModal;

  async function assignStudyUser(studyId) {
    const userId = document.getElementById('assign-user-id')?.value;
    const roleInStudy = document.getElementById('assign-role-in-study')?.value;
    const isPrimary = document.getElementById('assign-is-primary')?.checked;
    const notes = document.getElementById('assign-notes')?.value?.trim();

    if (!userId || !roleInStudy) {
      showToast('사용자와 역할을 선택해 주세요.', 'warning');
      return;
    }

    try {
      await api.post(`/studies/${studyId}/users`, {
        user_id: userId,
        role_in_study: roleInStudy,
        is_primary: isPrimary,
        notes: notes || null
      });
      closeModal();
      showToast('담당자가 할당되었습니다.', 'success');
      loadStudyUsers(studyId);
    } catch (error) {
      showToast(error.message || '담당자 할당에 실패했습니다.', 'error');
    }
  }
  window.assignStudyUser = assignStudyUser;

  function showEditStudyUserModal(studyId, user) {
    showModal('담당자 정보 수정', `
      <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
        <strong>${user.name}</strong> (${user.email})
      </div>
      <div class="form-group">
        <label class="form-label">Study 내 역할</label>
        <select class="form-input" id="edit-role-in-study">
          ${Object.entries(STUDY_ROLES).map(([code, label]) => 
            `<option value="${code}" ${user.role_in_study === code ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" id="edit-is-primary" style="margin-right: 8px;" ${user.is_primary ? 'checked' : ''}>
          주담당자로 지정
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">상태</label>
        <select class="form-input" id="edit-user-status">
          <option value="ACTIVE" ${user.status === 'ACTIVE' ? 'selected' : ''}>활성</option>
          <option value="INACTIVE" ${user.status === 'INACTIVE' ? 'selected' : ''}>비활성</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">메모</label>
        <textarea class="form-input" id="edit-user-notes" rows="2">${user.notes || ''}</textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateStudyUser('${studyId}', '${user.id}')` }
    ]);
  }
  window.showEditStudyUserModal = showEditStudyUserModal;

  async function updateStudyUser(studyId, studyUserId) {
    const roleInStudy = document.getElementById('edit-role-in-study')?.value;
    const isPrimary = document.getElementById('edit-is-primary')?.checked;
    const status = document.getElementById('edit-user-status')?.value;
    const notes = document.getElementById('edit-user-notes')?.value?.trim();

    try {
      await api.put(`/studies/${studyId}/users/${studyUserId}`, {
        role_in_study: roleInStudy,
        is_primary: isPrimary,
        status: status,
        notes: notes || null
      });
      closeModal();
      showToast('담당자 정보가 수정되었습니다.', 'success');
      loadStudyUsers(studyId);
    } catch (error) {
      showToast(error.message || '담당자 정보 수정에 실패했습니다.', 'error');
    }
  }
  window.updateStudyUser = updateStudyUser;

  async function removeStudyUser(studyId, studyUserId, userName) {
    if (!confirm(`${userName}님을 이 Study에서 제외하시겠습니까?\n\n제외 후에는 해당 사용자가 이 Study에 접근할 수 없습니다.`)) {
      return;
    }

    try {
      await api.delete(`/studies/${studyId}/users/${studyUserId}`);
      showToast('담당자 할당이 해제되었습니다.', 'success');
      loadStudyUsers(studyId);
    } catch (error) {
      showToast(error.message || '담당자 할당 해제에 실패했습니다.', 'error');
    }
  }
  window.removeStudyUser = removeStudyUser;

  // Study 잠금 모달
  function showLockStudyModal(studyId) {
    showModal('Study 잠금', `
      <div class="form-group">
        <p style="margin-bottom: 16px; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
          Study를 잠그면 모든 데이터 수정이 제한됩니다.
        </p>
        <label class="form-label">잠금 사유</label>
        <textarea class="form-input" id="lock-reason" rows="3" placeholder="예: 데이터베이스 잠금 - 최종 데이터 분석 준비"></textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '잠금', primary: true, onclick: `lockStudy('${studyId}')` }
    ]);
  }
  window.showLockStudyModal = showLockStudyModal;

  async function lockStudy(studyId) {
    const reason = document.getElementById('lock-reason')?.value?.trim();
    
    try {
      await api.post(`/studies/${studyId}/lock`, { reason });
      closeModal();
      showToast('Study가 잠금되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '잠금에 실패했습니다.', 'error');
    }
  }
  window.lockStudy = lockStudy;

  // Study 잠금 해제 모달
  function showUnlockStudyModal(studyId) {
    showModal('Study 잠금 해제', `
      <div class="form-group">
        <p style="margin-bottom: 16px; color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="color: var(--primary);"></i>
          잠금을 해제하면 데이터 수정이 다시 가능해집니다.
        </p>
        <label class="form-label">잠금 해제 사유 <span class="required">*</span></label>
        <textarea class="form-input" id="unlock-reason" rows="3" placeholder="최소 10자 이상 입력해주세요.&#10;예: 데이터 검토 결과 추가 수정 필요 - CRF 데이터 오류 발견"></textarea>
        <p style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">
          * 21 CFR Part 11 규정에 따라 잠금 해제 사유는 감사 추적에 기록됩니다.
        </p>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '잠금 해제', primary: true, onclick: `unlockStudy('${studyId}')` }
    ]);
  }
  window.showUnlockStudyModal = showUnlockStudyModal;

  async function unlockStudy(studyId) {
    const reason = document.getElementById('unlock-reason')?.value?.trim();
    
    if (!reason || reason.length < 10) {
      showToast('잠금 해제 사유는 최소 10자 이상 입력해야 합니다.', 'error');
      return;
    }
    
    try {
      await api.post(`/studies/${studyId}/unlock`, { reason });
      closeModal();
      showToast('Study 잠금이 해제되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '잠금 해제에 실패했습니다.', 'error');
    }
  }
  window.unlockStudy = unlockStudy;

  // =====================================================
  // VISIT SCHEDULE CRUD
  // =====================================================
  function showNewVisitScheduleModal(studyId) {
    // 기존 방문 일정에서 다음 방문 번호 계산
    const study = state.currentStudy;
    const existingSchedules = study?.visitSchedules || [];
    const maxVisitNumber = existingSchedules.length > 0 
      ? Math.max(...existingSchedules.map(vs => vs.visit_number)) 
      : 0;
    const nextVisitNumber = maxVisitNumber + 1;

    showModal('방문 일정 추가', `
      <div class="form-group">
        <label class="form-label">방문 번호 <span class="required">*</span></label>
        <input type="number" class="form-input" id="vs-visit-number" value="${nextVisitNumber}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">방문명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="vs-visit-name" placeholder="예: Screening, Week 1, End of Treatment">
      </div>
      <div class="form-group">
        <label class="form-label">예정일 (Day)</label>
        <input type="number" class="form-input" id="vs-target-day" value="0" min="0" placeholder="스크리닝 기준 일수">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">Window (-일)</label>
          <input type="number" class="form-input" id="vs-window-before" value="0" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Window (+일)</label>
          <input type="number" class="form-input" id="vs-window-after" value="0" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="vs-is-required" checked> 필수 방문
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">설명</label>
        <textarea class="form-input" id="vs-description" rows="2" placeholder="방문에 대한 설명"></textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', primary: true, onclick: `createVisitSchedule('${studyId}')` }
    ]);
  }
  window.showNewVisitScheduleModal = showNewVisitScheduleModal;

  async function createVisitSchedule(studyId) {
    const visitNumber = parseInt(document.getElementById('vs-visit-number')?.value);
    const visitName = document.getElementById('vs-visit-name')?.value?.trim();
    const targetDay = parseInt(document.getElementById('vs-target-day')?.value) || 0;
    const windowBefore = parseInt(document.getElementById('vs-window-before')?.value) || 0;
    const windowAfter = parseInt(document.getElementById('vs-window-after')?.value) || 0;
    const isRequired = document.getElementById('vs-is-required')?.checked ?? true;
    const description = document.getElementById('vs-description')?.value?.trim();

    if (!visitName || !visitNumber) {
      showToast('방문명과 방문 번호는 필수입니다.', 'error');
      return;
    }

    try {
      await api.post(`/studies/${studyId}/visit-schedules`, {
        visit_name: visitName,
        visit_number: visitNumber,
        target_day: targetDay,
        visit_window_before: windowBefore,
        visit_window_after: windowAfter,
        is_required: isRequired,
        description: description || null
      });
      closeModal();
      showToast('방문 일정이 추가되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '추가에 실패했습니다.', 'error');
    }
  }
  window.createVisitSchedule = createVisitSchedule;

  function showEditVisitScheduleModal(studyId, vsId) {
    const study = state.currentStudy;
    const vs = (study?.visitSchedules || []).find(v => v.id === vsId);
    if (!vs) return;

    showModal('방문 일정 수정', `
      <div class="form-group">
        <label class="form-label">방문 번호</label>
        <input type="number" class="form-input" value="${vs.visit_number}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">방문명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="vs-edit-visit-name" value="${vs.visit_name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">예정일 (Day)</label>
        <input type="number" class="form-input" id="vs-edit-target-day" value="${vs.target_day || 0}" min="0">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">Window (-일)</label>
          <input type="number" class="form-input" id="vs-edit-window-before" value="${vs.visit_window_before || 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Window (+일)</label>
          <input type="number" class="form-input" id="vs-edit-window-after" value="${vs.visit_window_after || 0}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="vs-edit-is-required" ${vs.is_required ? 'checked' : ''}> 필수 방문
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">설명</label>
        <textarea class="form-input" id="vs-edit-description" rows="2">${vs.description || ''}</textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateVisitSchedule('${studyId}', '${vsId}')` }
    ]);
  }
  window.showEditVisitScheduleModal = showEditVisitScheduleModal;

  async function updateVisitSchedule(studyId, vsId) {
    const visitName = document.getElementById('vs-edit-visit-name')?.value?.trim();
    const targetDay = parseInt(document.getElementById('vs-edit-target-day')?.value) || 0;
    const windowBefore = parseInt(document.getElementById('vs-edit-window-before')?.value) || 0;
    const windowAfter = parseInt(document.getElementById('vs-edit-window-after')?.value) || 0;
    const isRequired = document.getElementById('vs-edit-is-required')?.checked ?? true;
    const description = document.getElementById('vs-edit-description')?.value?.trim();

    if (!visitName) {
      showToast('방문명은 필수입니다.', 'error');
      return;
    }

    try {
      await api.put(`/studies/${studyId}/visit-schedules/${vsId}`, {
        visit_name: visitName,
        target_day: targetDay,
        visit_window_before: windowBefore,
        visit_window_after: windowAfter,
        is_required: isRequired,
        description: description || null
      });
      closeModal();
      showToast('방문 일정이 수정되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateVisitSchedule = updateVisitSchedule;

  async function deleteVisitSchedule(studyId, vsId) {
    const confirmed = await showConfirm('이 방문 일정을 삭제하시겠습니까?', {
      title: '방문 일정 삭제',
      confirmLabel: '삭제',
      danger: true
    });
    if (!confirmed) return;

    try {
      await api.delete(`/studies/${studyId}/visit-schedules/${vsId}`);
      showToast('방문 일정이 삭제되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '삭제에 실패했습니다.', 'error');
    }
  }
  window.deleteVisitSchedule = deleteVisitSchedule;

  // =====================================================
  // FORM DEFINITION (CRF 양식) CRUD
  // =====================================================
  function showNewFormDefinitionModal(studyId) {
    const study = state.currentStudy;
    const visitSchedules = study?.visitSchedules || [];
    const existingForms = study?.formDefinitions || [];
    const maxOrder = existingForms.length > 0 
      ? Math.max(...existingForms.map(f => f.form_order || 0)) 
      : 0;

    showModal('CRF 양식 추가', `
      <div class="form-group">
        <label class="form-label">양식 코드 <span class="required">*</span></label>
        <input type="text" class="form-input" id="form-code" placeholder="예: DM, VS, AE, CM" style="text-transform: uppercase;">
      </div>
      <div class="form-group">
        <label class="form-label">양식명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="form-name" placeholder="예: Demographics, Vital Signs">
      </div>
      <div class="form-group">
        <label class="form-label">적용 방문</label>
        <select class="form-input" id="form-visit-schedule">
          <option value="">전체 방문</option>
          ${visitSchedules.map(vs => `<option value="${vs.id}">V${vs.visit_number} - ${vs.visit_name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">표시 순서</label>
        <input type="number" class="form-input" id="form-order" value="${maxOrder + 1}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="form-is-required" checked> 필수 양식
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">설명</label>
        <textarea class="form-input" id="form-description" rows="2" placeholder="양식에 대한 설명"></textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', primary: true, onclick: `createFormDefinition('${studyId}')` }
    ]);
  }
  window.showNewFormDefinitionModal = showNewFormDefinitionModal;

  async function createFormDefinition(studyId) {
    const formCode = document.getElementById('form-code')?.value?.trim().toUpperCase();
    const formName = document.getElementById('form-name')?.value?.trim();
    const visitScheduleId = document.getElementById('form-visit-schedule')?.value || null;
    const formOrder = parseInt(document.getElementById('form-order')?.value) || 1;
    const isRequired = document.getElementById('form-is-required')?.checked ?? true;
    const description = document.getElementById('form-description')?.value?.trim();

    if (!formCode || !formName) {
      showToast('양식 코드와 양식명은 필수입니다.', 'error');
      return;
    }

    try {
      await api.post(`/studies/${studyId}/form-definitions`, {
        form_code: formCode,
        form_name: formName,
        visit_schedule_id: visitScheduleId,
        form_order: formOrder,
        is_required: isRequired,
        description: description || null
      });
      closeModal();
      showToast('CRF 양식이 추가되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '추가에 실패했습니다.', 'error');
    }
  }
  window.createFormDefinition = createFormDefinition;

  function showEditFormDefinitionModal(studyId, formId) {
    const study = state.currentStudy;
    const form = (study?.formDefinitions || []).find(f => f.id === formId);
    const visitSchedules = study?.visitSchedules || [];
    if (!form) return;

    showModal('CRF 양식 수정', `
      <div class="form-group">
        <label class="form-label">양식 코드</label>
        <input type="text" class="form-input" value="${form.form_code}" readonly style="background: var(--bg-tertiary);">
      </div>
      <div class="form-group">
        <label class="form-label">양식명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="form-edit-name" value="${form.form_name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">적용 방문</label>
        <select class="form-input" id="form-edit-visit-schedule">
          <option value="">전체 방문</option>
          ${visitSchedules.map(vs => `<option value="${vs.id}" ${form.visit_schedule_id === vs.id ? 'selected' : ''}>V${vs.visit_number} - ${vs.visit_name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">표시 순서</label>
        <input type="number" class="form-input" id="form-edit-order" value="${form.form_order || 1}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="form-edit-is-required" ${form.is_required ? 'checked' : ''}> 필수 양식
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">설명</label>
        <textarea class="form-input" id="form-edit-description" rows="2">${form.description || ''}</textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateFormDefinition('${studyId}', '${formId}')` }
    ]);
  }
  window.showEditFormDefinitionModal = showEditFormDefinitionModal;

  async function updateFormDefinition(studyId, formId) {
    const formName = document.getElementById('form-edit-name')?.value?.trim();
    const visitScheduleId = document.getElementById('form-edit-visit-schedule')?.value || null;
    const formOrder = parseInt(document.getElementById('form-edit-order')?.value) || 1;
    const isRequired = document.getElementById('form-edit-is-required')?.checked ?? true;
    const description = document.getElementById('form-edit-description')?.value?.trim();

    if (!formName) {
      showToast('양식명은 필수입니다.', 'error');
      return;
    }

    try {
      await api.put(`/studies/${studyId}/form-definitions/${formId}`, {
        form_name: formName,
        visit_schedule_id: visitScheduleId,
        form_order: formOrder,
        is_required: isRequired,
        description: description || null
      });
      closeModal();
      showToast('CRF 양식이 수정되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateFormDefinition = updateFormDefinition;

  async function deleteFormDefinition(studyId, formId) {
    const confirmed = await showConfirm('이 CRF 양식을 삭제하시겠습니까?\n삭제하면 관련된 모든 필드도 함께 삭제됩니다.', {
      title: 'CRF 양식 삭제',
      confirmLabel: '삭제',
      danger: true
    });
    if (!confirmed) return;

    try {
      await api.delete(`/studies/${studyId}/form-definitions/${formId}`);
      showToast('CRF 양식이 삭제되었습니다.', 'success');
      loadStudyDetail(studyId);
    } catch (error) {
      showToast(error.error || '삭제에 실패했습니다.', 'error');
    }
  }
  window.deleteFormDefinition = deleteFormDefinition;

  // =====================================================
  // FIELD DEFINITION (CRF 필드) 관리
  // =====================================================
  const FIELD_TYPES = [
    { value: 'TEXT', label: '텍스트' },
    { value: 'TEXTAREA', label: '긴 텍스트' },
    { value: 'NUMBER', label: '숫자' },
    { value: 'DATE', label: '날짜' },
    { value: 'DATETIME', label: '날짜/시간' },
    { value: 'TIME', label: '시간' },
    { value: 'SELECT', label: '드롭다운' },
    { value: 'RADIO', label: '라디오 버튼' },
    { value: 'CHECKBOX', label: '체크박스' },
    { value: 'CALCULATED', label: '계산 필드' }
  ];

  async function loadFormDefinitionDetail(studyId, formId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `<div class="loading"><div class="spinner"></div><span>양식 정보를 불러오는 중...</span></div>`;

    try {
      // Study 정보 로드
      if (!state.currentStudy || state.currentStudy.id !== studyId) {
        const studyResult = await api.get(`/studies/${studyId}`);
        state.currentStudy = studyResult.data;
      }
      const study = state.currentStudy;
      const form = (study.formDefinitions || []).find(f => f.id === formId);
      
      if (!form) {
        throw new Error('양식을 찾을 수 없습니다.');
      }

      // 필드 정의 로드
      const fieldsResult = await api.get(`/studies/${studyId}/form-definitions/${formId}/fields`);
      const fields = fieldsResult.data || [];

      state.currentForm = { ...form, fields };

      mainContent.innerHTML = `
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
              <div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <h1 style="font-size: 20px; font-weight: 600;">${form.form_code} - ${form.form_name}</h1>
                  ${form.is_required ? '<span class="badge badge-active">필수</span>' : '<span class="badge badge-draft">선택</span>'}
                </div>
                <p style="color: var(--text-secondary);">${form.description || '설명 없음'}</p>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-secondary btn-sm" onclick="navigateTo('study', {studyId: '${studyId}'})"><i class="fas fa-arrow-left"></i> 돌아가기</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">필드 목록 (${fields.length})</span>
            ${ui.canManage() && study.status !== 'LOCKED' ? `<button class="btn btn-primary btn-sm" onclick="showNewFieldModal('${studyId}', '${formId}')"><i class="fas fa-plus"></i> 필드 추가</button>` : ''}
          </div>
          <div class="card-body compact">
            ${fields.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-list-alt"></i>
                <h3>등록된 필드가 없습니다</h3>
                ${ui.canManage() && study.status !== 'LOCKED' ? `
                  <p style="color: var(--text-secondary); margin-bottom: 16px;">CRF 양식에 데이터 필드를 추가해 주세요</p>
                  <button class="btn btn-primary" onclick="showNewFieldModal('${studyId}', '${formId}')"><i class="fas fa-plus"></i> 필드 추가</button>
                ` : ''}
              </div>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:50px;">순서</th>
                    <th>필드 코드</th>
                    <th>필드명</th>
                    <th>타입</th>
                    <th>필수</th>
                    <th>검증</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${fields.map(field => `
                    <tr>
                      <td>${field.field_order || '-'}</td>
                      <td><strong>${field.field_code}</strong></td>
                      <td>${field.field_name}</td>
                      <td><span class="badge badge-draft">${FIELD_TYPES.find(t => t.value === field.field_type)?.label || field.field_type}</span></td>
                      <td>${field.is_required ? '<i class="fas fa-check" style="color: var(--success);"></i>' : '-'}</td>
                      <td style="font-size: 12px; color: var(--text-muted);">
                        ${field.min_value ? `Min: ${field.min_value}` : ''}
                        ${field.max_value ? `Max: ${field.max_value}` : ''}
                        ${field.options ? `${JSON.parse(field.options).length}개 옵션` : ''}
                      </td>
                      <td>
                        ${ui.canManage() && study.status !== 'LOCKED' ? `
                          <button class="btn btn-secondary btn-sm" onclick="showEditFieldModal('${studyId}', '${formId}', '${field.id}')" style="padding: 4px 8px;"><i class="fas fa-edit"></i></button>
                          <button class="btn btn-secondary btn-sm" onclick="deleteField('${studyId}', '${formId}', '${field.id}')" style="padding: 4px 8px;"><i class="fas fa-trash"></i></button>
                        ` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">양식 미리보기</span>
          </div>
          <div class="card-body">
            ${fields.length === 0 ? '<p style="color: var(--text-muted);">필드를 추가하면 미리보기가 표시됩니다.</p>' : `
              <div style="max-width: 600px;">
                ${fields.map(field => renderFieldPreview(field)).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>양식 로드 실패</h3><p style="color: var(--text-muted);">${error.message || '오류가 발생했습니다.'}</p><button class="btn btn-primary" style="margin-top: 16px;" onclick="history.back()">돌아가기</button></div>`;
    }
  }

  function renderFieldPreview(field) {
    const required = field.is_required ? '<span class="required">*</span>' : '';
    let input = '';
    
    switch (field.field_type) {
      case 'TEXT':
        input = `<input type="text" class="form-input" placeholder="${field.placeholder || ''}" disabled>`;
        break;
      case 'TEXTAREA':
        input = `<textarea class="form-input" rows="3" placeholder="${field.placeholder || ''}" disabled></textarea>`;
        break;
      case 'NUMBER':
        input = `<input type="number" class="form-input" min="${field.min_value || ''}" max="${field.max_value || ''}" placeholder="${field.placeholder || ''}" disabled>`;
        break;
      case 'DATE':
        input = `<input type="date" class="form-input" disabled>`;
        break;
      case 'DATETIME':
        input = `<input type="datetime-local" class="form-input" disabled>`;
        break;
      case 'TIME':
        input = `<input type="time" class="form-input" disabled>`;
        break;
      case 'SELECT':
        const selectOptions = field.options ? JSON.parse(field.options) : [];
        input = `<select class="form-input" disabled><option value="">선택하세요</option>${selectOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>`;
        break;
      case 'RADIO':
        const radioOptions = field.options ? JSON.parse(field.options) : [];
        input = `<div style="display: flex; flex-direction: column; gap: 8px;">${radioOptions.map(o => `<label style="display: flex; align-items: center; gap: 8px;"><input type="radio" name="${field.field_code}" disabled> ${o.label}</label>`).join('')}</div>`;
        break;
      case 'CHECKBOX':
        const checkOptions = field.options ? JSON.parse(field.options) : [];
        input = checkOptions.length > 0 
          ? `<div style="display: flex; flex-direction: column; gap: 8px;">${checkOptions.map(o => `<label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" disabled> ${o.label}</label>`).join('')}</div>`
          : `<label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" disabled> ${field.field_name}</label>`;
        break;
      case 'CALCULATED':
        input = `<input type="text" class="form-input" style="background: var(--bg-tertiary);" placeholder="자동 계산" disabled>`;
        break;
      default:
        input = `<input type="text" class="form-input" disabled>`;
    }

    return `
      <div class="form-group">
        <label class="form-label">${field.field_name} ${required}</label>
        ${input}
        ${field.help_text ? `<small style="color: var(--text-muted);">${field.help_text}</small>` : ''}
      </div>
    `;
  }

  // =====================================================
  // FIELD OPTIONS BUILDER (SELECT, RADIO, CHECKBOX)
  // =====================================================
  let fieldOptionsData = [];

  function showNewFieldModal(studyId, formId) {
    const form = state.currentForm;
    const existingFields = form?.fields || [];
    const maxOrder = existingFields.length > 0 
      ? Math.max(...existingFields.map(f => f.field_order || 0)) 
      : 0;

    // Reset options data
    fieldOptionsData = [];

    showModal('필드 추가', `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">필드 코드 <span class="required">*</span></label>
          <input type="text" class="form-input" id="field-code" placeholder="예: BRTHDTC, SEX" style="text-transform: uppercase;">
        </div>
        <div class="form-group">
          <label class="form-label">순서</label>
          <input type="number" class="form-input" id="field-order" value="${maxOrder + 1}" min="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">필드명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="field-name" placeholder="예: 생년월일, 성별">
      </div>
      <div class="form-group">
        <label class="form-label">데이터 타입 <span class="required">*</span></label>
        <select class="form-input" id="field-type" onchange="toggleFieldOptions()">
          ${FIELD_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
      </div>
      
      <!-- Options Builder for SELECT, RADIO, CHECKBOX -->
      <div id="field-options-container" style="display: none;">
        <div class="form-group">
          <label class="form-label">
            선택 옵션 
            <span style="font-weight: normal; color: var(--text-muted); font-size: 11px;">(최소 1개 이상)</span>
          </label>
          
          <!-- Options List -->
          <div id="options-list" style="margin-bottom: 12px;"></div>
          
          <!-- Add Option Form -->
          <div style="display: flex; gap: 8px; align-items: flex-end; padding: 12px; background: var(--bg-secondary); border-radius: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">값 (저장용)</label>
              <input type="text" class="form-input" id="new-option-value" placeholder="예: M, 1, YES" style="padding: 8px; font-size: 13px;">
            </div>
            <div style="flex: 2;">
              <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">라벨 (표시용)</label>
              <input type="text" class="form-input" id="new-option-label" placeholder="예: 남성, 예, 동의함" style="padding: 8px; font-size: 13px;" onkeypress="if(event.key==='Enter'){event.preventDefault();addFieldOption();}">
            </div>
            <button type="button" class="btn btn-primary btn-sm" onclick="addFieldOption()" style="height: 36px; padding: 0 12px;">
              <i class="fas fa-plus"></i> 추가
            </button>
          </div>
          
          <!-- Quick Templates -->
          <div style="margin-top: 12px;">
            <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 6px;">빠른 템플릿:</label>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('yesno')" style="font-size: 11px; padding: 4px 8px;">예/아니오</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('gender')" style="font-size: 11px; padding: 4px 8px;">성별</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('severity')" style="font-size: 11px; padding: 4px 8px;">심각도</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('frequency')" style="font-size: 11px; padding: 4px 8px;">빈도</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('agreement')" style="font-size: 11px; padding: 4px 8px;">동의 여부</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('race')" style="font-size: 11px; padding: 4px 8px;">인종</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Number Range -->
      <div id="field-number-container" style="display: none;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group">
            <label class="form-label">최소값</label>
            <input type="number" class="form-input" id="field-min" placeholder="예: 0">
          </div>
          <div class="form-group">
            <label class="form-label">최대값</label>
            <input type="number" class="form-input" id="field-max" placeholder="예: 300">
          </div>
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="field-required" checked> 필수 입력
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">도움말</label>
        <input type="text" class="form-input" id="field-help" placeholder="입력 도움말 (선택사항)">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', primary: true, onclick: `createField('${studyId}', '${formId}')` }
    ]);

    // 초기 타입에 따른 옵션 표시
    setTimeout(() => toggleFieldOptions(), 100);
  }
  window.showNewFieldModal = showNewFieldModal;

  function toggleFieldOptions() {
    const fieldType = document.getElementById('field-type')?.value;
    const optionsContainer = document.getElementById('field-options-container');
    const numberContainer = document.getElementById('field-number-container');
    
    if (optionsContainer) {
      const showOptions = ['SELECT', 'RADIO', 'CHECKBOX', 'MULTI_SELECT'].includes(fieldType);
      optionsContainer.style.display = showOptions ? 'block' : 'none';
      if (showOptions) {
        renderOptionsList();
      }
    }
    if (numberContainer) {
      numberContainer.style.display = fieldType === 'NUMBER' ? 'block' : 'none';
    }
  }
  window.toggleFieldOptions = toggleFieldOptions;

  function renderOptionsList() {
    const container = document.getElementById('options-list');
    if (!container) return;

    if (fieldOptionsData.length === 0) {
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--text-muted); background: var(--bg-tertiary); border-radius: 8px; border: 2px dashed var(--border);">
          <i class="fas fa-list-ul" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
          <span style="font-size: 13px;">아래에서 옵션을 추가하세요</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden;" id="options-sortable-list">
        ${fieldOptionsData.map((opt, idx) => `
          <div class="option-item" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: ${idx % 2 === 0 ? '#fff' : 'var(--bg-secondary)'}; border-bottom: 1px solid var(--border-light); transition: all 0.2s;" data-index="${idx}" draggable="true" ondragstart="handleOptionDragStart(event, ${idx})" ondragover="handleOptionDragOver(event)" ondrop="handleOptionDrop(event, ${idx})" ondragend="handleOptionDragEnd(event)">
            <span style="color: var(--text-muted); cursor: grab;" class="drag-handle" title="드래그하여 순서 변경">
              <i class="fas fa-grip-vertical"></i>
            </span>
            <span style="color: var(--text-muted); font-size: 11px; min-width: 20px;">${idx + 1}</span>
            <div style="flex: 1; display: flex; gap: 8px; align-items: center;">
              <code style="background: var(--bg-tertiary); padding: 2px 8px; border-radius: 4px; font-size: 12px; min-width: 60px; font-family: 'Monaco', 'Consolas', monospace;">${sanitizeHTML(opt.value)}</code>
              <span style="color: var(--text-secondary);">→</span>
              <span style="flex: 1; font-size: 13px;">${sanitizeHTML(opt.label)}</span>
            </div>
            <div style="display: flex; gap: 2px;">
              <button type="button" class="btn-icon" onclick="moveOptionUp(${idx})" title="위로 이동" ${idx === 0 ? 'disabled style="opacity: 0.3;"' : ''}>
                <i class="fas fa-chevron-up" style="font-size: 10px;"></i>
              </button>
              <button type="button" class="btn-icon" onclick="moveOptionDown(${idx})" title="아래로 이동" ${idx === fieldOptionsData.length - 1 ? 'disabled style="opacity: 0.3;"' : ''}>
                <i class="fas fa-chevron-down" style="font-size: 10px;"></i>
              </button>
              <button type="button" class="btn-icon" onclick="editFieldOption(${idx})" title="수정">
                <i class="fas fa-edit" style="font-size: 11px;"></i>
              </button>
              <button type="button" class="btn-icon" onclick="removeFieldOption(${idx})" title="삭제" style="color: var(--danger);">
                <i class="fas fa-trash" style="font-size: 11px;"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: var(--text-muted);">총 ${fieldOptionsData.length}개 옵션</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleOptionsPreview()" style="font-size: 11px; padding: 4px 8px;">
          <i class="fas fa-eye"></i> 미리보기
        </button>
      </div>
      <div id="options-preview-container" style="display: none; margin-top: 12px; padding: 16px; background: var(--bg-tertiary); border-radius: 8px; border: 1px dashed var(--border);"></div>
    `;
  }

  function addFieldOption() {
    const valueInput = document.getElementById('new-option-value');
    const labelInput = document.getElementById('new-option-label');
    
    const value = valueInput?.value?.trim();
    const label = labelInput?.value?.trim();
    
    if (!value) {
      showToast('값을 입력해주세요.', 'warning');
      valueInput?.focus();
      return;
    }
    
    // Check for duplicate value
    if (fieldOptionsData.some(opt => opt.value === value)) {
      showToast('이미 존재하는 값입니다.', 'warning');
      valueInput?.focus();
      return;
    }
    
    fieldOptionsData.push({
      value: value,
      label: label || value
    });
    
    // Clear inputs
    if (valueInput) valueInput.value = '';
    if (labelInput) labelInput.value = '';
    valueInput?.focus();
    
    renderOptionsList();
  }
  window.addFieldOption = addFieldOption;

  function removeFieldOption(index) {
    if (confirm('이 옵션을 삭제하시겠습니까?')) {
      fieldOptionsData.splice(index, 1);
      renderOptionsList();
      updateOptionsPreview();
    }
  }
  window.removeFieldOption = removeFieldOption;

  // 옵션 순서 이동 함수
  function moveOptionUp(index) {
    if (index <= 0) return;
    const temp = fieldOptionsData[index];
    fieldOptionsData[index] = fieldOptionsData[index - 1];
    fieldOptionsData[index - 1] = temp;
    renderOptionsList();
    updateOptionsPreview();
  }
  window.moveOptionUp = moveOptionUp;

  function moveOptionDown(index) {
    if (index >= fieldOptionsData.length - 1) return;
    const temp = fieldOptionsData[index];
    fieldOptionsData[index] = fieldOptionsData[index + 1];
    fieldOptionsData[index + 1] = temp;
    renderOptionsList();
    updateOptionsPreview();
  }
  window.moveOptionDown = moveOptionDown;

  // 드래그 앤 드롭 관련 함수
  let draggedOptionIndex = null;

  function handleOptionDragStart(event, index) {
    draggedOptionIndex = index;
    event.target.style.opacity = '0.5';
    event.dataTransfer.effectAllowed = 'move';
  }
  window.handleOptionDragStart = handleOptionDragStart;

  function handleOptionDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
  window.handleOptionDragOver = handleOptionDragOver;

  function handleOptionDrop(event, targetIndex) {
    event.preventDefault();
    if (draggedOptionIndex === null || draggedOptionIndex === targetIndex) return;
    
    const draggedItem = fieldOptionsData[draggedOptionIndex];
    fieldOptionsData.splice(draggedOptionIndex, 1);
    fieldOptionsData.splice(targetIndex, 0, draggedItem);
    
    renderOptionsList();
    updateOptionsPreview();
  }
  window.handleOptionDrop = handleOptionDrop;

  function handleOptionDragEnd(event) {
    event.target.style.opacity = '1';
    draggedOptionIndex = null;
  }
  window.handleOptionDragEnd = handleOptionDragEnd;

  // 미리보기 토글 및 업데이트
  function toggleOptionsPreview() {
    const container = document.getElementById('options-preview-container');
    if (!container) return;
    
    if (container.style.display === 'none') {
      container.style.display = 'block';
      updateOptionsPreview();
    } else {
      container.style.display = 'none';
    }
  }
  window.toggleOptionsPreview = toggleOptionsPreview;

  function updateOptionsPreview() {
    const container = document.getElementById('options-preview-container');
    if (!container || container.style.display === 'none') return;
    
    const fieldType = document.getElementById('field-type')?.value || document.getElementById('field-edit-type')?.value;
    const fieldName = document.getElementById('field-name')?.value || document.getElementById('field-edit-name')?.value || '필드명';
    
    if (fieldOptionsData.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">옵션을 추가하면 미리보기가 표시됩니다.</p>';
      return;
    }
    
    let previewHTML = `<label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 13px;">${sanitizeHTML(fieldName)}</label>`;
    
    if (fieldType === 'SELECT' || fieldType === 'MULTI_SELECT') {
      previewHTML += `
        <select class="form-input" style="max-width: 300px;" ${fieldType === 'MULTI_SELECT' ? 'multiple' : ''}>
          <option value="">-- 선택하세요 --</option>
          ${fieldOptionsData.map(opt => `<option value="${sanitizeHTML(opt.value)}">${sanitizeHTML(opt.label)}</option>`).join('')}
        </select>
      `;
    } else if (fieldType === 'RADIO') {
      previewHTML += `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${fieldOptionsData.map((opt, idx) => `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="radio" name="preview-radio" value="${sanitizeHTML(opt.value)}" ${idx === 0 ? 'checked' : ''}>
              <span>${sanitizeHTML(opt.label)}</span>
            </label>
          `).join('')}
        </div>
      `;
    } else if (fieldType === 'CHECKBOX') {
      previewHTML += `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${fieldOptionsData.map(opt => `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" value="${sanitizeHTML(opt.value)}">
              <span>${sanitizeHTML(opt.label)}</span>
            </label>
          `).join('')}
        </div>
      `;
    }
    
    container.innerHTML = previewHTML;
  }
  window.updateOptionsPreview = updateOptionsPreview;

  function editFieldOption(index) {
    const opt = fieldOptionsData[index];
    if (!opt) return;
    
    showModal('옵션 수정', `
      <div class="form-group">
        <label class="form-label">값 (저장용)</label>
        <input type="text" class="form-input" id="edit-option-value" value="${sanitizeHTML(opt.value)}">
      </div>
      <div class="form-group">
        <label class="form-label">라벨 (표시용)</label>
        <input type="text" class="form-input" id="edit-option-label" value="${sanitizeHTML(opt.label)}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal(); renderOptionsList();' },
      { label: '저장', primary: true, onclick: `saveEditedOption(${index})` }
    ]);
  }
  window.editFieldOption = editFieldOption;

  function saveEditedOption(index) {
    const value = document.getElementById('edit-option-value')?.value?.trim();
    const label = document.getElementById('edit-option-label')?.value?.trim();
    
    if (!value) {
      showToast('값을 입력해주세요.', 'warning');
      return;
    }
    
    // Check for duplicate value (except current)
    if (fieldOptionsData.some((opt, idx) => idx !== index && opt.value === value)) {
      showToast('이미 존재하는 값입니다.', 'warning');
      return;
    }
    
    fieldOptionsData[index] = { value, label: label || value };
    closeModal();
    
    // Re-show the field modal - this is a workaround
    showToast('옵션이 수정되었습니다.', 'success');
  }
  window.saveEditedOption = saveEditedOption;

  function applyOptionTemplate(template) {
    const templates = {
      yesno: [
        { value: 'Y', label: '예 (Yes)' },
        { value: 'N', label: '아니오 (No)' }
      ],
      gender: [
        { value: 'M', label: '남성 (Male)' },
        { value: 'F', label: '여성 (Female)' },
        { value: 'U', label: '알 수 없음 (Unknown)' }
      ],
      severity: [
        { value: 'MILD', label: '경미 (Mild)' },
        { value: 'MODERATE', label: '중등도 (Moderate)' },
        { value: 'SEVERE', label: '중증 (Severe)' },
        { value: 'LIFE_THREATENING', label: '생명 위협 (Life-threatening)' }
      ],
      frequency: [
        { value: 'NEVER', label: '없음 (Never)' },
        { value: 'RARELY', label: '드물게 (Rarely)' },
        { value: 'SOMETIMES', label: '가끔 (Sometimes)' },
        { value: 'OFTEN', label: '자주 (Often)' },
        { value: 'ALWAYS', label: '항상 (Always)' }
      ],
      agreement: [
        { value: 'AGREE', label: '동의함' },
        { value: 'DISAGREE', label: '동의하지 않음' },
        { value: 'WITHDRAWN', label: '철회' }
      ],
      race: [
        { value: 'ASIAN', label: '아시아인 (Asian)' },
        { value: 'BLACK', label: '흑인 (Black/African American)' },
        { value: 'WHITE', label: '백인 (White/Caucasian)' },
        { value: 'HISPANIC', label: '히스패닉 (Hispanic/Latino)' },
        { value: 'NATIVE', label: '원주민 (Native American)' },
        { value: 'PACIFIC', label: '태평양 섬 주민 (Pacific Islander)' },
        { value: 'MIXED', label: '혼혈 (Mixed Race)' },
        { value: 'OTHER', label: '기타 (Other)' },
        { value: 'UNKNOWN', label: '알 수 없음 (Unknown)' }
      ]
    };
    
    const templateData = templates[template];
    if (!templateData) return;
    
    // Confirm if existing options
    if (fieldOptionsData.length > 0) {
      if (!confirm('기존 옵션을 템플릿으로 대체하시겠습니까?')) {
        return;
      }
    }
    
    fieldOptionsData = [...templateData];
    renderOptionsList();
    showToast('템플릿이 적용되었습니다.', 'success');
  }
  window.applyOptionTemplate = applyOptionTemplate;

  async function createField(studyId, formId) {
    const fieldCode = document.getElementById('field-code')?.value?.trim().toUpperCase();
    const fieldName = document.getElementById('field-name')?.value?.trim();
    const fieldType = document.getElementById('field-type')?.value;
    const fieldOrder = parseInt(document.getElementById('field-order')?.value) || 1;
    const isRequired = document.getElementById('field-required')?.checked ?? true;
    const helpText = document.getElementById('field-help')?.value?.trim();
    const minValue = document.getElementById('field-min')?.value;
    const maxValue = document.getElementById('field-max')?.value;

    if (!fieldCode || !fieldName || !fieldType) {
      showToast('필드 코드, 필드명, 데이터 타입은 필수입니다.', 'error');
      return;
    }

    // 옵션 처리 - fieldOptionsData 배열 사용
    let options = null;
    if (['SELECT', 'RADIO', 'CHECKBOX', 'MULTI_SELECT'].includes(fieldType)) {
      if (fieldOptionsData.length === 0) {
        showToast('선택 옵션을 최소 1개 이상 추가해주세요.', 'error');
        return;
      }
      options = fieldOptionsData;
    }

    try {
      await api.post(`/studies/${studyId}/form-definitions/${formId}/fields`, {
        field_code: fieldCode,
        field_name: fieldName,
        field_type: fieldType,
        field_order: fieldOrder,
        is_required: isRequired,
        help_text: helpText || null,
        min_value: minValue || null,
        max_value: maxValue || null,
        options: options ? JSON.stringify(options) : null
      });
      closeModal();
      showToast('필드가 추가되었습니다.', 'success');
      loadFormDefinitionDetail(studyId, formId);
    } catch (error) {
      showToast(error.error || '추가에 실패했습니다.', 'error');
    }
  }
  window.createField = createField;

  function showEditFieldModal(studyId, formId, fieldId) {
    const form = state.currentForm;
    const field = (form?.fields || []).find(f => f.id === fieldId);
    if (!field) return;

    // 기존 옵션을 fieldOptionsData에 로드
    fieldOptionsData = [];
    if (field.options) {
      try {
        const opts = JSON.parse(field.options);
        if (Array.isArray(opts)) {
          fieldOptionsData = opts.map(o => ({ value: o.value, label: o.label }));
        }
      } catch (e) {}
    }

    const showOptions = ['SELECT', 'RADIO', 'CHECKBOX', 'MULTI_SELECT'].includes(field.field_type);

    showModal('필드 수정', `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">필드 코드</label>
          <input type="text" class="form-input" value="${field.field_code}" readonly style="background: var(--bg-tertiary);">
        </div>
        <div class="form-group">
          <label class="form-label">순서</label>
          <input type="number" class="form-input" id="field-edit-order" value="${field.field_order || 1}" min="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">필드명 <span class="required">*</span></label>
        <input type="text" class="form-input" id="field-edit-name" value="${field.field_name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">데이터 타입</label>
        <select class="form-input" id="field-edit-type" onchange="toggleEditFieldOptions()">
          ${FIELD_TYPES.map(t => `<option value="${t.value}" ${field.field_type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      
      <!-- Options Builder for SELECT, RADIO, CHECKBOX (same as new field modal) -->
      <div id="field-edit-options-container" style="display: ${showOptions ? 'block' : 'none'};">
        <div class="form-group">
          <label class="form-label">
            선택 옵션 
            <span style="font-weight: normal; color: var(--text-muted); font-size: 11px;">(최소 1개 이상)</span>
          </label>
          
          <!-- Options List -->
          <div id="options-list" style="margin-bottom: 12px;"></div>
          
          <!-- Add Option Form -->
          <div style="display: flex; gap: 8px; align-items: flex-end; padding: 12px; background: var(--bg-secondary); border-radius: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">값 (저장용)</label>
              <input type="text" class="form-input" id="new-option-value" placeholder="예: M, 1, YES" style="padding: 8px; font-size: 13px;">
            </div>
            <div style="flex: 2;">
              <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">라벨 (표시용)</label>
              <input type="text" class="form-input" id="new-option-label" placeholder="예: 남성, 예, 동의함" style="padding: 8px; font-size: 13px;" onkeypress="if(event.key==='Enter'){event.preventDefault();addFieldOption();}">
            </div>
            <button type="button" class="btn btn-primary btn-sm" onclick="addFieldOption()" style="height: 36px; padding: 0 12px;">
              <i class="fas fa-plus"></i> 추가
            </button>
          </div>
          
          <!-- Quick Templates -->
          <div style="margin-top: 12px;">
            <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 6px;">빠른 템플릿:</label>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('yesno')" style="font-size: 11px; padding: 4px 8px;">예/아니오</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('gender')" style="font-size: 11px; padding: 4px 8px;">성별</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('severity')" style="font-size: 11px; padding: 4px 8px;">심각도</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('frequency')" style="font-size: 11px; padding: 4px 8px;">빈도</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('agreement')" style="font-size: 11px; padding: 4px 8px;">동의 여부</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="applyOptionTemplate('race')" style="font-size: 11px; padding: 4px 8px;">인종</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Number Range -->
      <div id="field-edit-number-container" style="display: ${field.field_type === 'NUMBER' ? 'block' : 'none'};">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group">
            <label class="form-label">최소값</label>
            <input type="number" class="form-input" id="field-edit-min" value="${field.min_value || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">최대값</label>
            <input type="number" class="form-input" id="field-edit-max" value="${field.max_value || ''}">
          </div>
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="field-edit-required" ${field.is_required ? 'checked' : ''}> 필수 입력
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">도움말</label>
        <input type="text" class="form-input" id="field-edit-help" value="${field.help_text || ''}">
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '저장', primary: true, onclick: `updateField('${studyId}', '${formId}', '${fieldId}')` }
    ]);

    // 초기 옵션 렌더링
    setTimeout(() => {
      if (showOptions) {
        renderOptionsList();
      }
    }, 100);
  }
  window.showEditFieldModal = showEditFieldModal;

  function toggleEditFieldOptions() {
    const fieldType = document.getElementById('field-edit-type')?.value;
    const optionsContainer = document.getElementById('field-edit-options-container');
    const numberContainer = document.getElementById('field-edit-number-container');
    
    const showOptions = ['SELECT', 'RADIO', 'CHECKBOX', 'MULTI_SELECT'].includes(fieldType);
    
    if (optionsContainer) {
      optionsContainer.style.display = showOptions ? 'block' : 'none';
      if (showOptions) {
        renderOptionsList();
      }
    }
    if (numberContainer) {
      numberContainer.style.display = fieldType === 'NUMBER' ? 'block' : 'none';
    }
  }
  window.toggleEditFieldOptions = toggleEditFieldOptions;

  async function updateField(studyId, formId, fieldId) {
    const fieldName = document.getElementById('field-edit-name')?.value?.trim();
    const fieldType = document.getElementById('field-edit-type')?.value;
    const fieldOrder = parseInt(document.getElementById('field-edit-order')?.value) || 1;
    const isRequired = document.getElementById('field-edit-required')?.checked ?? true;
    const helpText = document.getElementById('field-edit-help')?.value?.trim();
    const minValue = document.getElementById('field-edit-min')?.value;
    const maxValue = document.getElementById('field-edit-max')?.value;

    if (!fieldName) {
      showToast('필드명은 필수입니다.', 'error');
      return;
    }

    // 옵션 처리 - fieldOptionsData 배열 사용 (새 필드 추가와 동일)
    let options = null;
    if (['SELECT', 'RADIO', 'CHECKBOX', 'MULTI_SELECT'].includes(fieldType)) {
      if (fieldOptionsData.length === 0) {
        showToast('선택 옵션을 최소 1개 이상 추가해주세요.', 'error');
        return;
      }
      options = fieldOptionsData;
    }

    try {
      await api.put(`/studies/${studyId}/form-definitions/${formId}/fields/${fieldId}`, {
        field_name: fieldName,
        field_type: fieldType,
        field_order: fieldOrder,
        is_required: isRequired,
        help_text: helpText || null,
        min_value: minValue || null,
        max_value: maxValue || null,
        options: options ? JSON.stringify(options) : null
      });
      closeModal();
      showToast('필드가 수정되었습니다.', 'success');
      loadFormDefinitionDetail(studyId, formId);
    } catch (error) {
      showToast(error.error || '수정에 실패했습니다.', 'error');
    }
  }
  window.updateField = updateField;

  async function deleteField(studyId, formId, fieldId) {
    if (!confirm('이 필드를 삭제하시겠습니까?')) return;

    try {
      await api.delete(`/studies/${studyId}/form-definitions/${formId}/fields/${fieldId}`);
      showToast('필드가 삭제되었습니다.', 'success');
      loadFormDefinitionDetail(studyId, formId);
    } catch (error) {
      showToast(error.error || '삭제에 실패했습니다.', 'error');
    }
  }
  window.deleteField = deleteField;

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
            <div id="subjects-table-${siteId}"></div>
          </div>
        </div>

        ${ui.canManage() ? `
        <div class="card" id="site-users-section">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-user-md"></i> Site 담당자 관리 (PI/CRC)</span>
            <button class="btn btn-primary btn-sm" onclick="showAssignSiteUserModal('${site.id}')"><i class="fas fa-user-plus"></i> 담당자 추가</button>
          </div>
          <div class="card-body compact" id="site-users-list">
            <div class="loading"><div class="spinner"></div><span>담당자 목록 로딩 중...</span></div>
          </div>
        </div>
        ` : ''}
      `;

      // Site 담당자 목록 로드
      if (ui.canManage()) {
        loadSiteUsers(siteId);
      }

      // Initialize DataTable for subjects if there are subjects
      if (subjects.length > 0) {
        setTimeout(() => {
          DataTable.create(`subjects-table-${siteId}`, {
            data: subjects,
            columns: [
              { field: 'subject_number', header: 'Subject ID', sortable: true,
                render: (val) => `<strong>${sanitizeHTML(val)}</strong>` },
              { field: 'screening_number', header: 'Screening #', sortable: true },
              { field: 'initials', header: '이니셜', sortable: true },
              { field: 'status', header: '상태', sortable: true, filterable: true, type: 'badge' },
              { field: 'screening_date', header: '등록일', sortable: true, type: 'date' }
            ],
            emptyMessage: '등록된 피험자가 없습니다',
            pageSize: 10,
            actionColumn: () => `<i class="fas fa-chevron-right" style="color: var(--text-muted);"></i>`
          });
          // Attach click handlers
          const tableContainer = document.getElementById(`subjects-table-${siteId}`);
          if (tableContainer) {
            tableContainer.querySelectorAll('tbody tr').forEach((tr, idx) => {
              const pagedData = DataTable.getPagedData(`subjects-table-${siteId}`);
              if (pagedData[idx]) {
                tr.style.cursor = 'pointer';
                tr.onclick = () => navigateTo('subject', { subjectId: pagedData[idx].id });
              }
            });
          }
        }, 0);
      } else {
        const tableContainer = document.getElementById(`subjects-table-${siteId}`);
        if (tableContainer) {
          tableContainer.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><h3>등록된 피험자가 없습니다</h3>${ui.canWrite() && site.status === 'ACTIVE' ? `<p style="color: var(--text-secondary); margin-bottom: 16px;">새로운 피험자를 등록해 주세요</p><button class="btn btn-primary" onclick="showNewSubjectModal('${site.id}')"><i class="fas fa-user-plus"></i> 피험자 등록</button>` : '<p style="color: var(--text-secondary);">피험자를 등록하려면 ACTIVE 상태의 기관이 필요합니다</p>'}</div>`;
        }
      }
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>Site 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }

  // =====================================================
  // Site 사용자 관리 (PI/SUB_INV/CRC 할당)
  // =====================================================

  async function loadSiteUsers(siteId) {
    const container = document.getElementById('site-users-list');
    if (!container) return;

    try {
      const result = await api.get(`/sites/${siteId}/users`);
      const users = result.data || [];

      if (users.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 32px;">
            <i class="fas fa-user-md" style="font-size: 32px; color: var(--text-muted);"></i>
            <h3 style="margin-top: 12px;">할당된 담당자가 없습니다</h3>
            <p style="color: var(--text-secondary); margin-bottom: 16px;">PI, Sub-Investigator, CRC를 이 Site에 할당해 주세요.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>담당자</th>
              <th>역할</th>
              <th>주담당</th>
              <th>할당일</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="user-avatar" style="width: 32px; height: 32px; font-size: 12px;">${ui.getInitials(u.name)}</div>
                    <div>
                      <div style="font-weight: 500;">${u.name}</div>
                      <div style="font-size: 12px; color: var(--text-muted);">${u.email}</div>
                    </div>
                  </div>
                </td>
                <td><span class="badge badge-${u.role === 'PI' ? 'active' : u.role === 'SUB_INV' ? 'info' : 'draft'}">${ui.getRoleName(u.role)}</span></td>
                <td>${u.is_primary ? '<i class="fas fa-star" style="color: var(--warning);"></i>' : '-'}</td>
                <td>${ui.formatDate(u.assigned_at)}</td>
                <td>${u.user_status === 'ACTIVE' ? '<span class="badge badge-active">활성</span>' : '<span class="badge badge-inactive">비활성</span>'}</td>
                <td>
                  <button class="btn btn-secondary btn-sm" onclick="toggleSiteUserPrimary('${siteId}', '${u.id}', ${!u.is_primary})" style="padding: 4px 8px;" title="${u.is_primary ? '주담당 해제' : '주담당 지정'}">
                    <i class="fas fa-star${u.is_primary ? '' : '-half-alt'}"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="removeSiteUser('${siteId}', '${u.user_id}', '${u.name}')" style="padding: 4px 8px;" title="할당 해제">
                    <i class="fas fa-user-minus"></i>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><p>담당자 목록을 불러올 수 없습니다.</p></div>`;
    }
  }
  window.loadSiteUsers = loadSiteUsers;

  async function showAssignSiteUserModal(siteId) {
    try {
      const result = await api.get(`/sites/${siteId}/assignable-users`);
      const users = result.data || [];

      if (users.length === 0) {
        showToast('할당 가능한 PI/CRC 사용자가 없습니다. 먼저 사용자를 생성해 주세요.', 'warning');
        return;
      }

      showModal('Site 담당자 추가', `
        <div class="form-group">
          <label class="form-label">사용자 선택 <span class="required">*</span></label>
          <select class="form-input" id="assign-site-user-id">
            <option value="">-- 사용자 선택 --</option>
            ${users.map(u => `<option value="${u.id}">${u.name} (${u.email}) - ${ui.getRoleName(u.role)}</option>`).join('')}
          </select>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            <i class="fas fa-info-circle"></i> PI, Sub-Investigator, CRC 역할의 사용자만 Site에 할당할 수 있습니다.
          </p>
        </div>
        <div class="form-group">
          <label class="form-label">
            <input type="checkbox" id="assign-site-is-primary" style="margin-right: 8px;">
            주담당자로 지정 (PI의 경우 권장)
          </label>
        </div>
      `, [
        { label: '취소', onclick: 'closeModal()' },
        { label: '할당', primary: true, onclick: `assignSiteUser('${siteId}')` }
      ]);
    } catch (error) {
      showToast('할당 가능한 사용자 목록을 불러올 수 없습니다.', 'error');
    }
  }
  window.showAssignSiteUserModal = showAssignSiteUserModal;

  async function assignSiteUser(siteId) {
    const userId = document.getElementById('assign-site-user-id')?.value;
    const isPrimary = document.getElementById('assign-site-is-primary')?.checked;

    if (!userId) {
      showToast('사용자를 선택해 주세요.', 'warning');
      return;
    }

    try {
      await api.post(`/sites/${siteId}/users`, {
        user_id: userId,
        is_primary: isPrimary
      });
      closeModal();
      showToast('담당자가 할당되었습니다.', 'success');
      loadSiteUsers(siteId);
    } catch (error) {
      showToast(error.message || '담당자 할당에 실패했습니다.', 'error');
    }
  }
  window.assignSiteUser = assignSiteUser;

  async function toggleSiteUserPrimary(siteId, siteUserId, isPrimary) {
    try {
      await api.put(`/sites/${siteId}/users/${siteUserId}`, { is_primary: isPrimary });
      showToast(isPrimary ? '주담당자로 지정되었습니다.' : '주담당 지정이 해제되었습니다.', 'success');
      loadSiteUsers(siteId);
    } catch (error) {
      showToast(error.message || '변경에 실패했습니다.', 'error');
    }
  }
  window.toggleSiteUserPrimary = toggleSiteUserPrimary;

  async function removeSiteUser(siteId, userId, userName) {
    if (!confirm(`${userName}님을 이 Site에서 제외하시겠습니까?\n\n제외 후에는 해당 사용자가 이 Site의 데이터에 접근할 수 없습니다.`)) {
      return;
    }

    try {
      await api.delete(`/sites/${siteId}/users/${userId}`);
      showToast('담당자 할당이 해제되었습니다.', 'success');
      loadSiteUsers(siteId);
    } catch (error) {
      showToast(error.message || '담당자 할당 해제에 실패했습니다.', 'error');
    }
  }
  window.removeSiteUser = removeSiteUser;

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
          <option value="PENDING" ${site.status === 'PENDING' ? 'selected' : ''}>대기중</option>
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
    const confirmed = await showConfirm('이 피험자를 등록하시겠습니까?\n등록 후에는 스크리닝 상태로 되돌릴 수 없습니다.', {
      title: '피험자 등록',
      confirmLabel: '등록'
    });
    if (!confirmed) return;
    
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
      const crfInstances = visit.crfInstances || [];
      const availableForms = visit.availableForms || [];

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
            <span class="card-title">CRF 양식 (${crfInstances.length}/${availableForms.length})</span>
          </div>
          <div class="card-body">
            ${availableForms.length === 0 ? `
              <div class="empty-state"><i class="fas fa-file-alt"></i><h3>사용 가능한 CRF 양식이 없습니다</h3><p style="color: var(--text-muted);">Study에서 CRF 양식을 먼저 정의해 주세요.</p></div>
            ` : `
              <div style="display: grid; gap: 12px;">
                ${availableForms.map(form => {
                  const instance = crfInstances.find(c => c.form_code === form.form_code);
                  const hasData = instance && instance.data && instance.data.length > 0;
                  return `
                  <div style="border: 1px solid var(--border); border-radius: 8px; padding: 16px; ${instance ? 'background: var(--bg-secondary);' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                          <strong>${form.form_code}</strong> - ${form.form_name}
                          ${form.is_required ? '<span class="badge badge-active" style="font-size: 10px;">필수</span>' : ''}
                          ${instance ? getStatusBadge(instance.status) : '<span class="badge badge-draft">미입력</span>'}
                        </div>
                        ${instance ? `
                          <div style="font-size: 12px; color: var(--text-muted);">
                            입력: ${instance.data_entry_by ? ui.formatDateTime(instance.data_entry_at) : '-'} 
                            ${instance.signed_at ? `| 서명: ${ui.formatDateTime(instance.signed_at)}` : ''}
                          </div>
                        ` : `<div style="font-size: 12px; color: var(--text-muted);">아직 데이터가 입력되지 않았습니다.</div>`}
                      </div>
                      <div style="display: flex; gap: 8px;">
                        ${ui.canWrite() && !['COMPLETED', 'MISSED', 'NOT_DONE'].includes(visit.status) && instance?.status !== 'SIGNED' ? `
                          ${instance 
                            ? `<button class="btn btn-secondary btn-sm" onclick="openCRFEntry('${visitId}', '${form.form_code}', '${instance.id}')"><i class="fas fa-edit"></i> 수정</button>`
                            : `<button class="btn btn-primary btn-sm" onclick="openCRFEntry('${visitId}', '${form.form_code}', null)"><i class="fas fa-plus"></i> 입력</button>`
                          }
                        ` : ''}
                        ${instance?.status === 'COMPLETE' && ui.canSign() ? `
                          <button class="btn btn-success btn-sm" onclick="showSignCRFModal('${instance.id}', '${form.form_code}')">
                            <i class="fas fa-signature"></i> 서명
                          </button>
                        ` : ''}
                        ${instance ? `<button class="btn btn-secondary btn-sm" onclick="viewCRFData('${instance.id}')"><i class="fas fa-eye"></i></button>` : ''}
                      </div>
                    </div>
                  </div>
                `}).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    } catch (error) {
      mainContent.innerHTML = `<div class="empty-state" style="margin-top: 40px;"><i class="fas fa-exclamation-circle" style="color: var(--danger);"></i><h3>방문 정보 로드 실패</h3><button class="btn btn-primary" style="margin-top: 16px;" onclick="navigateTo('dashboard')">대시보드로 돌아가기</button></div>`;
    }
  }
  window.loadVisitDetail = loadVisitDetail;

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
      await api.put(`/visits/${visitId}`, { status: 'COMPLETED' });
      showToast('방문이 완료되었습니다.', 'success');
      loadVisitDetail(visitId);
    } catch (error) {
      showToast('완료 처리에 실패했습니다.', 'error');
    }
  }
  window.completeVisit = completeVisit;

  // =====================================================
  // CRF 전자서명 (PI 주담당자만 가능)
  // =====================================================
  function showSignCRFModal(crfInstanceId, formCode) {
    const isPrimaryPI = state.user?.role === 'PI';
    
    showModal('CRF 전자서명', `
      <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <i class="fas fa-signature" style="color: var(--primary); font-size: 20px;"></i>
          <strong>전자서명 확인</strong>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">
          본인은 책임연구자로서 이 CRF 데이터가 프로토콜에 따라 정확하게 수집되었음을 승인합니다.
        </p>
      </div>
      
      ${isPrimaryPI ? `
        <div style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #ffc107;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-info-circle" style="color: #856404;"></i>
            <span style="font-size: 13px; color: #856404;">
              <strong>주담당 PI</strong>만 CRF 최종 서명이 가능합니다.
            </span>
          </div>
        </div>
      ` : ''}
      
      <div class="form-group">
        <label class="form-label">CRF 양식</label>
        <input type="text" class="form-input" value="${formCode}" readonly style="background: var(--bg-tertiary);">
      </div>
      
      <div class="form-group">
        <label class="form-label">비밀번호 확인 <span class="required">*</span></label>
        <input type="password" class="form-input" id="sign-password" placeholder="계정 비밀번호를 입력하세요" autocomplete="current-password">
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          <i class="fas fa-shield-alt"></i> 21 CFR Part 11 준수를 위한 전자서명 인증
        </p>
      </div>
      
      <div class="form-group">
        <label class="form-label">서명 사유 (선택)</label>
        <textarea class="form-input" id="sign-reason" rows="2" placeholder="예: 데이터 검토 완료"></textarea>
      </div>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '서명 완료', primary: true, onclick: `signCRF('${crfInstanceId}')` }
    ]);
    
    // 비밀번호 입력 필드에 포커스
    setTimeout(() => document.getElementById('sign-password')?.focus(), 100);
  }
  window.showSignCRFModal = showSignCRFModal;

  async function signCRF(crfInstanceId) {
    const password = document.getElementById('sign-password')?.value;
    const signatureReason = document.getElementById('sign-reason')?.value?.trim();

    if (!password) {
      showToast('비밀번호를 입력해주세요.', 'warning');
      return;
    }

    try {
      const result = await api.post(`/signatures/crf/${crfInstanceId}`, {
        password,
        signature_reason: signatureReason || null
      });

      closeModal();
      showToast('CRF가 서명되었습니다.', 'success');
      
      // 현재 Visit 상세 화면 새로고침
      if (state.currentVisit?.id) {
        loadVisitDetail(state.currentVisit.id);
      }
    } catch (error) {
      showToast(error.message || error.error || 'CRF 서명에 실패했습니다.', 'error');
    }
  }
  window.signCRF = signCRF;

  // CRF 입력/수정
  async function openCRFEntry(visitId, formCode, crfInstanceId) {
    const visit = state.currentVisit;
    const study = state.currentStudy;
    
    // Form Definition 및 필드 로드
    const formDef = (visit?.availableForms || []).find(f => f.form_code === formCode);
    if (!formDef) {
      showToast('양식을 찾을 수 없습니다.', 'error');
      return;
    }

    try {
      // 필드 정의 로드
      const fieldsResult = await api.get(`/studies/${study.id}/form-definitions/${formDef.id}/fields`);
      const fields = fieldsResult.data || [];

      if (fields.length === 0) {
        showToast('양식에 필드가 정의되지 않았습니다.', 'error');
        return;
      }

      // 기존 데이터 로드 (수정 모드)
      let existingData = {};
      if (crfInstanceId) {
        const instance = (visit.crfInstances || []).find(c => c.id === crfInstanceId);
        if (instance && instance.data) {
          instance.data.forEach(d => {
            existingData[d.field_code] = d.field_value;
          });
        }
      }

      // Store fields for validation
      window.currentCRFFields = fields;
      
      // Calculate required fields count
      const requiredFields = fields.filter(f => f.is_required);
      const totalRequired = requiredFields.length;
      
      // 모달 내용 생성
      const fieldsHtml = fields.map(field => renderCRFFieldInput(field, existingData[field.field_code])).join('');

      showModal(`${formDef.form_code} - ${formDef.form_name}`, `
        <!-- Auto-save indicator -->
        <div id="crf-save-indicator" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-secondary); border-radius: 6px; margin-bottom: 16px; font-size: 13px;">
          <span id="save-status-icon"><i class="fas fa-cloud" style="color: var(--text-muted);"></i></span>
          <span id="save-status-text" style="color: var(--text-muted);">준비됨</span>
          <span style="flex: 1;"></span>
          <span style="font-size: 11px; color: var(--text-muted);">Ctrl+S 저장 | Tab 다음 필드</span>
        </div>
        
        <!-- Progress bar -->
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-size: 12px; color: var(--text-secondary);">필수 필드 완료율</span>
            <span id="crf-progress-text" style="font-size: 12px; font-weight: 600; color: var(--primary);">0/${totalRequired}</span>
          </div>
          <div style="height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
            <div id="crf-progress-bar" style="height: 100%; background: var(--primary); border-radius: 3px; transition: width 0.3s ease; width: 0%;"></div>
          </div>
        </div>
        
        <form id="crf-entry-form" onsubmit="event.preventDefault(); saveCRFData();">
          <input type="hidden" id="crf-visit-id" value="${visitId}">
          <input type="hidden" id="crf-form-code" value="${formCode}">
          <input type="hidden" id="crf-instance-id" value="${crfInstanceId || ''}">
          <input type="hidden" id="crf-total-required" value="${totalRequired}">
          ${fieldsHtml}
        </form>
      `, [
        { label: '취소', onclick: 'closeModal()' },
        { label: '저장', primary: true, onclick: 'saveCRFData()' }
      ]);

      // Initialize CRF form features after modal is shown
      setTimeout(() => {
        initCRFFormFeatures();
        updateCRFProgress();
      }, 100);
    } catch (error) {
      showToast('양식 로드에 실패했습니다.', 'error');
    }
  }
  window.openCRFEntry = openCRFEntry;

  // =====================================================
  // CRF FORM ENHANCED FEATURES
  // =====================================================
  let crfAutoSaveTimer = null;
  let crfSaveStatus = 'ready'; // ready, saving, saved, error
  
  function initCRFFormFeatures() {
    const form = document.getElementById('crf-entry-form');
    if (!form) return;

    // Add input event listeners for auto-save and validation
    form.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.type === 'hidden') return;
      
      // Real-time validation on blur
      input.addEventListener('blur', () => validateCRFField(input));
      
      // Progress update on change
      input.addEventListener('change', () => {
        updateCRFProgress();
        scheduleCRFAutoSave();
      });
      
      // For text inputs, also listen to input event
      if (['text', 'number', 'textarea'].includes(input.type) || input.tagName === 'TEXTAREA') {
        input.addEventListener('input', debounce(() => {
          updateCRFProgress();
          scheduleCRFAutoSave();
        }, 500));
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleCRFKeyboard);
  }

  function handleCRFKeyboard(e) {
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      const form = document.getElementById('crf-entry-form');
      if (form) {
        saveCRFData();
      }
    }
    
    // Enter to move to next field (except textarea)
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const form = document.getElementById('crf-entry-form');
      if (!form) return;
      
      const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]), select, textarea'));
      const currentIndex = inputs.indexOf(e.target);
      if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
        inputs[currentIndex + 1].focus();
      }
    }
  }

  function validateCRFField(input) {
    const fieldCode = input.name;
    const field = (window.currentCRFFields || []).find(f => f.field_code === fieldCode);
    if (!field) return true;

    const value = getInputValue(input);
    const errorContainer = input.closest('.form-group')?.querySelector('.field-error');
    let isValid = true;
    let errorMessage = '';

    // Required validation
    if (field.is_required && !value) {
      isValid = false;
      errorMessage = '필수 입력 항목입니다.';
    }

    // Number range validation
    if (isValid && field.field_type === 'NUMBER' && value) {
      const numValue = parseFloat(value);
      if (field.min_value !== null && field.min_value !== '' && numValue < parseFloat(field.min_value)) {
        isValid = false;
        errorMessage = `최소값은 ${field.min_value}입니다.`;
      }
      if (field.max_value !== null && field.max_value !== '' && numValue > parseFloat(field.max_value)) {
        isValid = false;
        errorMessage = `최대값은 ${field.max_value}입니다.`;
      }
    }

    // Update UI
    if (errorContainer) {
      errorContainer.textContent = errorMessage;
      errorContainer.style.display = isValid ? 'none' : 'block';
    }
    
    input.style.borderColor = isValid ? '' : 'var(--danger)';
    input.classList.toggle('field-invalid', !isValid);

    return isValid;
  }

  function getInputValue(input) {
    if (input.type === 'checkbox') {
      const form = input.closest('form');
      const checkboxes = form?.querySelectorAll(`input[name="${input.name}"][type="checkbox"]`);
      if (checkboxes && checkboxes.length > 1) {
        return Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value).join(',');
      }
      return input.checked ? input.value : '';
    }
    if (input.type === 'radio') {
      const form = input.closest('form');
      const checked = form?.querySelector(`input[name="${input.name}"]:checked`);
      return checked ? checked.value : '';
    }
    return input.value?.trim() || '';
  }

  function updateCRFProgress() {
    const form = document.getElementById('crf-entry-form');
    const progressBar = document.getElementById('crf-progress-bar');
    const progressText = document.getElementById('crf-progress-text');
    const totalRequired = parseInt(document.getElementById('crf-total-required')?.value || '0');
    
    if (!form || !progressBar || !progressText) return;

    const fields = window.currentCRFFields || [];
    const requiredFields = fields.filter(f => f.is_required);
    
    let filledCount = 0;
    requiredFields.forEach(field => {
      const input = form.querySelector(`[name="${field.field_code}"]`);
      if (input && getInputValue(input)) {
        filledCount++;
      }
    });

    const percentage = totalRequired > 0 ? Math.round((filledCount / totalRequired) * 100) : 100;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${filledCount}/${totalRequired}`;
    
    // Color based on completion
    if (percentage === 100) {
      progressBar.style.background = 'var(--success)';
    } else if (percentage >= 50) {
      progressBar.style.background = 'var(--primary)';
    } else {
      progressBar.style.background = 'var(--warning)';
    }
  }

  function scheduleCRFAutoSave() {
    if (crfAutoSaveTimer) {
      clearTimeout(crfAutoSaveTimer);
    }
    
    updateSaveIndicator('pending');
    
    crfAutoSaveTimer = setTimeout(() => {
      autoSaveCRFData();
    }, 2000); // Auto-save after 2 seconds of inactivity
  }

  async function autoSaveCRFData() {
    const form = document.getElementById('crf-entry-form');
    if (!form) return;
    
    updateSaveIndicator('saving');
    
    const visitId = document.getElementById('crf-visit-id')?.value;
    const formCode = document.getElementById('crf-form-code')?.value;
    
    if (!visitId || !formCode) {
      updateSaveIndicator('error');
      return;
    }

    // Collect form data
    const formData = new FormData(form);
    const data = {};
    const checkboxGroups = {};
    
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!checkboxGroups[cb.name]) checkboxGroups[cb.name] = [];
      if (cb.checked) checkboxGroups[cb.name].push(cb.value);
    });

    formData.forEach((value, key) => {
      if (!checkboxGroups[key]) {
        data[key] = value;
      }
    });

    Object.keys(checkboxGroups).forEach(key => {
      data[key] = checkboxGroups[key].join(',');
    });

    try {
      await api.post(`/visits/${visitId}/crf`, {
        form_code: formCode,
        data: data,
        auto_save: true
      });
      updateSaveIndicator('saved');
    } catch (error) {
      updateSaveIndicator('error');
      console.error('Auto-save failed:', error);
    }
  }

  function updateSaveIndicator(status) {
    const icon = document.getElementById('save-status-icon');
    const text = document.getElementById('save-status-text');
    if (!icon || !text) return;

    crfSaveStatus = status;
    
    switch (status) {
      case 'pending':
        icon.innerHTML = '<i class="fas fa-circle" style="color: var(--warning); font-size: 8px;"></i>';
        text.textContent = '변경사항 있음';
        text.style.color = 'var(--warning)';
        break;
      case 'saving':
        icon.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: var(--primary);"></i>';
        text.textContent = '저장 중...';
        text.style.color = 'var(--primary)';
        break;
      case 'saved':
        icon.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success);"></i>';
        text.textContent = '저장됨';
        text.style.color = 'var(--success)';
        // Reset to ready after 3 seconds
        setTimeout(() => {
          if (crfSaveStatus === 'saved') {
            updateSaveIndicator('ready');
          }
        }, 3000);
        break;
      case 'error':
        icon.innerHTML = '<i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>';
        text.textContent = '저장 실패';
        text.style.color = 'var(--danger)';
        break;
      default: // ready
        icon.innerHTML = '<i class="fas fa-cloud" style="color: var(--text-muted);"></i>';
        text.textContent = '준비됨';
        text.style.color = 'var(--text-muted)';
    }
  }

  // Clean up keyboard listener when modal closes
  const originalCloseModal = window.closeModal;
  window.closeModal = function() {
    document.removeEventListener('keydown', handleCRFKeyboard);
    if (crfAutoSaveTimer) {
      clearTimeout(crfAutoSaveTimer);
    }
    window.currentCRFFields = null;
    originalCloseModal();
  };

  function renderCRFFieldInput(field, existingValue) {
    const required = field.is_required ? '<span class="required">*</span>' : '';
    const value = existingValue || field.default_value || '';
    const requiredAttr = field.is_required ? 'data-required="true"' : '';
    let input = '';
    let rangeHint = '';

    // Add range hint for NUMBER type
    if (field.field_type === 'NUMBER' && (field.min_value || field.max_value)) {
      const min = field.min_value !== null && field.min_value !== '' ? field.min_value : '-∞';
      const max = field.max_value !== null && field.max_value !== '' ? field.max_value : '∞';
      rangeHint = `<span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">(범위: ${min} ~ ${max})</span>`;
    }

    switch (field.field_type) {
      case 'TEXT':
        input = `<input type="text" class="form-input crf-field" name="${field.field_code}" value="${sanitizeHTML(value)}" placeholder="${field.placeholder || ''}" ${requiredAttr}>`;
        break;
      case 'TEXTAREA':
        input = `<textarea class="form-input crf-field" name="${field.field_code}" rows="3" placeholder="${field.placeholder || ''}" ${requiredAttr}>${sanitizeHTML(value)}</textarea>`;
        break;
      case 'NUMBER':
        input = `<input type="number" class="form-input crf-field" name="${field.field_code}" value="${value}" min="${field.min_value || ''}" max="${field.max_value || ''}" step="any" placeholder="${field.placeholder || ''}" ${requiredAttr}>`;
        break;
      case 'DATE':
        input = `<input type="date" class="form-input crf-field" name="${field.field_code}" value="${value}" ${requiredAttr}>`;
        break;
      case 'DATETIME':
        input = `<input type="datetime-local" class="form-input crf-field" name="${field.field_code}" value="${value}" ${requiredAttr}>`;
        break;
      case 'TIME':
        input = `<input type="time" class="form-input crf-field" name="${field.field_code}" value="${value}" ${requiredAttr}>`;
        break;
      case 'SELECT':
        const selectOpts = field.options ? JSON.parse(field.options) : [];
        input = `<select class="form-input crf-field" name="${field.field_code}" ${requiredAttr}>
          <option value="">선택하세요</option>
          ${selectOpts.map(o => `<option value="${o.value}" ${value === o.value ? 'selected' : ''}>${sanitizeHTML(o.label)}</option>`).join('')}
        </select>`;
        break;
      case 'RADIO':
        const radioOpts = field.options ? JSON.parse(field.options) : [];
        input = `<div style="display: flex; flex-direction: column; gap: 8px;" ${requiredAttr}>
          ${radioOpts.map(o => `<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" class="crf-field" name="${field.field_code}" value="${o.value}" ${value === o.value ? 'checked' : ''}> ${sanitizeHTML(o.label)}
          </label>`).join('')}
        </div>`;
        break;
      case 'CHECKBOX':
        const checkOpts = field.options ? JSON.parse(field.options) : [];
        const checkedValues = value ? value.split(',') : [];
        if (checkOpts.length > 0) {
          input = `<div style="display: flex; flex-direction: column; gap: 8px;">
            ${checkOpts.map(o => `<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" class="crf-field" name="${field.field_code}" value="${o.value}" ${checkedValues.includes(o.value) ? 'checked' : ''}> ${sanitizeHTML(o.label)}
            </label>`).join('')}
          </div>`;
        } else {
          input = `<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" class="crf-field" name="${field.field_code}" value="1" ${value === '1' ? 'checked' : ''}> ${field.field_name}
          </label>`;
        }
        break;
      default:
        input = `<input type="text" class="form-input crf-field" name="${field.field_code}" value="${sanitizeHTML(value)}" ${requiredAttr}>`;
    }

    return `
      <div class="form-group" data-field-code="${field.field_code}">
        <label class="form-label">${sanitizeHTML(field.field_name)} ${required} ${rangeHint}</label>
        ${input}
        <div class="field-error" style="display: none; color: var(--danger); font-size: 12px; margin-top: 4px;"></div>
        ${field.help_text ? `<small style="color: var(--text-muted); display: block; margin-top: 4px;">${sanitizeHTML(field.help_text)}</small>` : ''}
      </div>
    `;
  }

  async function saveCRFData() {
    const form = document.getElementById('crf-entry-form');
    const visitId = document.getElementById('crf-visit-id')?.value;
    const formCode = document.getElementById('crf-form-code')?.value;
    const instanceId = document.getElementById('crf-instance-id')?.value;

    if (!form || !visitId || !formCode) {
      showToast('데이터를 저장할 수 없습니다.', 'error');
      return;
    }

    // 폼 데이터 수집
    const formData = new FormData(form);
    const data = {};
    
    // 체크박스 그룹 처리
    const checkboxGroups = {};
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!checkboxGroups[cb.name]) checkboxGroups[cb.name] = [];
      if (cb.checked) checkboxGroups[cb.name].push(cb.value);
    });

    formData.forEach((value, key) => {
      if (!checkboxGroups[key]) {
        data[key] = value;
      }
    });

    // 체크박스 값 병합
    Object.keys(checkboxGroups).forEach(key => {
      data[key] = checkboxGroups[key].join(',');
    });

    try {
      await api.post(`/visits/${visitId}/crf`, {
        form_code: formCode,
        data: data
      });
      closeModal();
      showToast('CRF 데이터가 저장되었습니다.', 'success');
      loadVisitDetail(visitId);
    } catch (error) {
      showToast(error.error || '저장에 실패했습니다.', 'error');
    }
  }
  window.saveCRFData = saveCRFData;

  function viewCRFData(crfInstanceId) {
    const visit = state.currentVisit;
    const instance = (visit?.crfInstances || []).find(c => c.id === crfInstanceId);
    
    if (!instance) {
      showToast('데이터를 찾을 수 없습니다.', 'error');
      return;
    }

    const dataHtml = (instance.data || []).map(d => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid var(--border);"><strong>${d.field_code}</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid var(--border);">${d.field_name || '-'}</td>
        <td style="padding: 8px; border-bottom: 1px solid var(--border);">${d.field_value || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="3" style="padding: 16px; text-align: center;">데이터가 없습니다.</td></tr>';

    showModal(`${instance.form_code} - ${instance.form_name}`, `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: var(--bg-tertiary);">
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border);">필드 코드</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border);">필드명</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border);">값</th>
          </tr>
        </thead>
        <tbody>${dataHtml}</tbody>
      </table>
      <div style="margin-top: 16px; font-size: 12px; color: var(--text-muted);">
        상태: ${instance.status} | 입력: ${instance.data_entry_at || '-'} | 수정: ${instance.updated_at || '-'}
      </div>
    `, [
      { label: '닫기', onclick: 'closeModal()' }
    ]);
  }
  window.viewCRFData = viewCRFData;

  function editCRF(crfId) {
    const visit = state.currentVisit;
    const instance = (visit?.crfInstances || []).find(c => c.id === crfId);
    if (instance) {
      openCRFEntry(visit.id, instance.form_code, crfId);
    }
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
            <div id="queries-table"></div>
          </div>
        </div>
      `;

      // Initialize DataTable for queries if there are queries
      if (queries.length > 0) {
        setTimeout(() => {
          DataTable.create('queries-table', {
            data: queries,
            columns: [
              { field: 'id', header: 'Query ID', sortable: true, width: '100px',
                render: (val) => `<strong>${sanitizeHTML(val.substring(0, 8))}</strong>` },
              { field: 'subject_number', header: 'Subject', sortable: true, filterable: true },
              { field: 'field_name', header: '필드', sortable: true },
              { field: 'query_text', header: '내용', sortable: false,
                render: (val) => `<span style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">${sanitizeHTML(val || '-')}</span>` },
              { field: 'status', header: '상태', sortable: true, filterable: true, type: 'badge' },
              { field: 'priority', header: '우선순위', sortable: true, filterable: true,
                render: (val) => `<span class="badge ${val === 'CRITICAL' ? 'badge-open' : val === 'MAJOR' ? 'badge-pending' : 'badge-draft'}">${val || 'MINOR'}</span>` },
              { field: 'created_at', header: '생성일', sortable: true, type: 'date' }
            ],
            emptyMessage: 'Query가 없습니다',
            pageSize: 15,
            actionColumn: () => `<i class="fas fa-chevron-right" style="color: var(--text-muted);"></i>`
          });
          // Attach click handlers
          const tableContainer = document.getElementById('queries-table');
          if (tableContainer) {
            tableContainer.querySelectorAll('tbody tr').forEach((tr, idx) => {
              const pagedData = DataTable.getPagedData('queries-table');
              if (pagedData[idx]) {
                tr.style.cursor = 'pointer';
                tr.onclick = () => showQueryDetail(pagedData[idx].id);
              }
            });
          }
        }, 0);
      } else {
        document.getElementById('queries-table').innerHTML = `<div class="empty-state"><i class="fas fa-comment-medical"></i><h3>Query가 없습니다</h3></div>`;
      }
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
      } else if (type === 'audit') {
        // Redirect to full Audit Trail viewer
        loadAuditTrail();
        return;
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
  // AUDIT TRAIL VIEWER (21 CFR Part 11 Compliant)
  // =====================================================
  let auditState = {
    currentPage: 1,
    pageSize: 50,
    filters: {},
    sortBy: 'timestamp',
    sortOrder: 'desc',
  };

  async function loadAuditTrail() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    // Check permission
    if (!ui.hasPermission('VIEW_AUDIT')) {
      mainContent.innerHTML = `
        <div class="empty-state" style="margin-top: 60px;">
          <i class="fas fa-lock" style="color: var(--danger);"></i>
          <h3>접근 권한 없음</h3>
          <p>Audit Trail 조회 권한이 필요합니다.</p>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-history" style="margin-right: 8px;"></i>Audit Trail (21 CFR Part 11)</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="showAuditStatistics()"><i class="fas fa-chart-bar"></i> 통계</button>
            <button class="btn btn-secondary btn-sm" onclick="exportAuditTrail()"><i class="fas fa-download"></i> Export</button>
          </div>
        </div>
        <div class="card-body">
          <!-- Filters -->
          <div id="audit-filters" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; padding: 16px; background: var(--bg-secondary); border-radius: 8px;">
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">Study</label>
              <select id="audit-filter-study" class="form-input" style="padding: 6px 10px; font-size: 13px;" onchange="applyAuditFilters()">
                <option value="">전체</option>
                ${state.studies.map(s => `<option value="${s.id}">${sanitizeHTML(s.protocol_number)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">카테고리</label>
              <select id="audit-filter-category" class="form-input" style="padding: 6px 10px; font-size: 13px;" onchange="applyAuditFilters()">
                <option value="">전체</option>
                <option value="AUTHENTICATION">인증</option>
                <option value="DATA_ENTRY">데이터 입력</option>
                <option value="DATA_MODIFICATION">데이터 수정</option>
                <option value="SIGNATURE">전자 서명</option>
                <option value="WORKFLOW">워크플로우</option>
                <option value="QUERY">Query</option>
                <option value="EXPORT">내보내기</option>
                <option value="ADMINISTRATION">관리</option>
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">액션</label>
              <select id="audit-filter-action" class="form-input" style="padding: 6px 10px; font-size: 13px;" onchange="applyAuditFilters()">
                <option value="">전체</option>
                <option value="CREATE">생성</option>
                <option value="UPDATE">수정</option>
                <option value="DELETE">삭제</option>
                <option value="LOGIN">로그인</option>
                <option value="LOGOUT">로그아웃</option>
                <option value="LOGIN_FAILED">로그인 실패</option>
                <option value="SIGN">전자 서명</option>
                <option value="LOCK">잠금</option>
                <option value="UNLOCK">잠금 해제</option>
                <option value="EXPORT">내보내기</option>
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">시작일</label>
              <input type="date" id="audit-filter-start" class="form-input" style="padding: 6px 10px; font-size: 13px;" onchange="applyAuditFilters()">
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">종료일</label>
              <input type="date" id="audit-filter-end" class="form-input" style="padding: 6px 10px; font-size: 13px;" onchange="applyAuditFilters()">
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-size: 11px;">검색</label>
              <input type="text" id="audit-filter-search" class="form-input" style="padding: 6px 10px; font-size: 13px;" placeholder="사용자, 레코드 ID..." onkeyup="debounce(() => applyAuditFilters(), 300)()">
            </div>
          </div>
          
          <!-- Results -->
          <div id="audit-results">
            <div class="loading"><div class="spinner"></div><span>감사 로그를 불러오는 중...</span></div>
          </div>
        </div>
      </div>
    `;

    fetchAuditLogs();
  }
  window.loadAuditTrail = loadAuditTrail;

  async function fetchAuditLogs() {
    const resultsDiv = document.getElementById('audit-results');
    if (!resultsDiv) return;

    try {
      const params = new URLSearchParams();
      params.set('page', auditState.currentPage.toString());
      params.set('pageSize', auditState.pageSize.toString());
      params.set('sortBy', auditState.sortBy);
      params.set('sortOrder', auditState.sortOrder);

      if (auditState.filters.studyId) params.set('studyId', auditState.filters.studyId);
      if (auditState.filters.action) params.set('action', auditState.filters.action);
      if (auditState.filters.startDate) params.set('startDate', auditState.filters.startDate);
      if (auditState.filters.endDate) params.set('endDate', auditState.filters.endDate);
      if (auditState.filters.search) params.set('search', auditState.filters.search);

      const result = await api.get(`/audit/logs?${params.toString()}`);
      const { data: logs, pagination } = result;

      if (!logs || logs.length === 0) {
        resultsDiv.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-clipboard-list"></i>
            <h3>감사 로그가 없습니다</h3>
            <p>선택한 조건에 맞는 로그가 없습니다.</p>
          </div>
        `;
        return;
      }

      resultsDiv.innerHTML = `
        <!-- Summary -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-light);">
          <span style="font-size: 13px; color: var(--text-secondary);">
            총 <strong>${pagination.total.toLocaleString()}</strong>건 중 ${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.total)}건 표시
          </span>
          <select id="audit-page-size" class="form-input" style="width: auto; padding: 4px 8px; font-size: 12px;" onchange="changeAuditPageSize(this.value)">
            <option value="25" ${auditState.pageSize === 25 ? 'selected' : ''}>25개</option>
            <option value="50" ${auditState.pageSize === 50 ? 'selected' : ''}>50개</option>
            <option value="100" ${auditState.pageSize === 100 ? 'selected' : ''}>100개</option>
          </select>
        </div>

        <!-- Table -->
        <div style="overflow-x: auto;">
          <table class="data-table" style="font-size: 12px;">
            <thead>
              <tr>
                <th style="width: 140px; cursor: pointer;" onclick="sortAuditLogs('timestamp')">
                  시간 ${auditState.sortBy === 'timestamp' ? (auditState.sortOrder === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th style="width: 100px;">사용자</th>
                <th style="width: 80px;">역할</th>
                <th style="width: 100px;">액션</th>
                <th style="width: 90px;">대상</th>
                <th style="width: 100px;">레코드</th>
                <th>변경 내용</th>
                <th style="width: 60px;">상세</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(log => `
                <tr class="audit-row" data-log-id="${log.id}">
                  <td style="font-family: monospace; font-size: 11px; white-space: nowrap;">
                    ${formatAuditTimestamp(log.timestamp)}
                  </td>
                  <td title="${sanitizeHTML(log.user_name)}">
                    <span style="max-width: 100px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${sanitizeHTML(log.user_name)}
                    </span>
                  </td>
                  <td><span class="badge badge-draft" style="font-size: 10px;">${ui.getRoleShort(log.user_role)}</span></td>
                  <td>
                    <span class="badge ${getAuditActionBadgeClass(log.severity)}" style="font-size: 10px;">
                      ${sanitizeHTML(log.action_label || log.action)}
                    </span>
                  </td>
                  <td style="font-size: 11px;">${sanitizeHTML(log.table_label || log.table_name)}</td>
                  <td style="font-family: monospace; font-size: 10px;" title="${sanitizeHTML(log.record_id)}">
                    ${truncateText(log.record_id, 12)}
                  </td>
                  <td style="font-size: 11px;">
                    ${formatAuditChange(log)}
                  </td>
                  <td>
                    <button class="btn-icon" onclick="showAuditDetail('${log.id}')" title="상세 보기">
                      <i class="fas fa-eye"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
          <button class="btn btn-secondary btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="changeAuditPage(1)">
            <i class="fas fa-angle-double-left"></i>
          </button>
          <button class="btn btn-secondary btn-sm" ${pagination.page <= 1 ? 'disabled' : ''} onclick="changeAuditPage(${pagination.page - 1})">
            <i class="fas fa-angle-left"></i>
          </button>
          <span style="font-size: 13px; padding: 0 12px;">
            ${pagination.page} / ${pagination.totalPages}
          </span>
          <button class="btn btn-secondary btn-sm" ${pagination.page >= pagination.totalPages ? 'disabled' : ''} onclick="changeAuditPage(${pagination.page + 1})">
            <i class="fas fa-angle-right"></i>
          </button>
          <button class="btn btn-secondary btn-sm" ${pagination.page >= pagination.totalPages ? 'disabled' : ''} onclick="changeAuditPage(${pagination.totalPages})">
            <i class="fas fa-angle-double-right"></i>
          </button>
        </div>
      `;
    } catch (error) {
      console.error('Audit logs error:', error);
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
          <h3>감사 로그 로드 실패</h3>
          <p>${error.error || '알 수 없는 오류가 발생했습니다.'}</p>
        </div>
      `;
    }
  }

  function formatAuditTimestamp(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function getAuditActionBadgeClass(severity) {
    const classes = {
      'CRITICAL': 'badge-open',
      'ERROR': 'badge-open',
      'WARNING': 'badge-pending',
      'INFO': 'badge-active',
    };
    return classes[severity] || 'badge-draft';
  }

  function formatAuditChange(log) {
    if (log.field_name) {
      const oldVal = log.old_value ? truncateText(log.old_value, 15) : '(없음)';
      const newVal = log.new_value ? truncateText(log.new_value, 15) : '(없음)';
      return `<code style="font-size: 10px;">${sanitizeHTML(log.field_name)}</code>: ${sanitizeHTML(oldVal)} → ${sanitizeHTML(newVal)}`;
    }
    if (log.reason_for_change) {
      return `<span style="color: var(--text-muted);">${truncateText(log.reason_for_change, 30)}</span>`;
    }
    if (log.new_value) {
      return `<span style="color: var(--text-muted);">${truncateText(log.new_value, 40)}</span>`;
    }
    return '-';
  }

  function truncateText(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  }

  function applyAuditFilters() {
    auditState.filters = {
      studyId: document.getElementById('audit-filter-study')?.value || '',
      action: document.getElementById('audit-filter-action')?.value || '',
      startDate: document.getElementById('audit-filter-start')?.value || '',
      endDate: document.getElementById('audit-filter-end')?.value || '',
      search: document.getElementById('audit-filter-search')?.value || '',
    };
    auditState.currentPage = 1;
    fetchAuditLogs();
  }
  window.applyAuditFilters = applyAuditFilters;

  function changeAuditPage(page) {
    auditState.currentPage = page;
    fetchAuditLogs();
  }
  window.changeAuditPage = changeAuditPage;

  function changeAuditPageSize(size) {
    auditState.pageSize = parseInt(size);
    auditState.currentPage = 1;
    fetchAuditLogs();
  }
  window.changeAuditPageSize = changeAuditPageSize;

  function sortAuditLogs(field) {
    if (auditState.sortBy === field) {
      auditState.sortOrder = auditState.sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      auditState.sortBy = field;
      auditState.sortOrder = 'desc';
    }
    fetchAuditLogs();
  }
  window.sortAuditLogs = sortAuditLogs;

  async function showAuditDetail(logId) {
    try {
      const result = await api.get(`/audit/logs/${logId}`);
      const log = result.data;

      const contextInfo = [];
      if (log.context?.study) contextInfo.push(`<strong>Study:</strong> ${sanitizeHTML(log.context.study.protocol_number)}`);
      if (log.context?.site) contextInfo.push(`<strong>Site:</strong> ${sanitizeHTML(log.context.site.site_number)} - ${sanitizeHTML(log.context.site.name)}`);
      if (log.context?.subject) contextInfo.push(`<strong>Subject:</strong> ${sanitizeHTML(log.context.subject.subject_number)}`);

      showModal('감사 로그 상세', `
        <div style="display: grid; gap: 16px;">
          <!-- 기본 정보 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">기본 정보</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
              <div><span style="color: var(--text-muted);">Log ID:</span><br><code style="font-size: 11px;">${sanitizeHTML(log.id)}</code></div>
              <div><span style="color: var(--text-muted);">타임스탬프:</span><br><strong>${formatAuditTimestamp(log.timestamp)}</strong></div>
              <div><span style="color: var(--text-muted);">액션:</span><br><span class="badge ${getAuditActionBadgeClass(log.severity)}">${sanitizeHTML(log.action_label)}</span></div>
              <div><span style="color: var(--text-muted);">카테고리:</span><br>${sanitizeHTML(log.category)}</div>
            </div>
          </div>

          <!-- 사용자 정보 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">사용자 정보 (WHO)</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
              <div><span style="color: var(--text-muted);">사용자:</span><br><strong>${sanitizeHTML(log.user_name)}</strong></div>
              <div><span style="color: var(--text-muted);">역할:</span><br>${ui.getRoleShort(log.user_role)}</div>
              <div><span style="color: var(--text-muted);">IP 주소:</span><br><code>${sanitizeHTML(log.ip_address || 'N/A')}</code></div>
              <div><span style="color: var(--text-muted);">세션 ID:</span><br><code style="font-size: 10px;">${truncateText(log.session_id || 'N/A', 20)}</code></div>
            </div>
          </div>

          <!-- 변경 내용 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">변경 내용 (WHAT)</h4>
            <div style="display: grid; gap: 8px; font-size: 13px;">
              <div><span style="color: var(--text-muted);">테이블:</span> <strong>${sanitizeHTML(log.table_label)}</strong> (${sanitizeHTML(log.table_name)})</div>
              <div><span style="color: var(--text-muted);">레코드 ID:</span> <code>${sanitizeHTML(log.record_id)}</code></div>
              ${log.field_name ? `<div><span style="color: var(--text-muted);">필드:</span> <code>${sanitizeHTML(log.field_name)}</code></div>` : ''}
              ${log.old_value ? `<div><span style="color: var(--text-muted);">이전 값:</span><br><pre style="background: #fff; padding: 8px; border-radius: 4px; margin: 4px 0; font-size: 11px; white-space: pre-wrap;">${sanitizeHTML(log.old_value)}</pre></div>` : ''}
              ${log.new_value ? `<div><span style="color: var(--text-muted);">새 값:</span><br><pre style="background: #fff; padding: 8px; border-radius: 4px; margin: 4px 0; font-size: 11px; white-space: pre-wrap;">${sanitizeHTML(log.new_value)}</pre></div>` : ''}
            </div>
          </div>

          ${log.reason_for_change ? `
          <!-- 변경 사유 (21 CFR Part 11) -->
          <div style="background: #fff3e0; padding: 16px; border-radius: 8px; border-left: 4px solid var(--warning);">
            <h4 style="margin-bottom: 8px; font-size: 13px; color: var(--warning);">
              <i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i>변경 사유 (WHY)
            </h4>
            <p style="margin: 0; font-size: 13px;">${sanitizeHTML(log.reason_for_change)}</p>
          </div>
          ` : ''}

          ${contextInfo.length > 0 ? `
          <!-- 연구 컨텍스트 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">연구 컨텍스트</h4>
            <div style="font-size: 13px;">${contextInfo.join('<br>')}</div>
          </div>
          ` : ''}

          <!-- 클라이언트 정보 -->
          ${log.user_agent ? `
          <div style="font-size: 11px; color: var(--text-muted); padding-top: 8px; border-top: 1px solid var(--border-light);">
            <strong>User Agent:</strong> ${sanitizeHTML(truncateText(log.user_agent, 80))}
          </div>
          ` : ''}
        </div>
      `, [{ label: '닫기', onclick: 'closeModal()' }]);
    } catch (error) {
      showToast('감사 로그 상세 조회 실패', 'error');
    }
  }
  window.showAuditDetail = showAuditDetail;

  async function showAuditStatistics() {
    try {
      const studyId = document.getElementById('audit-filter-study')?.value || state.studies[0]?.id;
      if (!studyId) {
        showToast('Study를 선택해주세요.', 'warning');
        return;
      }

      showToast('통계를 불러오는 중...', 'info');
      const result = await api.get(`/audit/statistics?studyId=${studyId}&period=30d`);
      const stats = result.data;

      showModal('Audit Trail 통계', `
        <div style="display: grid; gap: 16px;">
          <!-- 요약 -->
          <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr);">
            <div class="stat-card">
              <div class="stat-label">총 이벤트</div>
              <div class="stat-value">${(stats.summary?.totalEvents || 0).toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">활성 사용자</div>
              <div class="stat-value">${stats.summary?.uniqueUsers || 0}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">중요 이벤트</div>
              <div class="stat-value" style="color: var(--danger);">${stats.summary?.criticalEvents || 0}</div>
            </div>
          </div>

          <!-- 카테고리별 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px;">카테고리별 분포</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${(stats.categoryBreakdown || []).map(cat => `
                <span class="badge badge-draft" style="font-size: 11px;">${cat.category}: ${cat.count}</span>
              `).join('')}
            </div>
          </div>

          <!-- 활성 사용자 -->
          <div style="background: var(--bg-secondary); padding: 16px; border-radius: 8px;">
            <h4 style="margin-bottom: 12px; font-size: 13px;">활성 사용자 Top 5</h4>
            <table class="data-table" style="font-size: 12px;">
              <tbody>
                ${(stats.activeUsers || []).slice(0, 5).map(u => `
                  <tr>
                    <td><strong>${sanitizeHTML(u.user_name)}</strong></td>
                    <td>${ui.getRoleShort(u.user_role)}</td>
                    <td style="text-align: right;">${u.activity_count}건</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- 기간 정보 -->
          <div style="font-size: 11px; color: var(--text-muted); text-align: center;">
            조회 기간: ${stats.period?.from?.split('T')[0]} ~ ${stats.period?.to?.split('T')[0]}
          </div>
        </div>
      `, [{ label: '닫기', onclick: 'closeModal()' }]);
    } catch (error) {
      showToast('통계 조회 실패', 'error');
    }
  }
  window.showAuditStatistics = showAuditStatistics;

  async function exportAuditTrail() {
    const studyId = document.getElementById('audit-filter-study')?.value;
    if (!studyId) {
      showToast('Study를 선택해주세요.', 'warning');
      return;
    }

    try {
      showToast('Audit Trail 내보내기 중...', 'info');

      const startDate = document.getElementById('audit-filter-start')?.value || '';
      const endDate = document.getElementById('audit-filter-end')?.value || '';

      const params = new URLSearchParams({ studyId });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await fetch(`/api/audit/export?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_trail_${studyId}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('Audit Trail 내보내기 완료', 'success');
    } catch (error) {
      showToast('Audit Trail 내보내기 실패', 'error');
    }
  }
  window.exportAuditTrail = exportAuditTrail;

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
            <div id="users-table"></div>
          </div>
        </div>
      `;

      // Initialize DataTable for users
      setTimeout(() => {
        DataTable.create('users-table', {
          data: users,
          columns: [
            { field: 'name', header: '이름', sortable: true,
              render: (val) => `<strong>${sanitizeHTML(val)}</strong>` },
            { field: 'email', header: '이메일', sortable: true },
            { field: 'role', header: '역할', sortable: true, filterable: true,
              render: (val) => `<span class="badge badge-draft">${ui.getRoleShort(val)}</span>` },
            { field: 'status', header: '상태', sortable: true, filterable: true, type: 'badge' },
            { field: 'two_factor_enabled', header: '2FA', sortable: true,
              render: (val) => val ? '<i class="fas fa-shield-alt" style="color: var(--success);"></i>' : '-' },
            { field: 'last_login', header: '마지막 접속', sortable: true, type: 'datetime' }
          ],
          emptyMessage: '등록된 사용자가 없습니다',
          pageSize: 15,
          actionColumn: (row) => `<button class="btn-icon" onclick="event.stopPropagation(); showEditUserModal('${row.id}')" title="수정"><i class="fas fa-edit"></i></button>`
        });
      }, 0);
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

  // =====================================================
  // GLOBAL SEARCH
  // =====================================================
  let globalSearchResults = [];
  let globalSearchSelectedIndex = -1;

  function showGlobalSearchDropdown() {
    const dropdown = document.getElementById('global-search-dropdown');
    const input = document.getElementById('global-search-input');
    if (!dropdown || !input) return;
    
    if (!input.value.trim()) {
      // Show recent searches or quick actions
      dropdown.innerHTML = `
        <div style="padding: 12px;">
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">빠른 검색</div>
          <div class="search-item" onclick="setSearchAndSearch('OPEN queries')" style="padding: 8px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-question-circle" style="color: var(--warning);"></i>
            <span>미결 Query 보기</span>
          </div>
          <div class="search-item" onclick="setSearchAndSearch('subjects')" style="padding: 8px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-users" style="color: var(--primary);"></i>
            <span>최근 피험자</span>
          </div>
          <div class="search-item" onclick="navigateTo('reports'); hideGlobalSearchDropdown();" style="padding: 8px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-chart-bar" style="color: var(--success);"></i>
            <span>리포트 보기</span>
          </div>
        </div>
        <div style="padding: 8px 12px; background: var(--bg-secondary); font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border);">
          <kbd style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 10px;">↑↓</kbd> 이동
          <kbd style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;">Enter</kbd> 선택
          <kbd style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;">Esc</kbd> 닫기
        </div>
      `;
      dropdown.style.display = 'block';
    }
  }
  window.showGlobalSearchDropdown = showGlobalSearchDropdown;

  function hideGlobalSearchDropdown() {
    const dropdown = document.getElementById('global-search-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    globalSearchSelectedIndex = -1;
  }
  window.hideGlobalSearchDropdown = hideGlobalSearchDropdown;

  function setSearchAndSearch(term) {
    const input = document.getElementById('global-search-input');
    if (input) {
      input.value = term;
      performGlobalSearch(term);
    }
  }
  window.setSearchAndSearch = setSearchAndSearch;

  async function performGlobalSearch(query) {
    const dropdown = document.getElementById('global-search-dropdown');
    if (!dropdown) return;

    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      showGlobalSearchDropdown();
      return;
    }

    dropdown.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>`;
    dropdown.style.display = 'block';
    globalSearchSelectedIndex = -1;

    try {
      const searchQuery = trimmedQuery.toLowerCase();
      const results = [];

      // Search subjects
      try {
        const subjectResult = await api.get(`/subjects/search?q=${encodeURIComponent(trimmedQuery)}`);
        (subjectResult.data || []).slice(0, 5).forEach(s => {
          results.push({
            type: 'subject',
            icon: 'fa-user',
            color: 'var(--primary)',
            title: `${s.subject_number}`,
            subtitle: `${s.site_name || '-'} · ${s.status}`,
            action: () => { hideGlobalSearchDropdown(); navigateTo('subject', { subjectId: s.id }); }
          });
        });
      } catch (e) { console.log('Subject search error:', e); }

      // Search queries if keyword matches
      if (searchQuery.includes('query') || searchQuery.includes('open') || searchQuery.includes('미결')) {
        try {
          const queryResult = await api.get('/queries?status=OPEN&limit=5');
          (queryResult.data || []).slice(0, 5).forEach(q => {
            results.push({
              type: 'query',
              icon: 'fa-question-circle',
              color: 'var(--warning)',
              title: `Query: ${q.subject_number || '-'}`,
              subtitle: `${q.field_code || '-'} · ${q.priority}`,
              action: () => { hideGlobalSearchDropdown(); navigateTo('queries'); }
            });
          });
        } catch (e) { console.log('Query search error:', e); }
      }

      // Search studies
      const matchingStudies = state.studies.filter(s => 
        s.protocol_number?.toLowerCase().includes(searchQuery) ||
        s.title?.toLowerCase().includes(searchQuery)
      ).slice(0, 3);
      
      matchingStudies.forEach(s => {
        results.push({
          type: 'study',
          icon: 'fa-flask',
          color: 'var(--success)',
          title: s.protocol_number,
          subtitle: s.title?.substring(0, 40) + (s.title?.length > 40 ? '...' : ''),
          action: () => { hideGlobalSearchDropdown(); navigateTo('study', { studyId: s.id }); }
        });
      });

      globalSearchResults = results;

      // Render results
      if (results.length === 0) {
        dropdown.innerHTML = `
          <div style="padding: 24px; text-align: center; color: var(--text-muted);">
            <i class="fas fa-search" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px;"></i>
            <p>"${sanitizeHTML(trimmedQuery)}"에 대한 검색 결과가 없습니다.</p>
          </div>
        `;
      } else {
        dropdown.innerHTML = `
          <div style="padding: 8px 0;">
            ${results.map((r, idx) => `
              <div class="search-result-item ${idx === globalSearchSelectedIndex ? 'selected' : ''}" 
                   data-index="${idx}"
                   onclick="globalSearchResults[${idx}].action()"
                   onmouseenter="globalSearchSelectedIndex = ${idx}; highlightSearchResult(${idx})"
                   style="padding: 10px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; ${idx === globalSearchSelectedIndex ? 'background: var(--bg-secondary);' : ''}">
                <div style="width: 32px; height: 32px; border-radius: 50%; background: ${r.color}15; display: flex; align-items: center; justify-content: center;">
                  <i class="fas ${r.icon}" style="color: ${r.color}; font-size: 14px;"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sanitizeHTML(r.title)}</div>
                  <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sanitizeHTML(r.subtitle)}</div>
                </div>
                <span class="badge" style="font-size: 10px; background: var(--bg-tertiary); color: var(--text-muted);">${r.type}</span>
              </div>
            `).join('')}
          </div>
          <div style="padding: 8px 12px; background: var(--bg-secondary); font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border);">
            ${results.length}개 결과
          </div>
        `;
      }
    } catch (error) {
      dropdown.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--danger);">검색 중 오류가 발생했습니다.</div>`;
    }
  }
  window.performGlobalSearch = performGlobalSearch;

  function highlightSearchResult(index) {
    document.querySelectorAll('.search-result-item').forEach((item, i) => {
      item.style.background = i === index ? 'var(--bg-secondary)' : '';
    });
  }
  window.highlightSearchResult = highlightSearchResult;

  function handleGlobalSearchKeydown(e) {
    const dropdown = document.getElementById('global-search-dropdown');
    if (!dropdown || dropdown.style.display === 'none') {
      if (e.key === 'Escape') return;
      return;
    }

    if (e.key === 'Escape') {
      hideGlobalSearchDropdown();
      document.getElementById('global-search-input')?.blur();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      globalSearchSelectedIndex = Math.min(globalSearchSelectedIndex + 1, globalSearchResults.length - 1);
      highlightSearchResult(globalSearchSelectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      globalSearchSelectedIndex = Math.max(globalSearchSelectedIndex - 1, 0);
      highlightSearchResult(globalSearchSelectedIndex);
    } else if (e.key === 'Enter' && globalSearchSelectedIndex >= 0) {
      e.preventDefault();
      globalSearchResults[globalSearchSelectedIndex]?.action();
    }
  }
  window.handleGlobalSearchKeydown = handleGlobalSearchKeydown;

  // Global keyboard shortcut for search (Ctrl+K)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('global-search-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  });

  // Click outside to close dropdown
  document.addEventListener('click', (e) => {
    const container = document.querySelector('.global-search-container');
    if (container && !container.contains(e.target)) {
      hideGlobalSearchDropdown();
    }
  });

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
    
    if (!studyId) {
      showToast('Study를 선택해주세요.', 'warning');
      return;
    }
    
    closeModal();
    showToast(`${format.toUpperCase()} Export를 시작합니다...`, 'info');

    try {
      // Use fetch with blob response type for file downloads
      const url = `/api/exports/${format}?studyId=${studyId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${state.token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Export failed');
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      const contentDisposition = response.headers.get('content-disposition') || '';
      
      // Extract filename from content-disposition header
      let filename = `export_${format}_${new Date().toISOString().split('T')[0]}`;
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      } else {
        // Set extension based on format
        if (format === 'odm') {
          filename += '.xml';
        } else {
          filename += '.csv';
        }
      }

      // Get response as blob
      const blob = await response.blob();
      
      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      
      showToast('Export가 완료되었습니다.', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showToast(error.message || 'Export에 실패했습니다.', 'error');
    }
  }
  window.exportData = exportData;

  // =====================================================
  // INITIALIZATION
  // =====================================================
  function init() {
    // Initialize browser history handling
    initHistoryHandling();
    
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
      // Check for initial route from URL
      if (state.initialRoute) {
        navigateTo(state.initialRoute.view, state.initialRoute.params);
        delete state.initialRoute;
      } else {
        loadDashboard();
      }
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
