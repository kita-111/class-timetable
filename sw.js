/* 课表 Service Worker
 * 策略可切换（开关存在 Cache Storage 的 ct-prefs/mode 里，跨重启保留）：
 *   offline —— 页面直接读缓存，秒开；同时后台静默刷新，下次打开就是新的（默认）
 *   online  —— 页面先向服务器要最新的，失败再退回缓存
 * 静态资源始终"缓存优先"，文件名带哈希，不会有陈旧问题。
 */
const CACHE = 'campus-timetable-v2';
const PREFS = 'ct-prefs';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PREFS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** 读开关：没设置过就默认"优先离线" */
async function offlineFirst() {
  try {
    const cache = await caches.open(PREFS);
    const res = await cache.match('mode');
    if (!res) return true;
    return (await res.text()) !== 'online';
  } catch {
    return true;
  }
}

async function navigateResponse(request, event) {
  const cache = await caches.open(CACHE);
  const pref = await offlineFirst();

  const refresh = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        cache.put('./index.html', res.clone());
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (pref) {
    const cached = (await cache.match('./index.html')) || (await cache.match(request));
    if (cached) {
      // 页面已经给出去了，顺便在后台换新的
      event.waitUntil(refresh);
      return cached;
    }
    return (await refresh) || (await cache.match('./index.html')) || Response.error();
  }

  const fresh = await refresh;
  if (fresh) return fresh;
  return (await cache.match('./index.html')) || (await cache.match(request)) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigateResponse(request, event));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    }),
  );
});
