// תלם שלי: שומר את קבצי האפליקציה ואת תמונות הדפים כדי שהכל ייפתח מהר.
// 1.24 (מהירות):
//  - קבצי האפליקציה – קודם מהשמור (נפתח מיד), ובמקביל בודקים ברשת. גרסה חדשה מגיעה עם sw חדש (CACHE חדש) → רענון אוטומטי.
//  - תמונות הדפים (Supabase Storage, קישור חתום) – קודם מהשמור; בלי אינטרנט / בפעם השנייה – מיד. עד ~600 תמונות.
//  - הנתונים עצמם (רשימות, תוכנית, נוכחות) – תמיד מהשרת, לא נשמרים כאן.
const CACHE = "telem-portal-1.35.2";   // לשנות יחד עם הגרסה ב-index.html
const IMG = "telem-img-v1";          // תמונות הדפים – לא נמחק בכל גרסה
const IMG_MAX = 600;
const SHELL = ["./", "index.html", "manifest.webmanifest", "logo.png", "favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
let trimT = null;
const trimImg = () => { clearTimeout(trimT); trimT = setTimeout(async () => { const c = await caches.open(IMG), ks = await c.keys();
  for (let i = 0; i < ks.length - IMG_MAX; i++) await c.delete(ks[i]); }, 3000); };
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // תמונות הדפים: /storage/v1/object/sign/worksheets/... (אותו קישור חתום לכמה ימים → אותו מפתח)
  if (/\/storage\/v1\/object\/sign\/worksheets\//.test(url.pathname)) {
    e.respondWith(caches.open(IMG).then(c => c.match(req.url).then(hit => hit || fetch(req.url, { mode: "cors" }).then(r => { if (r.ok) { c.put(req.url, r.clone()); trimImg(); } return r; })
      .catch(() => fetch(req)))));
    return;
  }
  if (url.origin !== location.origin) return;   // Supabase (נתונים) ושאר האתרים – ישירות
  // קבצי האפליקציה: מיד מהשמור, ובמקביל עדכון מהרשת; בלי שמור – מהרשת
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: url.pathname.endsWith("/") || url.pathname.endsWith("index.html") }).then(hit => {
    const net = fetch(req, { cache: "no-cache" }).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match("index.html"));
  })));
});
