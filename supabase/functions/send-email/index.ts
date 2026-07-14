// ---------------------------------------------------------------------------
// send-email — transactional email for Prism Escalations via Resend.
//
// Called by Postgres (dispatch_email → pg_net) on ticket lifecycle events:
//   created · resolved (verify request) · reopened · closed · rejected ·
//   blocked · sla_breach · verify_reminder
//
// Auth: shared secret header (machine-to-machine), NOT a user JWT.
//   Deploy:  supabase functions deploy send-email --no-verify-jwt
//   Secrets:
//     supabase secrets set EMAIL_FN_SECRET=<long-random-string>
//     supabase secrets set RESEND_API_KEY=<re_xxx from resend.com>
//     supabase secrets set EMAIL_FROM="Prism Escalations <alerts@prismintelligence.in>"
//     supabase secrets set APP_URL=https://escalations.prismintelligence.in
//   (EMAIL_FROM falls back to Resend's sandbox sender for dev testing —
//    sandbox mail only delivers to the Resend account owner's address.)
//
// Request body (built by public.ticket_event_payload in Postgres):
//   {
//     "event": "created" | "resolved" | "reopened" | "closed" | "rejected"
//            | "blocked" | "sla_breach" | "verify_reminder",
//     "recipients": [{ "email": "...", "name": "..." }],
//     "ticket": { "id","code","title","severity","status","category",
//                 "store","region","path" },
//     "actor": "Name of who did it",
//     "reason": "...",             // blocked only
//     "resolvedAgoHours": 26       // verify_reminder only
//   }
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-email-secret",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── per-event copy ──────────────────────────────────────────────────────────
interface EventCopy {
  subject: (t: any, p: any) => string;
  headline: string;
  intro: (t: any, p: any) => string;
  cta: string;
  tone: string; // accent colour of the header bar
}

const EVENTS: Record<string, EventCopy> = {
  created: {
    subject: (t) => `[${t.severity}] New ticket ${t.code} — ${t.title}`,
    headline: "New ticket assigned to you",
    intro: (t, p) =>
      `${p.actor} raised a ${t.severity} ${t.category} issue at ${t.store}. It has been routed to you — open it, tap "Start work", fix it, and mark it done.`,
    cta: "Open ticket",
    tone: "#E07B39",
  },
  resolved: {
    subject: (t) => `Please verify: ${t.code} — ${t.title}`,
    headline: "Fixed — awaiting your verification",
    intro: (t, p) =>
      `${p.actor} marked this ${t.category} issue at ${t.store} as fixed. Please check the fix and tap "Verify & close" — or reopen it if the problem is still there.`,
    cta: "Verify now",
    tone: "#22C55E",
  },
  reopened: {
    subject: (t) => `Reopened: ${t.code} — ${t.title}`,
    headline: "Fix not verified — ticket reopened",
    intro: (t, p) =>
      `${p.actor} checked the fix for this ${t.category} issue at ${t.store} and it did not hold. The ticket is back with you.`,
    cta: "View ticket",
    tone: "#EF4444",
  },
  closed: {
    subject: (t) => `Closed: ${t.code} — ${t.title}`,
    headline: "Verified & closed",
    intro: (t, p) =>
      `${p.actor} verified the fix for this ${t.category} issue at ${t.store}. The ticket is closed — nothing more to do.`,
    cta: "View ticket",
    tone: "#22C55E",
  },
  rejected: {
    subject: (t) => `Rejected: ${t.code} — ${t.title}`,
    headline: "Ticket rejected",
    intro: (t, p) =>
      `${p.actor} rejected this ticket as invalid or not actionable. If you believe this is wrong, raise it again with more detail or contact your manager.`,
    cta: "View ticket",
    tone: "#EF4444",
  },
  blocked: {
    subject: (t) => `Blocked: ${t.code} — ${t.title}`,
    headline: "Work is blocked",
    intro: (t, p) =>
      `${p.actor} hit a snag on this ${t.category} issue at ${t.store}: "${p.reason ?? "no reason given"}". It may need your help to unblock.`,
    cta: "View ticket",
    tone: "#EAB308",
  },
  sla_breach: {
    subject: (t) => `⚠ SLA breached: ${t.code} — ${t.title}`,
    headline: "SLA breached",
    intro: (t) =>
      `This ${t.severity} ${t.category} issue at ${t.store} has passed its SLA deadline and is still unresolved. It needs immediate attention.`,
    cta: "Act now",
    tone: "#EF4444",
  },
  verify_reminder: {
    subject: (t) => `Reminder — verify ${t.code}: ${t.title}`,
    headline: "Still awaiting your verification",
    intro: (t, p) =>
      `This ${t.category} issue at ${t.store} was marked fixed ${p.resolvedAgoHours ?? "24"}+ hours ago and is waiting for you to verify. Unverified tickets auto-close after 7 days.`,
    cta: "Verify now",
    tone: "#EAB308",
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  P0: "#EF4444",
  P1: "#EAB308",
  P2: "#3B82F6",
  P3: "#7A7A88",
};

function renderHtml(event: string, payload: any, appUrl: string): string {
  const t = payload.ticket ?? {};
  const copy = EVENTS[event];
  const link = `${appUrl}${t.path ?? "/tickets"}`;
  const sevColor = SEVERITY_COLOR[t.severity] ?? "#7A7A88";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0C0C0F;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;padding-bottom:18px;">
      <span style="font-size:12px;font-weight:800;letter-spacing:0.22em;color:#A1A1AE;">PRISM ESCALATIONS</span>
    </div>
    <div style="background:#141418;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
      <div style="height:4px;background:${copy.tone};"></div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 6px;font-size:19px;line-height:1.3;color:#E4E4E9;">${copy.headline}</h1>
        <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#A1A1AE;">${copy.intro(t, payload)}</p>

        <div style="background:#0C0C0F;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 18px;margin-bottom:22px;">
          <div style="margin-bottom:8px;">
            <span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:0.06em;color:${sevColor};border:1px solid ${sevColor}55;border-radius:99px;padding:3px 9px;margin-right:6px;">${t.severity ?? ""}</span>
            <span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#A1A1AE;border:1px solid rgba(255,255,255,0.14);border-radius:99px;padding:3px 9px;">${t.category ?? ""}</span>
          </div>
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#E4E4E9;">${t.title ?? ""}</p>
          <p style="margin:0;font-size:12px;color:#7A7A88;">#${t.code ?? ""} · ${t.store ?? ""}${t.region ? " · " + t.region : ""}</p>
        </div>

        <a href="${link}"
           style="display:block;text-align:center;background:linear-gradient(135deg,#C76A2E,#E07B39);color:#1A0E05;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;padding:13px 18px;">
          ${copy.cta} →
        </a>
      </div>
    </div>
    <p style="text-align:center;font-size:10px;color:#52525E;padding-top:18px;letter-spacing:0.08em;">
      Automated notification · Prism Intelligence Operational Platform
    </p>
  </div>
</body>
</html>`;
}

// ─── handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("EMAIL_FN_SECRET");
  if (!secret || req.headers.get("x-email-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY not set" }, 500);

  const from = Deno.env.get("EMAIL_FROM") ?? "Prism Escalations <onboarding@resend.dev>";
  const appUrl = (Deno.env.get("APP_URL") ?? "https://escalations.prismintelligence.in")
    .replace(/\/$/, "");

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const event = String(payload.event ?? "");
  const copy = EVENTS[event];
  if (!copy) return json({ error: `unknown event: ${event}` }, 400);

  const recipients: { email: string; name?: string }[] = Array.isArray(payload.recipients)
    ? payload.recipients.filter((r: any) => r && typeof r.email === "string" && r.email.includes("@"))
    : [];
  if (recipients.length === 0) return json({ sent: 0, reason: "no recipients" });

  const t = payload.ticket ?? {};
  const html = renderHtml(event, payload, appUrl);
  const subject = copy.subject(t, payload);

  // One API call, individual delivery (bcc-like) so recipients don't see each other
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      recipients.map((r) => ({
        from,
        to: [r.email],
        subject,
        html,
      })),
    ),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("resend error", res.status, JSON.stringify(body));
    return json({ error: "resend failed", status: res.status, detail: body }, 502);
  }

  return json({ sent: recipients.length, event });
});
