// eCRF PWA - Frontend Application
// 21 CFR Part 11 준수를 위한 클라이언트 사이드 로직
// Version 2.1 - Full UI + Offline Support

(function() {
  'use strict';

  // =====================================================
  // CONFIGURATION
  // =====================================================
  const CONFIG = {
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    autoSaveInterval: 30 * 1000, // 30 seconds
    debounceDelay: 500,
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
    currentCRF: null,
    currentView: 'dashboard', // dashboard, study, site, subject, visit, crf
    lastActivity: Date.now(),
    isOnline: navigator.onLine,
    pendingChanges: 0,
  };

  // =====================================================
  // OFFLINE SUPPORT
  // =====================================================
  const offline = {
    // 오프라인 상태 변경 핸들러
    init() {
      window.addEventListener('online', () => this.handleOnlineStatusChange(true));
      window.addEventListener('offline', () => this.handleOnlineStatusChange(false));
      
      // Service Worker 메시지 수신
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleServiceWorkerMessage(event.data);
        });
      }
      
      // OfflineDB 이벤트 수신
      window.addEventListener('offline-status-change', (event) => {
        this.handleOnlineStatusChange(event.detail.online);
      });
      
      window.addEventListener('pending-changes-update', (event) => {
        state.pendingChanges = event.detail.count;
        this.updateOfflineUI();
      });
      
      // 초기 상태 설정
      state.isOnline = navigator.onLine;
      this.updateOfflineUI();
    },
    
    handleOnlineStatusChange(isOnline) {
      state.isOnline = isOnline;
      this.updateOfflineUI();
      
      if (isOnline) {
        showToast('온라인 상태로 전환되었습니다.', 'success');
        this.triggerSync();
      } else {
        showToast('오프라인 상태입니다. 변경사항은 로컬에 저장됩니다.', 'warning');
      }
    },
    
    handleServiceWorkerMessage(data) {
      switch (data.type) {
        case 'OFFLINE_MUTATION':
          // 오프라인에서 저장 요청
          this.saveOfflineChange(data);
          break;
        case 'SYNC_STARTED':
          showToast('데이터 동기화 중...', 'info');
          break;
        case 'TRIGGER_SYNC':
          if (window.eCRFOfflineDB) {
            window.eCRFOfflineDB.syncWithServer();
          }
          break;
      }
    },
    
    async saveOfflineChange(data) {
      if (window.eCRFOfflineDB) {
        const type = this.getChangeType(data.endpoint);
        await window.eCRFOfflineDB.savePendingChange(
          type,
          data.endpoint,
          data.method,
          data.body
        );
        showToast('변경사항이 로컬에 저장되었습니다.', 'info');
      }
    },
    
    getChangeType(endpoint) {
      if (endpoint.includes('/crf')) return 'CRF_DATA';
      if (endpoint.includes('/queries')) return 'QUERY';
      if (endpoint.includes('/signatures')) return 'SIGNATURE';
      return 'OTHER';
    },
    
    async triggerSync() {
      if (window.eCRFOfflineDB) {
        const result = await window.eCRFOfflineDB.syncWithServer();
        if (result.synced > 0) {
          showToast(`${result.synced}개의 변경사항이 동기화되었습니다.`, 'success');
        }
        if (result.failed > 0) {
          showToast(`${result.failed}개의 동기화에 실패했습니다.`, 'error');
        }
      }
    },
    
    updateOfflineUI() {
      const statusIndicator = document.getElementById('offline-status');
      if (!statusIndicator) {
        this.createOfflineIndicator();
        return;
      }
      
      if (state.isOnline) {
        statusIndicator.classList.add('hidden');
      } else {
        statusIndicator.classList.remove('hidden');
      }
      
      // 대기 중인 변경사항 표시
      const pendingBadge = document.getElementById('pending-changes-badge');
      if (pendingBadge) {
        if (state.pendingChanges > 0) {
          pendingBadge.textContent = state.pendingChanges;
          pendingBadge.classList.remove('hidden');
        } else {
          pendingBadge.classList.add('hidden');
        }
      }
    },
    
    createOfflineIndicator() {
      const indicator = document.createElement('div');
      indicator.id = 'offline-status';
      indicator.className = 'fixed bottom-4 left-4 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 z-50 hidden cursor-pointer';
      indicator.innerHTML = `
        <i class="fas fa-wifi-slash"></i>
        <span>오프라인</span>
        <span id="pending-changes-badge" class="bg-white text-yellow-600 px-2 py-0.5 rounded-full text-xs font-bold hidden">0</span>
      `;
      indicator.onclick = () => this.showSyncDashboard();
      document.body.appendChild(indicator);
      this.updateOfflineUI();
    },

    // 동기화 대시보드 표시
    async showSyncDashboard() {
      if (!window.eCRFOfflineDB) {
        showToast('오프라인 데이터베이스가 초기화되지 않았습니다.', 'error');
        return;
      }

      try {
        const status = await window.eCRFOfflineDB.getSyncStatus();
        const cacheStats = await window.eCRFOfflineDB.getCacheStats();

        const modal = document.createElement('div');
        modal.id = 'sync-dashboard-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]';
        modal.innerHTML = `
          <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
              <h2 class="text-xl font-bold text-white flex items-center">
                <i class="fas fa-sync-alt mr-3"></i>
                동기화 상태
              </h2>
              <button onclick="document.getElementById('sync-dashboard-modal').remove()" class="text-white hover:text-gray-200">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <!-- 연결 상태 -->
              <div class="flex items-center justify-between mb-6 p-4 rounded-lg ${status.isOnline ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}">
                <div class="flex items-center">
                  <i class="fas ${status.isOnline ? 'fa-wifi text-green-500' : 'fa-wifi-slash text-yellow-500'} text-2xl mr-3"></i>
                  <div>
                    <p class="font-semibold ${status.isOnline ? 'text-green-700' : 'text-yellow-700'}">
                      ${status.isOnline ? '온라인' : '오프라인'}
                    </p>
                    <p class="text-sm text-gray-500">
                      마지막 동기화: ${status.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString('ko-KR') : '없음'}
                    </p>
                  </div>
                </div>
                ${status.isOnline && status.pending > 0 ? `
                  <button onclick="offline.manualSync()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center">
                    <i class="fas fa-sync-alt mr-2"></i>지금 동기화
                  </button>
                ` : ''}
              </div>

              <!-- 통계 카드 -->
              <div class="grid grid-cols-3 gap-4 mb-6">
                <div class="bg-blue-50 p-4 rounded-lg text-center">
                  <p class="text-3xl font-bold text-blue-600">${status.pending}</p>
                  <p class="text-sm text-gray-600">대기중</p>
                </div>
                <div class="bg-red-50 p-4 rounded-lg text-center">
                  <p class="text-3xl font-bold text-red-600">${status.conflicts}</p>
                  <p class="text-sm text-gray-600">충돌</p>
                </div>
                <div class="bg-yellow-50 p-4 rounded-lg text-center">
                  <p class="text-3xl font-bold text-yellow-600">${status.failed}</p>
                  <p class="text-sm text-gray-600">실패</p>
                </div>
              </div>

              <!-- 충돌 목록 -->
              ${status.conflicts > 0 ? `
                <div class="mb-6">
                  <h3 class="font-semibold text-gray-700 mb-3 flex items-center">
                    <i class="fas fa-exclamation-triangle text-red-500 mr-2"></i>
                    충돌 항목 (${status.conflicts}개)
                  </h3>
                  <div class="space-y-2">
                    ${status.conflictDetails.map(c => `
                      <div class="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                        <div>
                          <p class="font-medium text-red-700">${c.type}</p>
                          <p class="text-xs text-gray-500">${c.endpoint}</p>
                        </div>
                        <button onclick="offline.showConflictResolver(${c.id})" class="text-red-600 hover:text-red-800 text-sm">
                          해결하기 <i class="fas fa-chevron-right ml-1"></i>
                        </button>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- 타입별 대기 -->
              ${Object.keys(status.pendingByType).length > 0 ? `
                <div class="mb-6">
                  <h3 class="font-semibold text-gray-700 mb-3">대기중인 변경사항</h3>
                  <div class="flex flex-wrap gap-2">
                    ${Object.entries(status.pendingByType).map(([type, count]) => `
                      <span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                        ${type}: ${count}
                      </span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- 캐시 통계 -->
              <div class="mb-6">
                <h3 class="font-semibold text-gray-700 mb-3 flex items-center">
                  <i class="fas fa-database text-gray-500 mr-2"></i>
                  캐시 통계
                </h3>
                <div class="bg-gray-50 p-4 rounded-lg">
                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p class="text-gray-500">총 캐시 항목</p>
                      <p class="font-semibold">${cacheStats.totalItems}</p>
                    </div>
                    <div>
                      <p class="text-gray-500">캐시 크기</p>
                      <p class="font-semibold">${cacheStats.totalSizeMB} MB</p>
                    </div>
                    <div>
                      <p class="text-gray-500">만료된 항목</p>
                      <p class="font-semibold text-yellow-600">${cacheStats.expired}</p>
                    </div>
                    <div>
                      <p class="text-gray-500">타입별</p>
                      <p class="font-semibold text-xs">${Object.entries(cacheStats.byType).map(([k, v]) => `${k}(${v})`).join(', ') || '없음'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 최근 동기화 로그 -->
              <div>
                <h3 class="font-semibold text-gray-700 mb-3 flex items-center">
                  <i class="fas fa-history text-gray-500 mr-2"></i>
                  최근 동기화 이력
                </h3>
                <div class="bg-gray-50 rounded-lg max-h-48 overflow-y-auto">
                  ${status.recentLogs.length > 0 ? `
                    <table class="w-full text-sm">
                      <tbody>
                        ${status.recentLogs.slice(0, 10).map(log => `
                          <tr class="border-b border-gray-200">
                            <td class="p-2">
                              <i class="fas ${log.status === 'success' ? 'fa-check text-green-500' : log.status === 'failed' ? 'fa-times text-red-500' : 'fa-info-circle text-blue-500'}"></i>
                            </td>
                            <td class="p-2 text-gray-700">${log.changeType}</td>
                            <td class="p-2 text-gray-500 text-xs">${new Date(log.timestamp).toLocaleString('ko-KR')}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  ` : '<p class="p-4 text-gray-500 text-center">동기화 이력이 없습니다.</p>'}
                </div>
              </div>

              <!-- 작업 버튼 -->
              <div class="mt-6 flex justify-between">
                <div class="space-x-2">
                  ${status.failed > 0 ? `
                    <button onclick="offline.retryFailed()" class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm">
                      <i class="fas fa-redo mr-1"></i>실패 재시도
                    </button>
                  ` : ''}
                  <button onclick="offline.cleanupCache()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">
                    <i class="fas fa-broom mr-1"></i>캐시 정리
                  </button>
                </div>
                ${state.currentStudy ? `
                  <button onclick="offline.prefetchStudyData('${state.currentStudy.id}')" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm">
                    <i class="fas fa-download mr-1"></i>오프라인 데이터 다운로드
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        modal.onclick = (e) => {
          if (e.target === modal) modal.remove();
        };
      } catch (error) {
        console.error('Failed to show sync dashboard:', error);
        showToast('동기화 상태를 불러올 수 없습니다.', 'error');
      }
    },

    // 충돌 해결 모달
    async showConflictResolver(changeId) {
      if (!window.eCRFOfflineDB) return;

      const conflicts = await window.eCRFOfflineDB.getConflicts();
      const conflict = conflicts.find(c => c.id === changeId);
      if (!conflict) {
        showToast('충돌 항목을 찾을 수 없습니다.', 'error');
        return;
      }

      const modal = document.createElement('div');
      modal.id = 'conflict-resolver-modal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110]';
      modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
          <div class="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4 flex items-center justify-between">
            <h2 class="text-xl font-bold text-white flex items-center">
              <i class="fas fa-exclamation-triangle mr-3"></i>
              데이터 충돌 해결
            </h2>
            <button onclick="document.getElementById('conflict-resolver-modal').remove()" class="text-white hover:text-gray-200">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
          
          <div class="p-6">
            <p class="text-gray-600 mb-4">
              동일한 데이터가 로컬과 서버에서 다르게 변경되었습니다. 어떤 버전을 사용할지 선택하세요.
            </p>

            <div class="grid grid-cols-2 gap-6 mb-6">
              <!-- 로컬 데이터 -->
              <div class="border-2 border-blue-300 rounded-lg p-4">
                <h3 class="font-semibold text-blue-700 mb-2 flex items-center">
                  <i class="fas fa-laptop mr-2"></i>
                  로컬 데이터
                </h3>
                <p class="text-xs text-gray-500 mb-2">저장 시간: ${new Date(conflict.timestamp).toLocaleString('ko-KR')}</p>
                <pre class="bg-gray-100 p-3 rounded text-xs overflow-auto max-h-48">${JSON.stringify(conflict.data, null, 2)}</pre>
              </div>

              <!-- 서버 데이터 -->
              <div class="border-2 border-green-300 rounded-lg p-4">
                <h3 class="font-semibold text-green-700 mb-2 flex items-center">
                  <i class="fas fa-server mr-2"></i>
                  서버 데이터
                </h3>
                <p class="text-xs text-gray-500 mb-2">충돌 감지: ${new Date(conflict.conflict?.detectedAt).toLocaleString('ko-KR')}</p>
                <pre class="bg-gray-100 p-3 rounded text-xs overflow-auto max-h-48">${JSON.stringify(conflict.conflict?.serverData, null, 2)}</pre>
              </div>
            </div>

            <div class="flex justify-center space-x-4">
              <button onclick="offline.resolveConflict(${changeId}, 'local')" class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center">
                <i class="fas fa-laptop mr-2"></i>
                로컬 데이터 사용
              </button>
              <button onclick="offline.resolveConflict(${changeId}, 'server')" class="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg flex items-center">
                <i class="fas fa-server mr-2"></i>
                서버 데이터 사용
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    },

    // 수동 동기화
    async manualSync() {
      if (!window.eCRFOfflineDB) return;
      
      showToast('동기화 중...', 'info');
      const result = await window.eCRFOfflineDB.syncWithServer();
      
      if (result.synced > 0) {
        showToast(`${result.synced}개 항목 동기화 완료`, 'success');
      }
      if (result.failed > 0) {
        showToast(`${result.failed}개 항목 동기화 실패`, 'error');
      }
      
      // 대시보드 새로고침
      const modal = document.getElementById('sync-dashboard-modal');
      if (modal) {
        modal.remove();
        this.showSyncDashboard();
      }
    },

    // 실패한 항목 재시도
    async retryFailed() {
      if (!window.eCRFOfflineDB) return;

      const result = await window.eCRFOfflineDB.retryFailed();
      showToast(`${result.retried}개 항목 재시도 예약됨`, 'info');
      
      // 대시보드 새로고침
      setTimeout(() => {
        const modal = document.getElementById('sync-dashboard-modal');
        if (modal) {
          modal.remove();
          this.showSyncDashboard();
        }
      }, 500);
    },

    // 충돌 해결
    async resolveConflict(changeId, resolution) {
      if (!window.eCRFOfflineDB) return;

      try {
        await window.eCRFOfflineDB.resolveConflict(changeId, resolution);
        showToast('충돌이 해결되었습니다.', 'success');
        
        document.getElementById('conflict-resolver-modal')?.remove();
        
        // 동기화 대시보드 새로고침
        const syncModal = document.getElementById('sync-dashboard-modal');
        if (syncModal) {
          syncModal.remove();
          this.showSyncDashboard();
        }

        // 로컬 우선인 경우 즉시 동기화 시도
        if (resolution === 'local' && state.isOnline) {
          window.eCRFOfflineDB.syncWithServer();
        }
      } catch (error) {
        showToast('충돌 해결에 실패했습니다.', 'error');
      }
    },

    // 캐시 정리
    async cleanupCache() {
      if (!window.eCRFOfflineDB) return;

      const expired = await window.eCRFOfflineDB.cleanupExpiredCache();
      const logs = await window.eCRFOfflineDB.cleanupSyncLogs(7);
      
      showToast(`${expired.deleted + logs.deleted}개 항목 정리됨`, 'success');
      
      // 대시보드 새로고침
      const modal = document.getElementById('sync-dashboard-modal');
      if (modal) {
        modal.remove();
        this.showSyncDashboard();
      }
    },

    // 스터디 데이터 프리페치
    async prefetchStudyData(studyId) {
      if (!window.eCRFOfflineDB) return;
      
      showToast('오프라인 데이터 다운로드 중...', 'info');
      
      const result = await window.eCRFOfflineDB.prefetchCRFData(studyId);
      
      if (result.errors?.length > 0) {
        showToast(`${result.cached}개 캐시됨, ${result.errors.length}개 오류`, 'warning');
      } else {
        showToast(`${result.cached}개 항목이 오프라인 사용 가능`, 'success');
      }
    }
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
          logout(false);
          showToast('세션이 만료되었습니다. 다시 로그인해주세요.', 'error');
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
        COMPLETE: '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">완료</span>',
        LOCKED: '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">잠김</span>',
        FROZEN: '<span class="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">동결</span>',
        CANCELLED: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">취소</span>',
        PENDING: '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">대기중</span>',
        CLOSED: '<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">종료</span>',
        SCREENING: '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">스크리닝</span>',
        ENROLLED: '<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">등록</span>',
        RANDOMIZED: '<span class="px-2 py-1 bg-teal-100 text-teal-700 rounded text-xs font-medium">무작위배정</span>',
        WITHDRAWN: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">중도탈락</span>',
        SCREEN_FAILED: '<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">스크리닝실패</span>',
        SCHEDULED: '<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">예정</span>',
        IN_PROGRESS: '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">진행중</span>',
        MISSED: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">미실시</span>',
        SIGNED: '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">서명완료</span>',
        OPEN: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">미결</span>',
        ANSWERED: '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">답변됨</span>',
      };
      return badges[status] || `<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">${status}</span>`;
    },

    getPriorityBadge(priority) {
      const badges = {
        CRITICAL: '<span class="px-2 py-1 bg-red-500 text-white rounded text-xs font-medium">Critical</span>',
        MAJOR: '<span class="px-2 py-1 bg-orange-500 text-white rounded text-xs font-medium">Major</span>',
        MINOR: '<span class="px-2 py-1 bg-blue-500 text-white rounded text-xs font-medium">Minor</span>',
      };
      return badges[priority] || priority;
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

    canWrite() {
      return state.user && ['ADMIN', 'PI', 'SUB_INV', 'CRC', 'DM'].includes(state.user.role);
    },

    canSign() {
      return state.user && ['PI', 'SUB_INV', 'CRC', 'DM'].includes(state.user.role);
    },

    canManage() {
      return state.user && ['ADMIN', 'DM'].includes(state.user.role);
    },
  };

  // =====================================================
  // TOAST NOTIFICATIONS
  // =====================================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500',
    };
    
    toast.className = `${bgColors[type]} text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-2 transform transition-all duration-300 translate-x-full`;
    toast.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
      <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.remove('translate-x-full'), 10);
    setTimeout(() => {
      toast.classList.add('translate-x-full');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-4 right-4 z-50 space-y-2';
    document.body.appendChild(container);
    return container;
  }

  // =====================================================
  // MODAL DIALOGS
  // =====================================================
  function showModal(title, content, actions = []) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.id = 'modal-overlay';
    
    overlay.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900">${title}</h3>
          <button class="text-gray-400 hover:text-gray-600" onclick="closeModal()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="px-6 py-4">${content}</div>
        ${actions.length > 0 ? `
          <div class="px-6 py-4 border-t bg-gray-50 flex justify-end space-x-2">
            ${actions.map(a => `
              <button class="${a.class || 'bg-gray-200 text-gray-700 hover:bg-gray-300'} px-4 py-2 rounded-lg transition" 
                      onclick="${a.onclick}">${a.label}</button>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  function closeModal() {
    const modal = document.getElementById('modal-overlay');
    if (modal) modal.remove();
  }
  window.closeModal = closeModal;

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
        navigateTo('dashboard');
        showToast('로그인 성공!', 'success');
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
    showToast('로그아웃 되었습니다.', 'info');
  }

  function updateAuthUI() {
    const authSection = document.getElementById('auth-section');
    
    if (state.token && state.user) {
      ui.hide('#login-section');
      ui.show('#dashboard-section');
      
      authSection.innerHTML = `
        <span class="text-sm text-gray-600 hidden md:inline">
          <i class="fas fa-user-circle mr-1"></i>
          ${state.user.name} (${ui.getRoleName(state.user.role)})
        </span>
        <button id="btn-logout" class="text-sm text-gray-600 hover:text-red-600 transition">
          <i class="fas fa-sign-out-alt mr-1"></i> 로그아웃
        </button>
      `;
      
      document.getElementById('btn-logout').addEventListener('click', () => logout());
      
      ui.setText('#user-name', state.user.name);
      ui.setText('#user-role', ui.getRoleName(state.user.role));
      ui.setText('#user-initials', ui.getInitials(state.user.name));
      
      if (ui.canManage()) {
        ui.show('#btn-new-study');
      }
    } else {
      ui.show('#login-section');
      ui.hide('#dashboard-section');
      authSection.innerHTML = '';
    }
  }

  // =====================================================
  // NAVIGATION
  // =====================================================
  function navigateTo(view, params = {}) {
    state.currentView = view;
    
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    // Update breadcrumb
    updateBreadcrumb(view, params);
    
    switch (view) {
      case 'dashboard':
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
      case 'crf':
        loadCRFForm(params.visitId, params.formCode);
        break;
      case 'queries':
        loadQueriesList(params);
        break;
      default:
        loadDashboard();
    }
  }

  function updateBreadcrumb(view, params) {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;

    let crumbs = [{ label: '홈', view: 'dashboard' }];
    
    if (view === 'study' || view === 'site' || view === 'subject' || view === 'visit' || view === 'crf') {
      if (state.currentStudy) {
        crumbs.push({ label: state.currentStudy.protocol_number, view: 'study', params: { studyId: state.currentStudy.id } });
      }
    }
    
    if (view === 'site' || view === 'subject' || view === 'visit' || view === 'crf') {
      if (state.currentSite) {
        crumbs.push({ label: `Site ${state.currentSite.site_number}`, view: 'site', params: { siteId: state.currentSite.id } });
      }
    }
    
    if (view === 'subject' || view === 'visit' || view === 'crf') {
      if (state.currentSubject) {
        crumbs.push({ label: state.currentSubject.subject_number, view: 'subject', params: { subjectId: state.currentSubject.id } });
      }
    }
    
    if (view === 'visit' || view === 'crf') {
      if (state.currentVisit) {
        crumbs.push({ label: state.currentVisit.visit_name, view: 'visit', params: { visitId: state.currentVisit.id } });
      }
    }

    breadcrumb.innerHTML = crumbs.map((c, i) => `
      ${i > 0 ? '<i class="fas fa-chevron-right text-gray-400 mx-2"></i>' : ''}
      <button class="text-sm ${i === crumbs.length - 1 ? 'text-gray-900 font-medium' : 'text-ecrf-blue hover:underline'}"
              onclick="navigateTo('${c.view}'${c.params ? `, ${JSON.stringify(c.params)}` : ''})">
        ${c.label}
      </button>
    `).join('');
  }
  window.navigateTo = navigateTo;

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
      <!-- User Info -->
      <div class="mb-6 bg-white rounded-lg shadow p-4">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center">
            <div class="w-12 h-12 bg-ecrf-blue rounded-full flex items-center justify-center text-white text-lg font-bold">
              <span id="user-initials">${ui.getInitials(state.user?.name)}</span>
            </div>
            <div class="ml-4">
              <h3 id="user-name" class="font-semibold text-gray-900">${state.user?.name || '사용자'}</h3>
              <p id="user-role" class="text-sm text-gray-500">${ui.getRoleName(state.user?.role)}</p>
            </div>
          </div>
          <div class="text-sm text-gray-500">
            <span><i class="fas fa-clock mr-1"></i> ${ui.formatDateTime(new Date().toISOString())}</span>
          </div>
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center">
            <div class="p-3 bg-blue-100 rounded-full">
              <i class="fas fa-flask text-ecrf-blue text-xl"></i>
            </div>
            <div class="ml-4">
              <p class="text-sm text-gray-500">임상시험</p>
              <p id="stat-studies" class="text-2xl font-bold text-gray-900">-</p>
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
              <p id="stat-sites" class="text-2xl font-bold text-gray-900">-</p>
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
              <p id="stat-subjects" class="text-2xl font-bold text-gray-900">-</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-md transition" onclick="navigateTo('queries')">
          <div class="flex items-center">
            <div class="p-3 bg-yellow-100 rounded-full">
              <i class="fas fa-question-circle text-ecrf-yellow text-xl"></i>
            </div>
            <div class="ml-4">
              <p class="text-sm text-gray-500">미결 Query</p>
              <p id="stat-queries" class="text-2xl font-bold text-gray-900">-</p>
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
          ${ui.canManage() ? `
            <button id="btn-new-study" onclick="showNewStudyModal()" class="bg-ecrf-blue text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
              <i class="fas fa-plus mr-1"></i> 새 임상시험
            </button>
          ` : ''}
        </div>
        <div id="studies-list" class="divide-y">
          <div class="p-8 text-center text-gray-500">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>데이터를 불러오는 중...</p>
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
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-2xl mb-2"></i>
          <p>데이터를 불러오는데 실패했습니다.</p>
        </div>
      `);
    }
  }

  function renderStudiesList() {
    const container = document.getElementById('studies-list');
    if (!container) return;
    
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
      <div class="p-4 hover:bg-gray-50 transition cursor-pointer" onclick="navigateTo('study', {studyId: '${study.id}'})">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center flex-wrap gap-2">
              <h3 class="font-semibold text-gray-900">${study.protocol_number}</h3>
              ${ui.getStatusBadge(study.status)}
              ${study.phase ? `<span class="text-xs text-gray-500">Phase ${study.phase}</span>` : ''}
            </div>
            <p class="text-sm text-gray-600 mt-1 line-clamp-1">${study.title}</p>
            <div class="flex items-center mt-2 text-xs text-gray-500 flex-wrap gap-x-4 gap-y-1">
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
  }

  async function loadDashboardStats() {
    ui.setText('#stat-studies', state.studies.length.toString());
    
    // Load additional stats for first study if available
    if (state.studies.length > 0) {
      try {
        let totalSites = 0;
        let totalSubjects = 0;
        let totalQueries = 0;

        for (const study of state.studies.slice(0, 5)) { // Limit to first 5 studies
          const stats = await api.get(`/studies/${study.id}/stats`);
          if (stats.success) {
            totalSites += (stats.data.sites || []).reduce((sum, s) => sum + s.count, 0);
            totalSubjects += (stats.data.subjects || []).reduce((sum, s) => sum + s.count, 0);
            const openQueries = (stats.data.queries || []).find(q => q.status === 'OPEN');
            totalQueries += openQueries?.count || 0;
          }
        }

        ui.setText('#stat-sites', totalSites.toString());
        ui.setText('#stat-subjects', totalSubjects.toString());
        ui.setText('#stat-queries', totalQueries.toString());
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
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>Study 정보를 불러오는 중...</p>
      </div>
    `;

    try {
      const result = await api.get(`/studies/${studyId}`);
      if (!result.success) throw new Error(result.error);

      state.currentStudy = result.data;
      const study = result.data;

      // Load sites
      const sitesResult = await api.get(`/studies/${studyId}/sites`);
      const sites = sitesResult.data || [];

      // Load stats
      const statsResult = await api.get(`/studies/${studyId}/stats`);
      const stats = statsResult.data || {};

      mainContent.innerHTML = `
        <!-- Study Header -->
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="px-6 py-4 border-b">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-bold text-gray-900">${study.protocol_number}</h1>
                  ${ui.getStatusBadge(study.status)}
                  ${study.phase ? `<span class="text-sm text-gray-500">Phase ${study.phase}</span>` : ''}
                </div>
                <p class="text-gray-600 mt-1">${study.title}</p>
              </div>
              <div class="flex gap-2">
                ${ui.canManage() ? `
                  <button onclick="showEditStudyModal('${study.id}')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                    <i class="fas fa-edit mr-1"></i> 수정
                  </button>
                  ${study.status !== 'LOCKED' ? `
                    <button onclick="lockStudy('${study.id}')" class="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition text-sm">
                      <i class="fas fa-lock mr-1"></i> 잠금
                    </button>
                  ` : ''}
                ` : ''}
              </div>
            </div>
          </div>
          <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-gray-500">스폰서</span>
              <p class="font-medium">${study.sponsor || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">IRB 승인번호</span>
              <p class="font-medium">${study.irb_approval_number || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">시작일</span>
              <p class="font-medium">${ui.formatDate(study.study_start_date)}</p>
            </div>
            <div>
              <span class="text-gray-500">버전</span>
              <p class="font-medium">${study.version || '1.0'}</p>
            </div>
          </div>
        </div>

        <!-- Study Stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-ecrf-blue">${study.sitesCount || 0}</p>
            <p class="text-sm text-gray-500">연구기관</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-ecrf-green">${study.subjectsCount || 0}</p>
            <p class="text-sm text-gray-500">피험자</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-purple-600">
              ${(stats.crfs || []).reduce((sum, c) => sum + c.count, 0)}
            </p>
            <p class="text-sm text-gray-500">CRF 폼</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center cursor-pointer hover:shadow-md transition" onclick="navigateTo('queries', {studyId: '${study.id}'})">
            <p class="text-3xl font-bold text-ecrf-yellow">
              ${(stats.queries || []).find(q => q.status === 'OPEN')?.count || 0}
            </p>
            <p class="text-sm text-gray-500">미결 Query</p>
          </div>
        </div>

        <!-- Tabs -->
        <div class="bg-white rounded-lg shadow">
          <div class="border-b">
            <div class="flex">
              <button class="px-6 py-3 text-sm font-medium text-ecrf-blue border-b-2 border-ecrf-blue" data-tab="sites">
                <i class="fas fa-hospital mr-1"></i> 연구기관 (${sites.length})
              </button>
              <button class="px-6 py-3 text-sm font-medium text-gray-500 hover:text-gray-700" data-tab="visits" onclick="showStudyTab('visits')">
                <i class="fas fa-calendar-alt mr-1"></i> 방문 일정 (${study.visitSchedules?.length || 0})
              </button>
              <button class="px-6 py-3 text-sm font-medium text-gray-500 hover:text-gray-700" data-tab="forms" onclick="showStudyTab('forms')">
                <i class="fas fa-file-alt mr-1"></i> CRF 양식 (${study.formDefinitions?.length || 0})
              </button>
            </div>
          </div>
          
          <!-- Sites Tab -->
          <div id="tab-sites" class="p-4">
            <div class="flex justify-between items-center mb-4">
              <h3 class="font-semibold text-gray-900">연구기관 목록</h3>
              ${ui.canManage() ? `
                <button onclick="showNewSiteModal('${study.id}')" class="px-3 py-1.5 bg-ecrf-blue text-white rounded text-sm hover:bg-blue-700 transition">
                  <i class="fas fa-plus mr-1"></i> 기관 추가
                </button>
              ` : ''}
            </div>
            ${sites.length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-hospital text-3xl mb-2"></i>
                <p>등록된 연구기관이 없습니다.</p>
              </div>
            ` : `
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">기관번호</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">기관명</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">PI</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">상태</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">피험자</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    ${sites.map(site => `
                      <tr class="hover:bg-gray-50 cursor-pointer" onclick="navigateTo('site', {siteId: '${site.id}'})">
                        <td class="px-4 py-3 font-medium">${site.site_number}</td>
                        <td class="px-4 py-3">${site.name}</td>
                        <td class="px-4 py-3">${site.pi_name || '-'}</td>
                        <td class="px-4 py-3">${ui.getStatusBadge(site.status)}</td>
                        <td class="px-4 py-3">${site.subject_count || 0}명</td>
                        <td class="px-4 py-3 text-gray-400"><i class="fas fa-chevron-right"></i></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- Visit Schedule Tab (hidden by default) -->
          <div id="tab-visits" class="p-4 hidden">
            <h3 class="font-semibold text-gray-900 mb-4">방문 일정</h3>
            ${(study.visitSchedules || []).length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-calendar-alt text-3xl mb-2"></i>
                <p>정의된 방문 일정이 없습니다.</p>
              </div>
            ` : `
              <div class="space-y-2">
                ${(study.visitSchedules || []).map(vs => `
                  <div class="flex items-center p-3 bg-gray-50 rounded-lg">
                    <div class="w-10 h-10 bg-ecrf-blue text-white rounded-full flex items-center justify-center font-bold mr-4">
                      ${vs.visit_number}
                    </div>
                    <div class="flex-1">
                      <h4 class="font-medium text-gray-900">${vs.visit_name}</h4>
                      <p class="text-sm text-gray-500">
                        Target Day ${vs.target_day || 0} 
                        (허용: -${vs.visit_window_before || 0} ~ +${vs.visit_window_after || 0}일)
                        ${vs.is_required ? '<span class="text-red-500 ml-2">* 필수</span>' : ''}
                      </p>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Form Definitions Tab (hidden by default) -->
          <div id="tab-forms" class="p-4 hidden">
            <h3 class="font-semibold text-gray-900 mb-4">CRF 양식 정의</h3>
            ${(study.formDefinitions || []).length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-file-alt text-3xl mb-2"></i>
                <p>정의된 CRF 양식이 없습니다.</p>
              </div>
            ` : `
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${(study.formDefinitions || []).map(fd => `
                  <div class="p-4 border rounded-lg hover:shadow-md transition">
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-medium text-gray-900">${fd.form_code}</span>
                      ${fd.is_required ? '<span class="text-xs text-red-500">필수</span>' : ''}
                    </div>
                    <p class="text-sm text-gray-600">${fd.form_name}</p>
                    <p class="text-xs text-gray-400 mt-2">${fd.description || ''}</p>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;

      // Tab switching
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => showStudyTab(btn.dataset.tab));
      });

    } catch (error) {
      console.error('Failed to load study:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>Study 정보를 불러오는데 실패했습니다.</p>
          <button onclick="navigateTo('dashboard')" class="mt-4 text-ecrf-blue hover:underline">
            <i class="fas fa-arrow-left mr-1"></i> 대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  function showStudyTab(tabName) {
    document.querySelectorAll('[id^="tab-"]').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.classList.remove('text-ecrf-blue', 'border-b-2', 'border-ecrf-blue');
      btn.classList.add('text-gray-500');
    });
    
    const tabEl = document.getElementById(`tab-${tabName}`);
    const btnEl = document.querySelector(`[data-tab="${tabName}"]`);
    
    if (tabEl) tabEl.classList.remove('hidden');
    if (btnEl) {
      btnEl.classList.remove('text-gray-500');
      btnEl.classList.add('text-ecrf-blue', 'border-b-2', 'border-ecrf-blue');
    }
  }
  window.showStudyTab = showStudyTab;

  // =====================================================
  // SITE DETAIL
  // =====================================================
  async function loadSiteDetail(siteId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>Site 정보를 불러오는 중...</p>
      </div>
    `;

    try {
      const result = await api.get(`/sites/${siteId}`);
      if (!result.success) throw new Error(result.error);

      state.currentSite = result.data;
      const site = result.data;

      // Update study context
      if (site.study_id && (!state.currentStudy || state.currentStudy.id !== site.study_id)) {
        const studyResult = await api.get(`/studies/${site.study_id}`);
        state.currentStudy = studyResult.data;
      }

      // Load subjects
      const subjectsResult = await api.get(`/sites/${siteId}/subjects`);
      const subjects = subjectsResult.data || [];

      mainContent.innerHTML = `
        <!-- Site Header -->
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="px-6 py-4 border-b">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-bold text-gray-900">Site ${site.site_number}</h1>
                  ${ui.getStatusBadge(site.status)}
                </div>
                <p class="text-gray-600 mt-1">${site.name}</p>
              </div>
              <div class="flex gap-2">
                ${ui.canManage() ? `
                  <button onclick="showEditSiteModal('${site.id}')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                    <i class="fas fa-edit mr-1"></i> 수정
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-gray-500">PI</span>
              <p class="font-medium">${site.pi_name || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">이메일</span>
              <p class="font-medium">${site.pi_email || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">주소</span>
              <p class="font-medium">${site.address || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">등록된 피험자</span>
              <p class="font-medium">${subjects.length}명</p>
            </div>
          </div>
        </div>

        <!-- Subjects List -->
        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-users mr-2"></i> 피험자 목록
            </h2>
            ${ui.canWrite() && site.status === 'ACTIVE' ? `
              <button onclick="showNewSubjectModal('${site.id}')" class="px-4 py-2 bg-ecrf-blue text-white rounded-lg hover:bg-blue-700 transition text-sm">
                <i class="fas fa-user-plus mr-1"></i> 피험자 등록
              </button>
            ` : ''}
          </div>
          <div class="p-4">
            ${subjects.length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-users text-3xl mb-2"></i>
                <p>등록된 피험자가 없습니다.</p>
              </div>
            ` : `
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">Subject ID</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">Screening #</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">이니셜</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">상태</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500">등록일</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    ${subjects.map(subj => `
                      <tr class="hover:bg-gray-50 cursor-pointer" onclick="navigateTo('subject', {subjectId: '${subj.id}'})">
                        <td class="px-4 py-3 font-medium">${subj.subject_number}</td>
                        <td class="px-4 py-3">${subj.screening_number || '-'}</td>
                        <td class="px-4 py-3">${subj.initials || '-'}</td>
                        <td class="px-4 py-3">${ui.getStatusBadge(subj.status)}</td>
                        <td class="px-4 py-3">${ui.formatDate(subj.screening_date || subj.created_at)}</td>
                        <td class="px-4 py-3 text-gray-400"><i class="fas fa-chevron-right"></i></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load site:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>Site 정보를 불러오는데 실패했습니다.</p>
          <button onclick="navigateTo('dashboard')" class="mt-4 text-ecrf-blue hover:underline">
            <i class="fas fa-arrow-left mr-1"></i> 대시보드로 돌아가기
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
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>피험자 정보를 불러오는 중...</p>
      </div>
    `;

    try {
      const result = await api.get(`/subjects/${subjectId}`);
      if (!result.success) throw new Error(result.error);

      state.currentSubject = result.data;
      const subject = result.data;

      // Update context
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
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="px-6 py-4 border-b">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-bold text-gray-900">${subject.subject_number}</h1>
                  ${ui.getStatusBadge(subject.status)}
                </div>
                <p class="text-gray-600 mt-1">
                  ${subject.site_name || ''} | 
                  Screening #: ${subject.screening_number || '-'}
                  ${subject.randomization_number ? ` | Rand #: ${subject.randomization_number}` : ''}
                </p>
              </div>
              <div class="flex gap-2">
                ${ui.canWrite() && !['COMPLETED', 'WITHDRAWN', 'SCREEN_FAILED'].includes(subject.status) ? `
                  <button onclick="showWithdrawModal('${subject.id}')" class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm">
                    <i class="fas fa-user-slash mr-1"></i> 중도탈락
                  </button>
                ` : ''}
                ${ui.canWrite() ? `
                  <button onclick="showEditSubjectModal('${subject.id}')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                    <i class="fas fa-edit mr-1"></i> 수정
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-gray-500">이니셜</span>
              <p class="font-medium">${subject.initials || '-'}</p>
            </div>
            <div>
              <span class="text-gray-500">스크리닝일</span>
              <p class="font-medium">${ui.formatDate(subject.screening_date)}</p>
            </div>
            <div>
              <span class="text-gray-500">등록일</span>
              <p class="font-medium">${ui.formatDate(subject.enrolled_date)}</p>
            </div>
            <div>
              <span class="text-gray-500">무작위배정일</span>
              <p class="font-medium">${ui.formatDate(subject.randomized_date)}</p>
            </div>
          </div>
          ${subject.status === 'WITHDRAWN' ? `
            <div class="px-6 py-3 bg-red-50 border-t border-red-100">
              <p class="text-sm text-red-700">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                중도탈락: ${subject.withdrawal_reason || '사유 미기재'} 
                (${ui.formatDate(subject.withdrawn_date)})
              </p>
            </div>
          ` : ''}
        </div>

        <!-- Visit Timeline -->
        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-calendar-alt mr-2"></i> 방문 일정
            </h2>
          </div>
          <div class="p-4">
            ${visits.length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-calendar-alt text-3xl mb-2"></i>
                <p>방문 일정이 없습니다.</p>
              </div>
            ` : `
              <div class="space-y-3">
                ${visits.map(visit => {
                  const crfStats = visit.crfStats || [];
                  const totalCRF = crfStats.reduce((sum, s) => sum + s.count, 0);
                  const completedCRF = crfStats.filter(s => ['COMPLETE', 'SIGNED', 'LOCKED'].includes(s.status)).reduce((sum, s) => sum + s.count, 0);
                  const progress = totalCRF > 0 ? Math.round((completedCRF / totalCRF) * 100) : 0;
                  
                  return `
                    <div class="flex items-center p-4 border rounded-lg hover:shadow-md cursor-pointer transition"
                         onclick="navigateTo('visit', {visitId: '${visit.id}'})">
                      <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center font-bold text-gray-600 mr-4">
                        V${visit.visit_number}
                      </div>
                      <div class="flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                          <h4 class="font-medium text-gray-900">${visit.visit_name}</h4>
                          ${ui.getStatusBadge(visit.status)}
                        </div>
                        <div class="flex items-center gap-4 mt-1 text-sm text-gray-500">
                          <span><i class="fas fa-calendar mr-1"></i> ${ui.formatDate(visit.actual_date || visit.scheduled_date)}</span>
                          <span><i class="fas fa-file-alt mr-1"></i> CRF ${completedCRF}/${totalCRF}</span>
                        </div>
                        ${totalCRF > 0 ? `
                          <div class="mt-2 w-full bg-gray-200 rounded-full h-2">
                            <div class="bg-ecrf-green h-2 rounded-full" style="width: ${progress}%"></div>
                          </div>
                        ` : ''}
                      </div>
                      <div class="ml-4">
                        <i class="fas fa-chevron-right text-gray-400"></i>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load subject:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>피험자 정보를 불러오는데 실패했습니다.</p>
          <button onclick="navigateTo('dashboard')" class="mt-4 text-ecrf-blue hover:underline">
            <i class="fas fa-arrow-left mr-1"></i> 대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  // =====================================================
  // VISIT DETAIL
  // =====================================================
  async function loadVisitDetail(visitId) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>방문 정보를 불러오는 중...</p>
      </div>
    `;

    try {
      const result = await api.get(`/visits/${visitId}`);
      if (!result.success) throw new Error(result.error);

      state.currentVisit = result.data;
      const visit = result.data;

      // Update context
      if (visit.subject_id && (!state.currentSubject || state.currentSubject.id !== visit.subject_id)) {
        const subjectResult = await api.get(`/subjects/${visit.subject_id}`);
        state.currentSubject = subjectResult.data;
        
        if (state.currentSubject.site_id) {
          const siteResult = await api.get(`/sites/${state.currentSubject.site_id}`);
          state.currentSite = siteResult.data;
        }
        if (state.currentSubject.study_id) {
          const studyResult = await api.get(`/studies/${state.currentSubject.study_id}`);
          state.currentStudy = studyResult.data;
        }
      }

      const crfInstances = visit.crfInstances || [];
      const availableForms = visit.availableForms || [];

      mainContent.innerHTML = `
        <!-- Visit Header -->
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="px-6 py-4 border-b">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-bold text-gray-900">${visit.visit_name}</h1>
                  ${ui.getStatusBadge(visit.status)}
                </div>
                <p class="text-gray-600 mt-1">
                  Visit ${visit.visit_number} | ${visit.subject_number || state.currentSubject?.subject_number || ''}
                </p>
              </div>
              ${ui.canWrite() ? `
                <button onclick="showEditVisitModal('${visit.id}')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                  <i class="fas fa-edit mr-1"></i> 방문 정보 수정
                </button>
              ` : ''}
            </div>
          </div>
          <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-gray-500">예정일</span>
              <p class="font-medium">${ui.formatDate(visit.scheduled_date)}</p>
            </div>
            <div>
              <span class="text-gray-500">실제 방문일</span>
              <p class="font-medium">${ui.formatDate(visit.actual_date)}</p>
            </div>
            <div>
              <span class="text-gray-500">CRF 완료</span>
              <p class="font-medium">
                ${crfInstances.filter(c => ['COMPLETE', 'SIGNED', 'LOCKED'].includes(c.status)).length} / ${crfInstances.length}
              </p>
            </div>
            <div>
              <span class="text-gray-500">미결 Query</span>
              <p class="font-medium text-ecrf-yellow">
                ${crfInstances.reduce((sum, c) => sum + (c.queries?.filter(q => q.status === 'OPEN').length || 0), 0)}건
              </p>
            </div>
          </div>
        </div>

        <!-- CRF Forms -->
        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-file-alt mr-2"></i> CRF 양식
            </h2>
          </div>
          <div class="p-4">
            ${crfInstances.length === 0 && availableForms.length === 0 ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-file-alt text-3xl mb-2"></i>
                <p>사용 가능한 CRF 양식이 없습니다.</p>
              </div>
            ` : `
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${crfInstances.map(crf => {
                  const openQueries = (crf.queries || []).filter(q => q.status === 'OPEN').length;
                  return `
                    <div class="p-4 border rounded-lg hover:shadow-md cursor-pointer transition relative"
                         onclick="navigateTo('crf', {visitId: '${visit.id}', formCode: '${crf.form_code}'})">
                      ${openQueries > 0 ? `
                        <div class="absolute -top-2 -right-2 w-6 h-6 bg-ecrf-yellow text-white text-xs rounded-full flex items-center justify-center font-bold">
                          ${openQueries}
                        </div>
                      ` : ''}
                      <div class="flex items-center justify-between mb-2">
                        <span class="font-medium text-gray-900">${crf.form_code}</span>
                        ${ui.getStatusBadge(crf.status)}
                      </div>
                      <p class="text-sm text-gray-600">${crf.form_name}</p>
                      <div class="mt-2 text-xs text-gray-400">
                        ${crf.data_entry_at ? `최종 수정: ${ui.formatDateTime(crf.data_entry_at)}` : '미입력'}
                      </div>
                    </div>
                  `;
                }).join('')}
                ${availableForms.filter(f => !crfInstances.find(c => c.form_code === f.form_code)).map(form => `
                  <div class="p-4 border border-dashed rounded-lg hover:shadow-md cursor-pointer transition bg-gray-50"
                       onclick="navigateTo('crf', {visitId: '${visit.id}', formCode: '${form.form_code}'})">
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-medium text-gray-500">${form.form_code}</span>
                      <span class="text-xs text-gray-400">미작성</span>
                    </div>
                    <p class="text-sm text-gray-500">${form.form_name}</p>
                    <div class="mt-2 text-xs text-ecrf-blue">
                      <i class="fas fa-plus-circle mr-1"></i> 작성 시작
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load visit:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>방문 정보를 불러오는데 실패했습니다.</p>
          <button onclick="navigateTo('dashboard')" class="mt-4 text-ecrf-blue hover:underline">
            <i class="fas fa-arrow-left mr-1"></i> 대시보드로 돌아가기
          </button>
        </div>
      `;
    }
  }

  // =====================================================
  // CRF FORM
  // =====================================================
  async function loadCRFForm(visitId, formCode) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>CRF 양식을 불러오는 중...</p>
      </div>
    `;

    try {
      // Get visit with CRF data
      const visitResult = await api.get(`/visits/${visitId}`);
      if (!visitResult.success) throw new Error(visitResult.error);

      state.currentVisit = visitResult.data;
      const visit = visitResult.data;

      // Update context
      if (!state.currentSubject || state.currentSubject.id !== visit.subject_id) {
        const subjectResult = await api.get(`/subjects/${visit.subject_id}`);
        state.currentSubject = subjectResult.data;
      }

      // Find CRF instance or form definition
      let crfInstance = (visit.crfInstances || []).find(c => c.form_code === formCode);
      let formDef = (visit.availableForms || []).find(f => f.form_code === formCode);
      
      if (!crfInstance && !formDef) {
        throw new Error('CRF 양식을 찾을 수 없습니다.');
      }

      const crfData = crfInstance?.data || [];
      const queries = crfInstance?.queries || [];
      const isLocked = crfInstance && ['LOCKED', 'FROZEN', 'SIGNED'].includes(crfInstance.status);
      const canEdit = ui.canWrite() && !isLocked;

      // Get field definitions
      let fields = [];
      if (formDef?.id) {
        // TODO: Fetch field definitions from API
        // For now, create demo fields based on form type
        fields = getDefaultFieldsForForm(formCode);
      }

      state.currentCRF = { crfInstance, formDef, formCode, visitId, fields };

      mainContent.innerHTML = `
        <!-- CRF Header -->
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="px-6 py-4 border-b">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-xl font-bold text-gray-900">${formCode}: ${crfInstance?.form_name || formDef?.form_name || formCode}</h1>
                  ${crfInstance ? ui.getStatusBadge(crfInstance.status) : '<span class="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">미작성</span>'}
                </div>
                <p class="text-gray-600 mt-1">
                  ${visit.visit_name} | ${state.currentSubject?.subject_number || ''}
                </p>
              </div>
              <div class="flex gap-2">
                ${canEdit && crfInstance ? `
                  <button onclick="completeCRF('${visitId}', '${formCode}')" class="px-4 py-2 bg-ecrf-green text-white rounded-lg hover:bg-green-700 transition text-sm">
                    <i class="fas fa-check mr-1"></i> 완료
                  </button>
                ` : ''}
                ${crfInstance && ['COMPLETE'].includes(crfInstance.status) && ui.canSign() ? `
                  <button onclick="showSignatureModal('${crfInstance.id}')" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm">
                    <i class="fas fa-signature mr-1"></i> 서명
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          ${isLocked ? `
            <div class="px-6 py-3 bg-purple-50 border-b border-purple-100">
              <p class="text-sm text-purple-700">
                <i class="fas fa-lock mr-1"></i>
                이 CRF는 잠금 상태입니다. 수정하려면 잠금 해제가 필요합니다.
              </p>
            </div>
          ` : ''}
        </div>

        <!-- Query Summary -->
        ${queries.filter(q => q.status === 'OPEN').length > 0 ? `
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h3 class="font-medium text-yellow-800 mb-2">
              <i class="fas fa-exclamation-triangle mr-1"></i>
              미결 Query ${queries.filter(q => q.status === 'OPEN').length}건
            </h3>
            <div class="space-y-2">
              ${queries.filter(q => q.status === 'OPEN').slice(0, 3).map(q => `
                <div class="text-sm text-yellow-700 flex items-center justify-between">
                  <span>${q.field_code ? `[${q.field_code}] ` : ''}${q.query_text?.substring(0, 50)}...</span>
                  <button onclick="showQueryDetailModal('${q.id}')" class="text-yellow-600 hover:underline">
                    답변하기
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- CRF Form -->
        <form id="crf-form" class="bg-white rounded-lg shadow">
          <div class="p-6">
            ${renderCRFFields(fields, crfData, canEdit)}
          </div>
          
          ${canEdit ? `
            <div class="px-6 py-4 border-t bg-gray-50 flex justify-between items-center">
              <span class="text-sm text-gray-500" id="save-status">
                <i class="fas fa-info-circle mr-1"></i> 변경사항은 자동 저장됩니다
              </span>
              <div class="flex gap-2">
                <button type="button" onclick="navigateTo('visit', {visitId: '${visitId}'})" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
                  <i class="fas fa-arrow-left mr-1"></i> 돌아가기
                </button>
                <button type="submit" class="px-4 py-2 bg-ecrf-blue text-white rounded-lg hover:bg-blue-700 transition">
                  <i class="fas fa-save mr-1"></i> 저장
                </button>
              </div>
            </div>
          ` : `
            <div class="px-6 py-4 border-t bg-gray-50">
              <button type="button" onclick="navigateTo('visit', {visitId: '${visitId}'})" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
                <i class="fas fa-arrow-left mr-1"></i> 돌아가기
              </button>
            </div>
          `}
        </form>
      `;

      // Setup form submission
      if (canEdit) {
        setupCRFFormHandlers(visitId, formCode);
      }

    } catch (error) {
      console.error('Failed to load CRF:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>CRF를 불러오는데 실패했습니다: ${error.message || error.error}</p>
          <button onclick="history.back()" class="mt-4 text-ecrf-blue hover:underline">
            <i class="fas fa-arrow-left mr-1"></i> 돌아가기
          </button>
        </div>
      `;
    }
  }

  function getDefaultFieldsForForm(formCode) {
    // Demo field definitions based on form type
    const fieldsByForm = {
      'DM': [
        { field_code: 'birth_date', field_name: '생년월일', field_type: 'DATE', is_required: true },
        { field_code: 'gender', field_name: '성별', field_type: 'SELECT', is_required: true, options: JSON.stringify([{value: 'M', label: '남성'}, {value: 'F', label: '여성'}]) },
        { field_code: 'ethnicity', field_name: '인종', field_type: 'SELECT', is_required: false, options: JSON.stringify([{value: 'ASIAN', label: '아시아인'}, {value: 'CAUCASIAN', label: '백인'}, {value: 'OTHER', label: '기타'}]) },
        { field_code: 'weight', field_name: '체중 (kg)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 30, max: 300}) },
        { field_code: 'height', field_name: '신장 (cm)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 100, max: 250}) },
        { field_code: 'bmi', field_name: 'BMI', field_type: 'CALCULATED', is_required: false, validation_rules: JSON.stringify({formula: 'weight / ((height/100) * (height/100))'}) },
      ],
      'VS': [
        { field_code: 'measurement_date', field_name: '측정일', field_type: 'DATE', is_required: true },
        { field_code: 'measurement_time', field_name: '측정시간', field_type: 'TIME', is_required: true },
        { field_code: 'systolic_bp', field_name: '수축기 혈압 (mmHg)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 80, max: 200}) },
        { field_code: 'diastolic_bp', field_name: '이완기 혈압 (mmHg)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 40, max: 120}) },
        { field_code: 'heart_rate', field_name: '맥박 (bpm)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 40, max: 200}) },
        { field_code: 'body_temp', field_name: '체온 (°C)', field_type: 'NUMBER', is_required: true, validation_rules: JSON.stringify({min: 35.0, max: 42.0, step: 0.1}) },
        { field_code: 'respiratory_rate', field_name: '호흡수 (/min)', field_type: 'NUMBER', is_required: false, validation_rules: JSON.stringify({min: 8, max: 40}) },
      ],
      'IC': [
        { field_code: 'consent_date', field_name: '동의 취득일', field_type: 'DATE', is_required: true },
        { field_code: 'consent_version', field_name: '동의서 버전', field_type: 'TEXT', is_required: true },
        { field_code: 'consent_obtained', field_name: '동의 획득 여부', field_type: 'SELECT', is_required: true, options: JSON.stringify([{value: 'Y', label: '예'}, {value: 'N', label: '아니오'}]) },
        { field_code: 'consent_notes', field_name: '비고', field_type: 'TEXTAREA', is_required: false },
      ],
      'MH': [
        { field_code: 'has_medical_history', field_name: '과거 병력 유무', field_type: 'SELECT', is_required: true, options: JSON.stringify([{value: 'Y', label: '예'}, {value: 'N', label: '아니오'}]) },
        { field_code: 'conditions', field_name: '질환명', field_type: 'TEXTAREA', is_required: false },
        { field_code: 'onset_date', field_name: '발병일', field_type: 'DATE', is_required: false },
        { field_code: 'resolution_date', field_name: '해결일', field_type: 'DATE', is_required: false },
        { field_code: 'ongoing', field_name: '현재 진행 중', field_type: 'SELECT', is_required: false, options: JSON.stringify([{value: 'Y', label: '예'}, {value: 'N', label: '아니오'}]) },
      ],
      'IE': [
        { field_code: 'meets_all_inclusion', field_name: '모든 선정기준 충족', field_type: 'SELECT', is_required: true, options: JSON.stringify([{value: 'Y', label: '예'}, {value: 'N', label: '아니오'}]) },
        { field_code: 'exclusion_criteria', field_name: '해당 제외기준', field_type: 'TEXTAREA', is_required: false },
        { field_code: 'eligible', field_name: '적격 여부', field_type: 'SELECT', is_required: true, options: JSON.stringify([{value: 'Y', label: '적격'}, {value: 'N', label: '부적격'}]) },
      ],
    };

    return fieldsByForm[formCode] || [
      { field_code: 'notes', field_name: '비고', field_type: 'TEXTAREA', is_required: false },
    ];
  }

  function renderCRFFields(fields, existingData, canEdit) {
    if (fields.length === 0) {
      return `
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-file-alt text-3xl mb-2"></i>
          <p>필드 정의가 없습니다.</p>
        </div>
      `;
    }

    const dataMap = {};
    existingData.forEach(d => {
      dataMap[d.field_code] = d;
    });

    return `
      <div class="space-y-6">
        ${fields.map(field => {
          const data = dataMap[field.field_code] || {};
          const value = data.field_value || '';
          const validation = data.validation_status || 'VALID';
          const validationClass = validation === 'ERROR' ? 'border-red-500 bg-red-50' : 
                                  validation === 'WARNING' ? 'border-yellow-500 bg-yellow-50' : '';
          
          return `
            <div class="crf-field" data-field-code="${field.field_code}">
              <label class="block text-sm font-medium text-gray-700 mb-1">
                ${field.field_name}
                ${field.is_required ? '<span class="text-red-500">*</span>' : ''}
              </label>
              ${renderFieldInput(field, value, canEdit, validationClass)}
              ${data.validation_message ? `
                <p class="mt-1 text-sm ${validation === 'ERROR' ? 'text-red-500' : 'text-yellow-600'}">
                  <i class="fas fa-${validation === 'ERROR' ? 'exclamation-circle' : 'exclamation-triangle'} mr-1"></i>
                  ${data.validation_message}
                </p>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderFieldInput(field, value, canEdit, validationClass) {
    const disabled = canEdit ? '' : 'disabled';
    const baseClass = `w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue focus:border-transparent ${validationClass}`;
    
    let options = [];
    try {
      options = field.options ? JSON.parse(field.options) : [];
    } catch (e) {}

    let rules = {};
    try {
      rules = field.validation_rules ? JSON.parse(field.validation_rules) : {};
    } catch (e) {}

    switch (field.field_type) {
      case 'TEXT':
        return `<input type="text" name="${field.field_code}" value="${value}" class="${baseClass}" ${disabled}>`;
      
      case 'NUMBER':
        return `<input type="number" name="${field.field_code}" value="${value}" 
                  min="${rules.min || ''}" max="${rules.max || ''}" step="${rules.step || '1'}"
                  class="${baseClass}" ${disabled}>`;
      
      case 'DATE':
        return `<input type="date" name="${field.field_code}" value="${value}" class="${baseClass}" ${disabled}>`;
      
      case 'TIME':
        return `<input type="time" name="${field.field_code}" value="${value}" class="${baseClass}" ${disabled}>`;
      
      case 'DATETIME':
        return `<input type="datetime-local" name="${field.field_code}" value="${value}" class="${baseClass}" ${disabled}>`;
      
      case 'SELECT':
        return `
          <select name="${field.field_code}" class="${baseClass}" ${disabled}>
            <option value="">선택하세요</option>
            ${options.map(opt => `
              <option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.label}</option>
            `).join('')}
          </select>
        `;
      
      case 'RADIO':
        return `
          <div class="flex gap-4 mt-2">
            ${options.map(opt => `
              <label class="flex items-center">
                <input type="radio" name="${field.field_code}" value="${opt.value}" 
                       ${value === opt.value ? 'checked' : ''} ${disabled}
                       class="mr-2 text-ecrf-blue focus:ring-ecrf-blue">
                ${opt.label}
              </label>
            `).join('')}
          </div>
        `;
      
      case 'CHECKBOX':
        return `
          <label class="flex items-center mt-2">
            <input type="checkbox" name="${field.field_code}" value="Y" 
                   ${value === 'Y' ? 'checked' : ''} ${disabled}
                   class="mr-2 text-ecrf-blue focus:ring-ecrf-blue rounded">
            ${field.field_name}
          </label>
        `;
      
      case 'TEXTAREA':
        return `<textarea name="${field.field_code}" rows="3" class="${baseClass}" ${disabled}>${value}</textarea>`;
      
      case 'CALCULATED':
        return `
          <input type="text" name="${field.field_code}" value="${value}" 
                 class="${baseClass} bg-gray-100" readonly disabled>
          <p class="mt-1 text-xs text-gray-400">자동 계산 필드</p>
        `;
      
      default:
        return `<input type="text" name="${field.field_code}" value="${value}" class="${baseClass}" ${disabled}>`;
    }
  }

  function setupCRFFormHandlers(visitId, formCode) {
    const form = document.getElementById('crf-form');
    if (!form) return;

    let saveTimeout;

    // Auto-save on field change
    form.querySelectorAll('input, select, textarea').forEach(input => {
      input.addEventListener('change', () => {
        clearTimeout(saveTimeout);
        document.getElementById('save-status').innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 저장 중...';
        saveTimeout = setTimeout(() => saveCRFData(visitId, formCode), CONFIG.debounceDelay);
      });
    });

    // BMI calculation
    const weightInput = form.querySelector('[name="weight"]');
    const heightInput = form.querySelector('[name="height"]');
    const bmiInput = form.querySelector('[name="bmi"]');
    
    if (weightInput && heightInput && bmiInput) {
      const calculateBMI = () => {
        const weight = parseFloat(weightInput.value);
        const height = parseFloat(heightInput.value);
        if (weight > 0 && height > 0) {
          const bmi = (weight / ((height/100) * (height/100))).toFixed(1);
          bmiInput.value = bmi;
        }
      };
      weightInput.addEventListener('change', calculateBMI);
      heightInput.addEventListener('change', calculateBMI);
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveCRFData(visitId, formCode);
    });
  }

  async function saveCRFData(visitId, formCode) {
    const form = document.getElementById('crf-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = {};
    
    formData.forEach((value, key) => {
      data[key] = value;
    });

    // Handle checkboxes
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!data[cb.name]) {
        data[cb.name] = cb.checked ? 'Y' : 'N';
      }
    });

    try {
      const result = await api.post(`/visits/${visitId}/crf`, {
        form_code: formCode,
        data: data,
      });

      if (result.success) {
        document.getElementById('save-status').innerHTML = '<i class="fas fa-check-circle text-green-500 mr-1"></i> 저장됨';
        
        // Update validation display
        if (result.data.validationResults) {
          result.data.validationResults.forEach(v => {
            const fieldEl = document.querySelector(`[data-field-code="${v.fieldCode}"]`);
            if (fieldEl) {
              const input = fieldEl.querySelector('input, select, textarea');
              if (input) {
                input.classList.remove('border-red-500', 'bg-red-50', 'border-yellow-500', 'bg-yellow-50');
                if (v.status === 'ERROR') {
                  input.classList.add('border-red-500', 'bg-red-50');
                } else if (v.status === 'WARNING') {
                  input.classList.add('border-yellow-500', 'bg-yellow-50');
                }
              }
            }
          });
        }
        
        if (result.data.hasErrors) {
          showToast('저장되었지만 오류가 있습니다. 확인해주세요.', 'warning');
        } else if (result.data.hasWarnings) {
          showToast('저장되었습니다. 경고 사항을 확인해주세요.', 'warning');
        }
      }
    } catch (error) {
      console.error('Failed to save CRF:', error);
      document.getElementById('save-status').innerHTML = '<i class="fas fa-exclamation-circle text-red-500 mr-1"></i> 저장 실패';
      showToast(error.error || '저장에 실패했습니다.', 'error');
    }
  }

  async function completeCRF(visitId, formCode) {
    if (!confirm('CRF를 완료 처리하시겠습니까?\n완료 후에는 수정이 제한됩니다.')) return;

    try {
      const result = await api.post(`/visits/${visitId}/crf/${formCode}/complete`);
      if (result.success) {
        showToast('CRF가 완료 처리되었습니다.', 'success');
        loadCRFForm(visitId, formCode);
      }
    } catch (error) {
      console.error('Failed to complete CRF:', error);
      showToast(error.error || 'CRF 완료 처리에 실패했습니다.', 'error');
    }
  }
  window.completeCRF = completeCRF;

  // =====================================================
  // QUERY LIST
  // =====================================================
  async function loadQueriesList(params = {}) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
        <p>Query 목록을 불러오는 중...</p>
      </div>
    `;

    try {
      let queryString = '?status=OPEN';
      if (params.studyId) queryString += `&studyId=${params.studyId}`;

      const result = await api.get(`/queries${queryString}`);
      const queries = result.data || [];

      mainContent.innerHTML = `
        <div class="bg-white rounded-lg shadow">
          <div class="px-6 py-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-question-circle mr-2"></i> Query 목록
            </h2>
            <div class="flex gap-2">
              <select id="query-status-filter" onchange="filterQueries()" class="text-sm border rounded px-3 py-1">
                <option value="OPEN" selected>미결</option>
                <option value="ANSWERED">답변됨</option>
                <option value="CLOSED">종료</option>
                <option value="">전체</option>
              </select>
            </div>
          </div>
          <div id="queries-list" class="divide-y">
            ${queries.length === 0 ? `
              <div class="p-8 text-center text-gray-500">
                <i class="fas fa-check-circle text-4xl mb-2 text-green-500"></i>
                <p>미결 Query가 없습니다.</p>
              </div>
            ` : queries.map(q => `
              <div class="p-4 hover:bg-gray-50 cursor-pointer" onclick="showQueryDetailModal('${q.id}')">
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2 flex-wrap mb-1">
                      ${ui.getPriorityBadge(q.priority)}
                      ${ui.getStatusBadge(q.status)}
                      <span class="text-sm text-gray-500">${q.protocol_number || ''} | ${q.subject_number || ''}</span>
                    </div>
                    <p class="text-gray-900">${q.query_text}</p>
                    <p class="text-sm text-gray-500 mt-1">
                      ${q.form_code || ''} ${q.field_code ? `> ${q.field_code}` : ''} | 
                      ${q.created_by_name || ''} | ${ui.formatDateTime(q.created_at)}
                    </p>
                  </div>
                  <div class="ml-4">
                    <i class="fas fa-chevron-right text-gray-400"></i>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Failed to load queries:', error);
      mainContent.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p>Query 목록을 불러오는데 실패했습니다.</p>
        </div>
      `;
    }
  }

  // =====================================================
  // MODALS
  // =====================================================
  function showNewStudyModal() {
    showModal('새 임상시험 등록', `
      <form id="new-study-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">프로토콜 번호 *</label>
          <input type="text" name="protocol_number" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제목 *</label>
          <input type="text" name="title" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Phase</label>
            <select name="phase" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
              <option value="">선택</option>
              <option value="I">Phase I</option>
              <option value="II">Phase II</option>
              <option value="III">Phase III</option>
              <option value="IV">Phase IV</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">스폰서</label>
            <input type="text" name="sponsor" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">IRB 승인번호</label>
            <input type="text" name="irb_approval_number" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">시작일</label>
            <input type="date" name="study_start_date" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
          </div>
        </div>
      </form>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', class: 'bg-ecrf-blue text-white hover:bg-blue-700', onclick: 'submitNewStudy()' },
    ]);
  }
  window.showNewStudyModal = showNewStudyModal;

  async function submitNewStudy() {
    const form = document.getElementById('new-study-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const result = await api.post('/studies', data);
      if (result.success) {
        closeModal();
        showToast('임상시험이 등록되었습니다.', 'success');
        navigateTo('dashboard');
      }
    } catch (error) {
      showToast(error.error || '등록에 실패했습니다.', 'error');
    }
  }
  window.submitNewStudy = submitNewStudy;

  function showNewSiteModal(studyId) {
    showModal('새 연구기관 추가', `
      <form id="new-site-form" class="space-y-4">
        <input type="hidden" name="study_id" value="${studyId}">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기관번호 *</label>
          <input type="text" name="site_number" required placeholder="예: 01" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기관명 *</label>
          <input type="text" name="name" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">PI 성명</label>
          <input type="text" name="pi_name" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">PI 이메일</label>
          <input type="email" name="pi_email" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">주소</label>
          <input type="text" name="address" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
      </form>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '추가', class: 'bg-ecrf-blue text-white hover:bg-blue-700', onclick: 'submitNewSite()' },
    ]);
  }
  window.showNewSiteModal = showNewSiteModal;

  async function submitNewSite() {
    const form = document.getElementById('new-site-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const studyId = data.study_id;
    delete data.study_id;

    try {
      const result = await api.post(`/studies/${studyId}/sites`, data);
      if (result.success) {
        closeModal();
        showToast('연구기관이 추가되었습니다.', 'success');
        navigateTo('study', { studyId });
      }
    } catch (error) {
      showToast(error.error || '추가에 실패했습니다.', 'error');
    }
  }
  window.submitNewSite = submitNewSite;

  function showNewSubjectModal(siteId) {
    showModal('새 피험자 등록', `
      <form id="new-subject-form" class="space-y-4">
        <input type="hidden" name="site_id" value="${siteId}">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">이니셜</label>
          <input type="text" name="initials" maxlength="4" placeholder="예: KDH" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue uppercase">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">스크리닝일</label>
          <input type="date" name="screening_date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">비고</label>
          <textarea name="notes" rows="2" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue"></textarea>
        </div>
        <p class="text-sm text-gray-500">* Subject ID와 Screening Number는 자동으로 생성됩니다.</p>
      </form>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '등록', class: 'bg-ecrf-blue text-white hover:bg-blue-700', onclick: 'submitNewSubject()' },
    ]);
  }
  window.showNewSubjectModal = showNewSubjectModal;

  async function submitNewSubject() {
    const form = document.getElementById('new-subject-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const siteId = data.site_id;
    delete data.site_id;

    try {
      const result = await api.post(`/sites/${siteId}/subjects`, data);
      if (result.success) {
        closeModal();
        showToast(`피험자 ${result.data.subject_number}가 등록되었습니다.`, 'success');
        navigateTo('site', { siteId });
      }
    } catch (error) {
      showToast(error.error || '등록에 실패했습니다.', 'error');
    }
  }
  window.submitNewSubject = submitNewSubject;

  function showWithdrawModal(subjectId) {
    showModal('중도탈락 처리', `
      <form id="withdraw-form" class="space-y-4">
        <input type="hidden" name="subject_id" value="${subjectId}">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">중도탈락 사유 *</label>
          <select name="withdrawal_initiated_by" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue mb-2">
            <option value="INVESTIGATOR">연구자 결정</option>
            <option value="SUBJECT">피험자 요청</option>
            <option value="SPONSOR">스폰서 결정</option>
            <option value="OTHER">기타</option>
          </select>
          <textarea name="withdrawal_reason" rows="3" required placeholder="상세 사유를 입력하세요..." 
                    class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue"></textarea>
        </div>
        <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p class="text-sm text-yellow-700">
            <i class="fas fa-exclamation-triangle mr-1"></i>
            중도탈락 처리 후에는 해당 피험자의 데이터 입력이 제한됩니다.
          </p>
        </div>
      </form>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '중도탈락 처리', class: 'bg-red-600 text-white hover:bg-red-700', onclick: 'submitWithdraw()' },
    ]);
  }
  window.showWithdrawModal = showWithdrawModal;

  async function submitWithdraw() {
    const form = document.getElementById('withdraw-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const subjectId = data.subject_id;
    delete data.subject_id;

    try {
      const result = await api.post(`/subjects/${subjectId}/withdraw`, data);
      if (result.success) {
        closeModal();
        showToast('피험자가 중도탈락 처리되었습니다.', 'success');
        navigateTo('subject', { subjectId });
      }
    } catch (error) {
      showToast(error.error || '처리에 실패했습니다.', 'error');
    }
  }
  window.submitWithdraw = submitWithdraw;

  function showSignatureModal(crfInstanceId) {
    showModal('전자서명', `
      <form id="signature-form" class="space-y-4">
        <input type="hidden" name="crf_instance_id" value="${crfInstanceId}">
        <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p class="text-sm text-blue-700">
            <i class="fas fa-shield-alt mr-1"></i>
            21 CFR Part 11 준수 전자서명
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">서명 의미</label>
          <select name="signature_meaning" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
            <option value="DATA_REVIEW">데이터 검토 완료</option>
            <option value="DATA_APPROVAL">데이터 승인</option>
            <option value="CRF_COMPLETION">CRF 작성 완료</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인 *</label>
          <input type="password" name="password" required placeholder="현재 비밀번호를 입력하세요"
                 class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue">
        </div>
        <div class="flex items-start">
          <input type="checkbox" name="agree" id="sig-agree" required class="mt-1 mr-2">
          <label for="sig-agree" class="text-sm text-gray-600">
            본인은 상기 데이터를 검토하였으며 정확하고 완전함을 확인합니다.
            이 전자서명은 법적 구속력이 있는 서명과 동등함을 이해합니다.
          </label>
        </div>
      </form>
    `, [
      { label: '취소', onclick: 'closeModal()' },
      { label: '서명', class: 'bg-purple-600 text-white hover:bg-purple-700', onclick: 'submitSignature()' },
    ]);
  }
  window.showSignatureModal = showSignatureModal;

  async function submitSignature() {
    const form = document.getElementById('signature-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    if (!data.agree) {
      showToast('서명 동의 확인이 필요합니다.', 'warning');
      return;
    }

    try {
      const result = await api.post('/signatures', {
        crf_instance_id: data.crf_instance_id,
        signature_meaning: data.signature_meaning,
        password: data.password,
      });
      
      if (result.success) {
        closeModal();
        showToast('전자서명이 완료되었습니다.', 'success');
        // Reload current CRF
        if (state.currentCRF) {
          loadCRFForm(state.currentCRF.visitId, state.currentCRF.formCode);
        }
      }
    } catch (error) {
      showToast(error.error || '서명에 실패했습니다.', 'error');
    }
  }
  window.submitSignature = submitSignature;

  async function showQueryDetailModal(queryId) {
    try {
      const result = await api.get(`/queries/${queryId}`);
      if (!result.success) throw new Error(result.error);

      const query = result.data;
      const responses = query.responses || [];

      showModal(`Query 상세 - ${query.form_code || ''}`, `
        <div class="space-y-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              ${ui.getPriorityBadge(query.priority)}
              ${ui.getStatusBadge(query.status)}
            </div>
            <p class="text-gray-900 font-medium">${query.query_text}</p>
            <p class="text-sm text-gray-500 mt-2">
              발행자: ${query.created_by_name || ''} | ${ui.formatDateTime(query.created_at)}
            </p>
          </div>
          
          ${responses.length > 0 ? `
            <div class="border-l-2 border-gray-200 pl-4 space-y-3">
              ${responses.map(r => `
                <div class="p-3 bg-white border rounded-lg">
                  <p class="text-sm text-gray-900">${r.response_text}</p>
                  <p class="text-xs text-gray-500 mt-1">
                    ${r.responded_by_name || ''} (${ui.getRoleName(r.responded_by_role)}) | 
                    ${ui.formatDateTime(r.responded_at)}
                  </p>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${query.status === 'OPEN' || query.status === 'ANSWERED' ? `
            <form id="query-response-form" class="space-y-3">
              <input type="hidden" name="query_id" value="${query.id}">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  ${query.status === 'OPEN' ? '답변' : '추가 의견'}
                </label>
                <textarea name="response_text" rows="3" required 
                          class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-ecrf-blue"></textarea>
              </div>
            </form>
          ` : ''}
        </div>
      `, query.status === 'OPEN' || query.status === 'ANSWERED' ? [
        { label: '닫기', onclick: 'closeModal()' },
        query.status === 'ANSWERED' && ui.canManage() ? 
          { label: 'Query 종료', class: 'bg-green-600 text-white hover:bg-green-700', onclick: `closeQuery('${query.id}')` } : null,
        { label: query.status === 'OPEN' ? '답변하기' : '의견 추가', class: 'bg-ecrf-blue text-white hover:bg-blue-700', onclick: 'submitQueryResponse()' },
      ].filter(Boolean) : [
        { label: '닫기', onclick: 'closeModal()' },
      ]);
    } catch (error) {
      showToast(error.error || 'Query를 불러오는데 실패했습니다.', 'error');
    }
  }
  window.showQueryDetailModal = showQueryDetailModal;

  async function submitQueryResponse() {
    const form = document.getElementById('query-response-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const result = await api.post(`/queries/${data.query_id}/answer`, {
        response_text: data.response_text,
      });
      
      if (result.success) {
        closeModal();
        showToast('답변이 등록되었습니다.', 'success');
        if (state.currentView === 'queries') {
          loadQueriesList();
        }
      }
    } catch (error) {
      showToast(error.error || '답변 등록에 실패했습니다.', 'error');
    }
  }
  window.submitQueryResponse = submitQueryResponse;

  async function closeQuery(queryId) {
    try {
      const result = await api.post(`/queries/${queryId}/close`, {
        close_reason: '검토 완료',
      });
      
      if (result.success) {
        closeModal();
        showToast('Query가 종료되었습니다.', 'success');
        if (state.currentView === 'queries') {
          loadQueriesList();
        }
      }
    } catch (error) {
      showToast(error.error || 'Query 종료에 실패했습니다.', 'error');
    }
  }
  window.closeQuery = closeQuery;

  // =====================================================
  // EVENT HANDLERS
  // =====================================================
  function setupEventHandlers() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        const errorEl = document.getElementById('login-error');
        if (errorEl) errorEl.classList.add('hidden');
        
        try {
          await login(email, password);
        } catch (error) {
          if (errorEl) {
            errorEl.textContent = error.error || '로그인에 실패했습니다.';
            errorEl.classList.remove('hidden');
          }
        }
      });
    }

    // Session timeout check
    setInterval(() => {
      if (state.token && Date.now() - state.lastActivity > CONFIG.sessionTimeout) {
        logout(true);
        showToast('세션이 만료되었습니다.', 'warning');
      }
    }, 60000);
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================
  function init() {
    setupEventHandlers();
    updateAuthUI();
    
    // 오프라인 지원 초기화
    offline.init();
    
    if (state.token && state.user) {
      navigateTo('dashboard');
    }

    // Service Worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/static/sw.js')
        .then(reg => {
          console.log('Service Worker registered:', reg.scope);
          
          // SW 업데이트 확인
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('새 버전이 있습니다. 새로고침하세요.', 'info');
              }
            });
          });
        })
        .catch(err => console.log('Service Worker registration failed:', err));
    }

    // 주기적 캐시 정리 (1시간마다)
    setInterval(async () => {
      if (window.eCRFOfflineDB) {
        await window.eCRFOfflineDB.cleanupExpiredCache();
      }
    }, 60 * 60 * 1000);
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
