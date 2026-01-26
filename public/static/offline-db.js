// eCRF PWA - Offline Database Module
// IndexedDB를 사용한 오프라인 데이터 저장 및 동기화

const DB_NAME = 'ecrf-offline-db';
const DB_VERSION = 1;

// Store 정의
const STORES = {
  PENDING_CHANGES: 'pending_changes',    // 서버에 동기화되지 않은 변경사항
  CACHED_DATA: 'cached_data',            // 캐시된 서버 데이터
  USER_SESSION: 'user_session',          // 사용자 세션 정보
  SYNC_LOG: 'sync_log'                   // 동기화 로그
};

class OfflineDB {
  constructor() {
    this.db = null;
    this.isOnline = navigator.onLine;
    this.syncInProgress = false;
    
    // 온라인/오프라인 상태 감지
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  // 데이터베이스 초기화
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[OfflineDB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[OfflineDB] Database initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // pending_changes: 오프라인 변경사항 저장
        if (!db.objectStoreNames.contains(STORES.PENDING_CHANGES)) {
          const store = db.createObjectStore(STORES.PENDING_CHANGES, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }

        // cached_data: 서버 데이터 캐시
        if (!db.objectStoreNames.contains(STORES.CACHED_DATA)) {
          const store = db.createObjectStore(STORES.CACHED_DATA, { 
            keyPath: 'key' 
          });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('expiry', 'expiry', { unique: false });
        }

        // user_session: 세션 데이터
        if (!db.objectStoreNames.contains(STORES.USER_SESSION)) {
          db.createObjectStore(STORES.USER_SESSION, { keyPath: 'key' });
        }

        // sync_log: 동기화 이력
        if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
          const store = db.createObjectStore(STORES.SYNC_LOG, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        console.log('[OfflineDB] Database schema created/upgraded');
      };
    });
  }

  // =====================================================
  // PENDING CHANGES (오프라인 변경사항)
  // =====================================================

  /**
   * 오프라인 변경사항 저장
   * @param {string} type - 변경 유형 (CRF_DATA, QUERY, SIGNATURE 등)
   * @param {string} endpoint - API 엔드포인트
   * @param {string} method - HTTP 메서드
   * @param {object} data - 전송할 데이터
   */
  async savePendingChange(type, endpoint, method, data) {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);

    const change = {
      type,
      endpoint,
      method,
      data,
      timestamp: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
      lastError: null
    };

    return new Promise((resolve, reject) => {
      const request = store.add(change);
      request.onsuccess = () => {
        console.log('[OfflineDB] Pending change saved:', change.type);
        this.notifyPendingChanges();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 대기 중인 변경사항 조회
   */
  async getPendingChanges(status = 'pending') {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readonly');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);
    const index = store.index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll(status);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 변경사항 상태 업데이트
   */
  async updateChangeStatus(id, status, error = null) {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const change = getRequest.result;
        if (change) {
          change.status = status;
          change.lastError = error;
          if (status === 'failed') {
            change.retryCount = (change.retryCount || 0) + 1;
          }
          const updateRequest = store.put(change);
          updateRequest.onsuccess = () => resolve(change);
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(null);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * 동기화 완료된 변경사항 삭제
   */
  async deleteChange(id) {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => {
        this.notifyPendingChanges();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // =====================================================
  // CACHED DATA (서버 데이터 캐시)
  // =====================================================

  /**
   * 데이터 캐시 저장
   * @param {string} key - 캐시 키 (예: 'study_001_subjects')
   * @param {string} type - 데이터 유형 (study, site, subject, visit, crf 등)
   * @param {any} data - 캐시할 데이터
   * @param {number} ttl - TTL (초 단위, 기본 5분)
   */
  async cacheData(key, type, data, ttl = 300) {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.CACHED_DATA);

    const cached = {
      key,
      type,
      data,
      timestamp: new Date().toISOString(),
      expiry: new Date(Date.now() + ttl * 1000).toISOString()
    };

    return new Promise((resolve, reject) => {
      const request = store.put(cached);
      request.onsuccess = () => resolve(cached);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 캐시 데이터 조회
   * @param {string} key - 캐시 키
   * @param {boolean} ignoreExpiry - 만료 무시 여부 (오프라인 시)
   */
  async getCachedData(key, ignoreExpiry = false) {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readonly');
    const store = transaction.objectStore(STORES.CACHED_DATA);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        // 만료 확인 (오프라인이면 만료된 데이터도 반환)
        if (!ignoreExpiry && new Date(result.expiry) < new Date()) {
          console.log('[OfflineDB] Cache expired:', key);
          resolve(null);
          return;
        }

        resolve(result.data);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 타입별 캐시 데이터 조회
   */
  async getCachedDataByType(type) {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readonly');
    const store = transaction.objectStore(STORES.CACHED_DATA);
    const index = store.index('type');

    return new Promise((resolve, reject) => {
      const request = index.getAll(type);
      request.onsuccess = () => resolve(request.result.map(r => r.data));
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 캐시 삭제
   */
  async clearCache(type = null) {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.CACHED_DATA);

    if (type) {
      const index = store.index('type');
      return new Promise((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only(type));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    } else {
      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  async saveSession(token, user) {
    const transaction = this.db.transaction([STORES.USER_SESSION], 'readwrite');
    const store = transaction.objectStore(STORES.USER_SESSION);

    return Promise.all([
      new Promise((resolve, reject) => {
        const req = store.put({ key: 'token', value: token, timestamp: new Date().toISOString() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
      new Promise((resolve, reject) => {
        const req = store.put({ key: 'user', value: user, timestamp: new Date().toISOString() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
    ]);
  }

  async getSession() {
    const transaction = this.db.transaction([STORES.USER_SESSION], 'readonly');
    const store = transaction.objectStore(STORES.USER_SESSION);

    const [tokenResult, userResult] = await Promise.all([
      new Promise((resolve) => {
        const req = store.get('token');
        req.onsuccess = () => resolve(req.result?.value);
        req.onerror = () => resolve(null);
      }),
      new Promise((resolve) => {
        const req = store.get('user');
        req.onsuccess = () => resolve(req.result?.value);
        req.onerror = () => resolve(null);
      })
    ]);

    return { token: tokenResult, user: userResult };
  }

  async clearSession() {
    const transaction = this.db.transaction([STORES.USER_SESSION], 'readwrite');
    const store = transaction.objectStore(STORES.USER_SESSION);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // =====================================================
  // SYNC MANAGEMENT
  // =====================================================

  /**
   * 서버와 동기화
   */
  async syncWithServer() {
    if (!this.isOnline || this.syncInProgress) {
      console.log('[OfflineDB] Sync skipped:', this.isOnline ? 'in progress' : 'offline');
      return { synced: 0, failed: 0 };
    }

    this.syncInProgress = true;
    const results = { synced: 0, failed: 0 };

    try {
      const pendingChanges = await this.getPendingChanges('pending');
      console.log(`[OfflineDB] Syncing ${pendingChanges.length} pending changes...`);

      const session = await this.getSession();
      if (!session.token) {
        console.log('[OfflineDB] No session token, skipping sync');
        return results;
      }

      for (const change of pendingChanges) {
        try {
          const response = await fetch(change.endpoint, {
            method: change.method,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`
            },
            body: change.method !== 'GET' ? JSON.stringify(change.data) : undefined
          });

          if (response.ok) {
            await this.deleteChange(change.id);
            await this.logSync('success', change);
            results.synced++;
          } else {
            const error = await response.text();
            await this.updateChangeStatus(change.id, 'failed', error);
            await this.logSync('failed', change, error);
            results.failed++;
          }
        } catch (error) {
          await this.updateChangeStatus(change.id, 'failed', error.message);
          await this.logSync('error', change, error.message);
          results.failed++;
        }
      }

      console.log(`[OfflineDB] Sync complete: ${results.synced} synced, ${results.failed} failed`);
    } finally {
      this.syncInProgress = false;
    }

    return results;
  }

  /**
   * 동기화 로그 기록
   */
  async logSync(status, change, error = null) {
    const transaction = this.db.transaction([STORES.SYNC_LOG], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_LOG);

    const log = {
      timestamp: new Date().toISOString(),
      status,
      changeType: change.type,
      endpoint: change.endpoint,
      error
    };

    return new Promise((resolve, reject) => {
      const request = store.add(log);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  handleOnline() {
    this.isOnline = true;
    console.log('[OfflineDB] Back online, starting sync...');
    this.syncWithServer();
    
    // UI 알림
    window.dispatchEvent(new CustomEvent('offline-status-change', { 
      detail: { online: true } 
    }));
  }

  handleOffline() {
    this.isOnline = false;
    console.log('[OfflineDB] Gone offline');
    
    // UI 알림
    window.dispatchEvent(new CustomEvent('offline-status-change', { 
      detail: { online: false } 
    }));
  }

  notifyPendingChanges() {
    this.getPendingChanges().then(changes => {
      window.dispatchEvent(new CustomEvent('pending-changes-update', { 
        detail: { count: changes.length } 
      }));
    });
  }

  // =====================================================
  // CRF DATA CACHING (오프라인 CRF 작업 지원)
  // =====================================================

  /**
   * CRF 데이터 프리페치 (오프라인 사용을 위해)
   * @param {string} studyId - 스터디 ID
   * @param {string} siteId - 사이트 ID (선택)
   */
  async prefetchCRFData(studyId, siteId = null) {
    const session = await this.getSession();
    if (!session.token || !this.isOnline) {
      console.log('[OfflineDB] Cannot prefetch: no session or offline');
      return { success: false, error: 'No session or offline' };
    }

    const results = { cached: 0, errors: [] };

    try {
      // 1. 스터디 정보 캐시
      const studyUrl = `/api/studies/${studyId}`;
      const studyRes = await fetch(studyUrl, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      if (studyRes.ok) {
        const studyData = await studyRes.json();
        await this.cacheData(`study_${studyId}`, 'study', studyData, 3600);
        results.cached++;
      }

      // 2. 피험자 목록 캐시
      let subjectsUrl = `/api/studies/${studyId}/subjects`;
      if (siteId) subjectsUrl += `?site_id=${siteId}`;
      const subjectsRes = await fetch(subjectsUrl, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      if (subjectsRes.ok) {
        const subjects = await subjectsRes.json();
        await this.cacheData(`subjects_${studyId}_${siteId || 'all'}`, 'subjects', subjects, 1800);
        results.cached++;

        // 3. 각 피험자의 방문/CRF 데이터 캐시
        for (const subject of (subjects.subjects || subjects.data || [])) {
          try {
            const visitsUrl = `/api/subjects/${subject.id}/visits`;
            const visitsRes = await fetch(visitsUrl, {
              headers: { 'Authorization': `Bearer ${session.token}` }
            });
            if (visitsRes.ok) {
              const visits = await visitsRes.json();
              await this.cacheData(`visits_${subject.id}`, 'visits', visits, 1800);
              results.cached++;
            }
          } catch (err) {
            results.errors.push({ type: 'visits', subjectId: subject.id, error: err.message });
          }
        }
      }

      // 4. Form definitions 캐시
      const formsUrl = `/api/studies/${studyId}/forms`;
      const formsRes = await fetch(formsUrl, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      if (formsRes.ok) {
        const forms = await formsRes.json();
        await this.cacheData(`forms_${studyId}`, 'forms', forms, 7200);
        results.cached++;
      }

      console.log(`[OfflineDB] Prefetch complete: ${results.cached} items cached`);
    } catch (error) {
      results.errors.push({ type: 'general', error: error.message });
    }

    return results;
  }

  /**
   * CRF 인스턴스 데이터 저장 (오프라인 작업용)
   */
  async saveCRFInstance(crfInstanceId, formCode, subjectId, visitId, data) {
    const key = `crf_${crfInstanceId}`;
    const crfData = {
      crfInstanceId,
      formCode,
      subjectId,
      visitId,
      data,
      savedAt: new Date().toISOString(),
      synced: false
    };
    return this.cacheData(key, 'crf_instance', crfData, 86400); // 24시간 TTL
  }

  /**
   * CRF 인스턴스 데이터 조회
   */
  async getCRFInstance(crfInstanceId) {
    return this.getCachedData(`crf_${crfInstanceId}`, !this.isOnline);
  }

  // =====================================================
  // CONFLICT RESOLUTION (충돌 해결)
  // =====================================================

  /**
   * 동기화 충돌 저장
   */
  async saveConflict(changeId, localData, serverData, endpoint) {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(changeId);
      getRequest.onsuccess = () => {
        const change = getRequest.result;
        if (change) {
          change.status = 'conflict';
          change.conflict = {
            localData,
            serverData,
            detectedAt: new Date().toISOString()
          };
          const updateRequest = store.put(change);
          updateRequest.onsuccess = () => resolve(change);
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(null);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * 충돌 목록 조회
   */
  async getConflicts() {
    return this.getPendingChanges('conflict');
  }

  /**
   * 충돌 해결 (로컬 우선 또는 서버 우선)
   * @param {number} changeId - 변경사항 ID
   * @param {string} resolution - 'local' | 'server' | 'merge'
   * @param {object} mergedData - merge인 경우 병합된 데이터
   */
  async resolveConflict(changeId, resolution, mergedData = null) {
    const transaction = this.db.transaction([STORES.PENDING_CHANGES], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_CHANGES);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(changeId);
      getRequest.onsuccess = async () => {
        const change = getRequest.result;
        if (!change || change.status !== 'conflict') {
          resolve(null);
          return;
        }

        try {
          switch (resolution) {
            case 'local':
              // 로컬 데이터로 재시도
              change.status = 'pending';
              change.conflict = null;
              change.retryCount = 0;
              break;

            case 'server':
              // 서버 데이터 수용, 로컬 변경 삭제
              await this.deleteChange(changeId);
              await this.logSync('conflict_resolved_server', change);
              resolve({ resolved: true, resolution: 'server' });
              return;

            case 'merge':
              // 병합된 데이터로 재시도
              if (!mergedData) {
                reject(new Error('Merged data required for merge resolution'));
                return;
              }
              change.data = mergedData;
              change.status = 'pending';
              change.conflict = null;
              change.retryCount = 0;
              break;

            default:
              reject(new Error('Invalid resolution type'));
              return;
          }

          const updateRequest = store.put(change);
          updateRequest.onsuccess = async () => {
            await this.logSync(`conflict_resolved_${resolution}`, change);
            this.notifyPendingChanges();
            resolve({ resolved: true, resolution });
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } catch (error) {
          reject(error);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // =====================================================
  // SYNC STATUS & DASHBOARD
  // =====================================================

  /**
   * 동기화 상태 요약 조회
   */
  async getSyncStatus() {
    const [pending, conflicts, syncLogs] = await Promise.all([
      this.getPendingChanges('pending'),
      this.getConflicts(),
      this.getSyncLogs(10)
    ]);

    const failed = await this.getPendingChanges('failed');

    return {
      isOnline: this.isOnline,
      syncInProgress: this.syncInProgress,
      pending: pending.length,
      conflicts: conflicts.length,
      failed: failed.length,
      recentLogs: syncLogs,
      lastSyncTime: syncLogs[0]?.timestamp || null,
      pendingByType: this.groupByType(pending),
      conflictDetails: conflicts.map(c => ({
        id: c.id,
        type: c.type,
        endpoint: c.endpoint,
        localTimestamp: c.timestamp,
        conflictDetectedAt: c.conflict?.detectedAt
      }))
    };
  }

  /**
   * 동기화 로그 조회
   */
  async getSyncLogs(limit = 50) {
    const transaction = this.db.transaction([STORES.SYNC_LOG], 'readonly');
    const store = transaction.objectStore(STORES.SYNC_LOG);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const logs = [];
      const request = index.openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && logs.length < limit) {
          logs.push(cursor.value);
          cursor.continue();
        } else {
          resolve(logs);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 타입별 그룹화
   */
  groupByType(changes) {
    return changes.reduce((acc, change) => {
      acc[change.type] = (acc[change.type] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * 실패한 동기화 재시도
   */
  async retryFailed() {
    const failed = await this.getPendingChanges('failed');
    let retried = 0;

    for (const change of failed) {
      if (change.retryCount < 3) {
        await this.updateChangeStatus(change.id, 'pending');
        retried++;
      }
    }

    if (retried > 0 && this.isOnline) {
      setTimeout(() => this.syncWithServer(), 100);
    }

    return { retried };
  }

  /**
   * 동기화 이력 정리 (오래된 로그 삭제)
   */
  async cleanupSyncLogs(daysToKeep = 7) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    const transaction = this.db.transaction([STORES.SYNC_LOG], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_LOG);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      let deleted = 0;
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          console.log(`[OfflineDB] Cleaned up ${deleted} old sync logs`);
          resolve({ deleted });
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // =====================================================
  // UTILITY
  // =====================================================

  /**
   * 대기 중인 변경사항 수 조회
   */
  async getPendingCount() {
    const changes = await this.getPendingChanges();
    return changes.length;
  }

  /**
   * 오프라인 상태 확인
   */
  getOnlineStatus() {
    return this.isOnline;
  }

  /**
   * 전체 캐시 통계
   */
  async getCacheStats() {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readonly');
    const store = transaction.objectStore(STORES.CACHED_DATA);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result;
        const stats = {
          totalItems: items.length,
          byType: {},
          totalSize: 0,
          expired: 0
        };

        const now = new Date();
        items.forEach(item => {
          stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
          stats.totalSize += JSON.stringify(item.data).length;
          if (new Date(item.expiry) < now) {
            stats.expired++;
          }
        });

        stats.totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
        resolve(stats);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 만료된 캐시 정리
   */
  async cleanupExpiredCache() {
    const transaction = this.db.transaction([STORES.CACHED_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.CACHED_DATA);
    const index = store.index('expiry');
    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      let deleted = 0;
      const request = index.openCursor(IDBKeyRange.upperBound(now));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          console.log(`[OfflineDB] Cleaned up ${deleted} expired cache items`);
          resolve({ deleted });
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// 싱글톤 인스턴스
const offlineDB = new OfflineDB();

// 글로벌 접근
window.eCRFOfflineDB = offlineDB;

// 자동 초기화
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await offlineDB.init();
    console.log('[OfflineDB] Ready');
    
    // 초기 동기화 시도
    if (navigator.onLine) {
      setTimeout(() => offlineDB.syncWithServer(), 1000);
    }
  } catch (error) {
    console.error('[OfflineDB] Initialization failed:', error);
  }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OfflineDB, offlineDB };
}
