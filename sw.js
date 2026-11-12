// תלם שלי: שומר את קבצי האפליקציה ואת תמונות הדפים כדי שהכל ייפתח מהר.
// 1.24 (מהירות):
//  - קבצי האפליקציה – קודם מהשמור (נפתח מיד), ובמקביל בודקים ברשת. גרסה חדשה מגיעה עם sw חדש (CACHE חדש) → רענון אוטומטי.
//  - תמונות הדפים (Supabase Storage, קישור חתום) – קודם מהשמור; בלי אינטרנט / בפעם השנייה – מיד. עד ~600 תמונות.
//  - הנתונים עצמם (רשימות, תוכנית, נוכחות) – תמיד מהשרת, לא נשמרים כאן.
const CACHE = "telem-portal-1.35.74";   // לשנות יחד עם הגרסה ב-index.html
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
// 1.35.69 (TS-31): התראות פוש לצוות – גם כשהאפליקציה סגורה. המספר על האייקון = כמה התראות מחכות
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "תלם שלי", { body: d.body || "", tag: d.tag || "telem", renotify: true, icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./?todo=1" }, dir: "rtl", lang: "he" });
    try { const n = (await self.registration.getNotifications()).length; if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n); } catch (x) {}
  })());
});
self.addEventListener("notificationclick", (e) => {
  // 1.35.73 (נועה: "כשאני לוחצת על התראה… זה לא פותח לי את המסך של הילד"): התראה על ילד/ה (tag "telem-<id>") – ישר לדף שלו/ה
  e.notification.close(); const m = /^telem-(\d+)$/.exec(e.notification.tag || ""), kid = m ? m[1] : "";
  const url = new URL(kid ? "./?kid=" + kid : ((e.notification.data && e.notification.data.url) || "./?todo=1"), self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage(kid ? { push: "kid", sid: kid } : { push: "todo" }); return; } }
    await self.clients.openWindow(url);
  })());
});
