// "תלם שלי" – portal-push (Edge Function). TS-31 · 1.35.69 (נועה 11–12.11.2026)
// התראות פוש לטלפון של הצוות כשילד/ה נשאר/ה בלי עבודה, או ביקש/ה משימה.
//   GET  → המפתח הציבורי (VAPID_PUBLIC) – לרישום הטלפון.
//   POST {event: "idle" | "req", subject?} – נקרא מהאפליקציה של הילד/ה (עם הכניסה שלו/ה).
//        הפונקציה בודקת לבד במסד אם באמת אין עבודה / יש בקשה פתוחה, ובלי כפולות (portal_push_log).
// סודות (Supabase → Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (mailto:…).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY – קיימים לבד.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUB = Deno.env.get("VAPID_PUBLIC") || "", PRIV = Deno.env.get("VAPID_PRIVATE") || "", SUBJ = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@example.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const SUBJ_SHORT: Record<string, string> = { "מתמטיקה": "מת'", "אנגלית": "אנג'" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return J({ public: PUB });
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!PUB || !PRIV) return J({ skip: "no keys" });
  try {
    const body = await req.json().catch(() => ({}));
    const ev = body.event === "req" ? "req" : "idle";
    const user = await createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }).auth.getUser();
    const uid = user.data.user?.id; if (!uid) return J({ error: "auth" }, 401);
    const svc = createClient(URL_, SRK);
    const acc = await svc.from("portal_accounts").select("student_id").eq("user_id", uid).maybeSingle();
    const sid = acc.data?.student_id; if (!sid) return J({ skip: "not a kid" });

    const items = (await svc.from("portal_plan_items").select("status,pinned_at,released_at,subject").eq("student_id", sid)).data || [];
    const working = items.some((p) => p.status === "נשלח" && !p.pinned_at);
    const lastRel = items.map((p) => p.released_at || "").sort().pop() || "";
    let subj = "";
    if (ev === "idle") { if (working) return J({ skip: "working" }); }
    else {
      const rq = (await svc.from("portal_next_requests").select("subject").eq("student_id", sid).is("handled_at", null)).data || [];
      if (!rq.length) return J({ skip: "no request" });
      subj = String(body.subject && rq.some((r) => r.subject === body.subject) ? body.subject : rq[0].subject);
    }
    // בלי כפולות: כבר נשלחה התראה על הילד/ה מאז השליחה האחרונה אליו/ה (או בדקה האחרונה)
    const last = (await svc.from("portal_push_log").select("sent_at").eq("student_id", sid).order("sent_at", { ascending: false }).limit(1)).data?.[0];
    if (last && (last.sent_at > lastRel || Date.now() - Date.parse(last.sent_at) < 60e3)) return J({ skip: "dup" });

    const st = (await svc.from("students").select("first_name,last_name").eq("id", sid).maybeSingle()).data || {};
    const nm = [st.first_name, st.last_name].filter(Boolean).join(" ").trim() || "תלמיד/ה";
    const text = ev === "req" ? `${nm} ביקש/ה משימה ב${SUBJ_SHORT[subj] || subj}` : `${nm} – אין משימה בעבודה`;
    await svc.from("portal_push_log").insert({ student_id: sid, kind: ev, subject: subj || null });

    webpush.setVapidDetails(SUBJ, PUB, PRIV);
    const subs = (await svc.from("portal_push_subs").select("id,endpoint,p256dh,auth,fails")).data || [];
    const payload = JSON.stringify({ title: "תלם שלי", body: text, tag: "telem-" + sid, url: "./?todo=1" });
    let ok = 0;
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
        ok++; await svc.from("portal_push_subs").update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq("id", s.id); }
      catch (e) { const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410 || (s.fails || 0) >= 9) await svc.from("portal_push_subs").delete().eq("id", s.id);   // הטלפון ביטל / לא קיים
        else await svc.from("portal_push_subs").update({ fails: (s.fails || 0) + 1 }).eq("id", s.id); }
    }));
    return J({ sent: ok, of: subs.length });
  } catch (e) { return J({ error: String((e as Error).message || e) }, 500); }
});
