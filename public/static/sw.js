// eCRF PWA - Service Worker
// 오프라인 지원 및 캐싱 전략

const CACHE_NAME = 'ecrf-pwa-v1';
const STATIC_CACHE = 'ecrf-static-v1';

// 캐시할 정적 리소스
const STATIC_ASSETS = [
  '/',
  '/static/app.js',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js',
];

// 설치 이벤트
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 활성화 이벤트
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch 이벤트 - 캐싱 전략
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API 요청은 네트워크 우선
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 정적 리소스는 캐시 우선
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 기타 요청은 네트워크 우선, 실패 시 캐시
  event.respondWith(networkFirst(request));
});

// 정적 리소스 확인
function isStaticAsset(url) {
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext)) ||
         url.hostname !== self.location.hostname;
}

// 캐시 우선 전략
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
    // 오프라인 폴백 페이지 반환 가능
    return new Response('Offline', { status: 503 });
  }
}

// 네트워크 우선 전략
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    // 성공적인 응답은 캐시에 저장 (GET 요청만)
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

    // API 요청의 경우 오류 응답 반환
    if (request.url.includes('/api/')) {
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

    return new Response('Offline', { status: 503 });
  }
}

// 백그라운드 동기화 (향후 구현)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-data') {
    console.log('[SW] Syncing offline data...');
    // TODO: IndexedDB에 저장된 오프라인 데이터 서버와 동기화
  }
});

// 푸시 알림 (향후 구현)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || '새로운 알림이 있습니다.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: data.tag || 'ecrf-notification',
    data: data.url || '/',
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'eCRF', options)
  );
});

// 알림 클릭
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
