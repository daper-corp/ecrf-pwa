// eCRF PWA - Service Worker
// 오프라인 지원 및 캐싱 전략
// Updated: 2026-01-26

const CACHE_VERSION = 'v2';
const CACHE_NAME = `ecrf-pwa-${CACHE_VERSION}`;
const STATIC_CACHE = `ecrf-static-${CACHE_VERSION}`;
const API_CACHE = `ecrf-api-${CACHE_VERSION}`;

// 캐시할 정적 리소스
const STATIC_ASSETS = [
  '/',
  '/static/app.js',
  '/static/offline-db.js',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js',
];

// 오프라인에서 캐시할 API 경로
const CACHEABLE_API_PATHS = [
  '/api/studies',
  '/api/health',
];

// 오프라인에서 저장할 API 경로 (POST/PUT 요청)
const OFFLINE_SYNC_PATHS = [
  '/api/visits/*/crf',
  '/api/queries',
  '/api/signatures',
];

// =====================================================
// INSTALL
// =====================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v2...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// =====================================================
// ACTIVATE
// =====================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v2...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // 현재 버전 캐시 제외하고 모두 삭제
            return !name.includes(CACHE_VERSION);
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// =====================================================
// FETCH
// =====================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 같은 origin만 처리
  if (url.origin !== self.location.origin && !url.hostname.includes('cdn')) {
    return;
  }

  // POST/PUT/DELETE 요청 처리 (오프라인 저장)
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    event.respondWith(handleMutationRequest(request));
    return;
  }

  // API 요청 처리
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // 정적 리소스 처리
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 기타 요청 (HTML 페이지 등)
  event.respondWith(networkFirst(request));
});

// =====================================================
// REQUEST HANDLERS
// =====================================================

/**
 * API 요청 처리 (GET)
 */
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  // 네트워크 시도
  try {
    const networkResponse = await fetch(request.clone());
    
    // 성공하면 캐시에 저장
    if (networkResponse.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] API request failed, trying cache:', url.pathname);
    
    // 캐시에서 조회
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // 오프라인 표시 추가
      const data = await cachedResponse.clone().json();
      return new Response(
        JSON.stringify({ ...data, _offline: true, _cachedAt: cachedResponse.headers.get('date') }),
        {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'X-Offline-Cache': 'true'
          }
        }
      );
    }

    // 캐시도 없으면 오프라인 에러
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: '오프라인 상태입니다. 네트워크 연결을 확인해주세요.',
        offline: true 
      }),
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * 변경 요청 처리 (POST/PUT/DELETE)
 */
async function handleMutationRequest(request) {
  const url = new URL(request.url);
  
  try {
    // 네트워크 시도
    const networkResponse = await fetch(request.clone());
    return networkResponse;
  } catch (error) {
    console.log('[SW] Mutation request failed, queuing for offline sync:', url.pathname);
    
    // 오프라인 상태 - 요청을 IndexedDB에 저장하도록 클라이언트에 알림
    const body = await request.clone().text();
    
    // 클라이언트에 메시지 전송
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'OFFLINE_MUTATION',
        endpoint: url.pathname,
        method: request.method,
        body: body ? JSON.parse(body) : null,
        headers: Object.fromEntries(request.headers.entries())
      });
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        offline: true,
        message: '오프라인 상태입니다. 변경사항이 저장되었으며, 온라인 시 자동 동기화됩니다.',
        queued: true
      }),
      { 
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * 정적 리소스 확인
 */
function isStaticAsset(url) {
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ico'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext)) ||
         (url.hostname !== self.location.hostname && url.hostname.includes('cdn'));
}

/**
 * 캐시 우선 전략
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network request failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

/**
 * 네트워크 우선 전략
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network request failed, trying cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 오프라인 폴백 페이지 (HTML 요청인 경우)
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('/');
    }

    return new Response('Offline', { status: 503 });
  }
}

// =====================================================
// BACKGROUND SYNC
// =====================================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
  
  if (event.tag === 'sync-offline-data') {
    event.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  console.log('[SW] Starting background sync...');
  
  // 클라이언트에 동기화 시작 알림
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_STARTED' });
  });

  // 실제 동기화는 클라이언트의 OfflineDB에서 수행
  // Service Worker는 트리거만 담당
  
  clients.forEach(client => {
    client.postMessage({ type: 'TRIGGER_SYNC' });
  });
}

// =====================================================
// PUSH NOTIFICATIONS
// =====================================================
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || '새로운 알림이 있습니다.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: data.tag || 'ecrf-notification',
    data: { url: data.url || '/' },
    actions: data.actions || [
      { action: 'view', title: '보기' },
      { action: 'dismiss', title: '닫기' }
    ],
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'eCRF 알림', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 이미 열린 창이 있으면 포커스
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => client.navigate(url));
          }
        }
        // 없으면 새 창 열기
        return clients.openWindow(url);
      })
  );
});

// =====================================================
// MESSAGE HANDLING
// =====================================================
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
      break;
      
    case 'GET_CACHE_STATUS':
      getCacheStatus().then(status => {
        event.source.postMessage({ type: 'CACHE_STATUS', data: status });
      });
      break;
      
    case 'PREFETCH_DATA':
      if (data?.urls) {
        prefetchUrls(data.urls);
      }
      break;
  }
});

async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};
  
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    status[name] = keys.length;
  }
  
  return status;
}

async function prefetchUrls(urls) {
  const cache = await caches.open(API_CACHE);
  
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        console.log('[SW] Prefetched:', url);
      }
    } catch (error) {
      console.log('[SW] Prefetch failed:', url, error);
    }
  }
}

console.log('[SW] Service Worker v2 loaded');
