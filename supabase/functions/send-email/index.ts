// ---------------------------------------------------------------------------
// send-email — transactional email for Prism Escalations via Resend.
//
// Called by Postgres (dispatch_email → pg_net) on ticket + asset events:
//   Tickets: created · resolved · reopened · closed · rejected · blocked ·
//            sla_breach · verify_reminder · escalated
//   Assets:  coverage_expiring · coverage_expired · pm_due · vendor_dispatch ·
//            transfer_requested
//
// Auth: shared secret header (machine-to-machine), NOT a user JWT.
//   Deploy:  supabase functions deploy send-email --no-verify-jwt
//   Secrets: EMAIL_FN_SECRET, RESEND_API_KEY, EMAIL_FROM, APP_URL
//
// Request body shape (built in Postgres):
//   {
//     "event": "...",
//     "recipients": [{ "email": "...", "name": "..." }],
//     "ticket"?: { id,code,title,severity,status,category,store,region,path },
//     "asset"?:  { name,code,category,store,region,path,
//                  coverageKind?, coverageUntil?,          // coverage events
//                  storePhone?, storeAddress? },            // vendor_dispatch
//     "pm"?:     { title, overdueDays },                    // pm_due
//     "vendor"?: { name, slaHours },                        // vendor_dispatch
//     "actor"?:  "Name",
//     "reason"?: "...",              // blocked
//     "resolvedAgoHours"?: 26        // verify_reminder
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

type CardKind = "ticket" | "asset" | "vendor" | "none";

interface EventCopy {
  subject: (p: any) => string;
  headline: string;
  intro: (p: any) => string;
  cta: string | null;      // null → no button (e.g. vendor with no app login)
  tone: string;            // accent colour of the header bar
  card: CardKind;
}

const EVENTS: Record<string, EventCopy> = {
  // ── Ticket lifecycle ──────────────────────────────────────────────────────
  created: {
    subject: (p) => `[${p.ticket.severity}] New ticket ${p.ticket.code} — ${p.ticket.title}`,
    headline: "New ticket assigned to you",
    intro: (p) =>
      `${p.actor} raised a ${p.ticket.severity} ${p.ticket.category} issue at ${p.ticket.store}. It has been routed to you — open it, tap "Start work", fix it, and mark it done.`,
    cta: "Open ticket",
    tone: "#E07B39",
    card: "ticket",
  },
  resolved: {
    subject: (p) => `Please verify: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "Fixed — awaiting your verification",
    intro: (p) =>
      `${p.actor} marked this ${p.ticket.category} issue at ${p.ticket.store} as fixed. Please check the fix and tap "Verify & close" — or reopen it if the problem is still there.`,
    cta: "Verify now",
    tone: "#22C55E",
    card: "ticket",
  },
  reopened: {
    subject: (p) => `Reopened: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "Fix not verified — ticket reopened",
    intro: (p) =>
      `${p.actor} checked the fix for this ${p.ticket.category} issue at ${p.ticket.store} and it did not hold. The ticket is back with you.`,
    cta: "View ticket",
    tone: "#EF4444",
    card: "ticket",
  },
  closed: {
    subject: (p) => `Closed: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "Verified & closed",
    intro: (p) =>
      `${p.actor} verified the fix for this ${p.ticket.category} issue at ${p.ticket.store}. The ticket is closed — nothing more to do.`,
    cta: "View ticket",
    tone: "#22C55E",
    card: "ticket",
  },
  rejected: {
    subject: (p) => `Rejected: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "Ticket rejected",
    intro: (p) =>
      `${p.actor} rejected this ticket as invalid or not actionable. If you believe this is wrong, raise it again with more detail or contact your manager.`,
    cta: "View ticket",
    tone: "#EF4444",
    card: "ticket",
  },
  blocked: {
    subject: (p) => `Blocked: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "Work is blocked",
    intro: (p) =>
      `${p.actor} hit a snag on this ${p.ticket.category} issue at ${p.ticket.store}: "${p.reason ?? "no reason given"}". It may need your help to unblock.`,
    cta: "View ticket",
    tone: "#EAB308",
    card: "ticket",
  },
  sla_breach: {
    subject: (p) => `⚠ SLA breached: ${p.ticket.code} — ${p.ticket.title}`,
    headline: "SLA breached",
    intro: (p) =>
      `This ${p.ticket.severity} ${p.ticket.category} issue at ${p.ticket.store} has passed its SLA deadline and is still unresolved. It needs immediate attention.`,
    cta: "Act now",
    tone: "#EF4444",
    card: "ticket",
  },
  verify_reminder: {
    subject: (p) => `Reminder — verify ${p.ticket.code}: ${p.ticket.title}`,
    headline: "Still awaiting your verification",
    intro: (p) =>
      `This ${p.ticket.category} issue at ${p.ticket.store} was marked fixed ${p.resolvedAgoHours ?? "24"}+ hours ago and is waiting for you to verify. Unverified tickets auto-close after 7 days.`,
    cta: "Verify now",
    tone: "#EAB308",
    card: "ticket",
  },
  escalated: {
    subject: (p) => `Escalation L${p.level} — ${p.ticket.code}: ${p.ticket.title}`,
    headline: "Escalated to you",
    intro: (p) =>
      `This ${p.ticket.severity} ${p.ticket.category} issue at ${p.ticket.store} passed its SLA deadline and has reached escalation level ${p.level}. You've been looped in to help drive it to resolution — it stays with its current owner, but it now needs your attention.`,
    cta: "View ticket",
    tone: "#EF4444",
    card: "ticket",
  },

  // ── Asset coverage ────────────────────────────────────────────────────────
  coverage_expiring: {
    subject: (p) => `${p.asset.coverageKind} expiring soon — ${p.asset.name}`,
    headline: "Coverage expiring within 30 days",
    intro: (p) =>
      `The ${p.asset.coverageKind} on ${p.asset.name} at ${p.asset.store} expires on ${p.asset.coverageUntil}. Renew it before then to keep repairs covered — after expiry, faults on this asset fall back to internal teams.`,
    cta: "Review asset",
    tone: "#EAB308",
    card: "asset",
  },
  coverage_expired: {
    subject: (p) => `${p.asset.coverageKind} expired — ${p.asset.name}`,
    headline: "Coverage has expired",
    intro: (p) =>
      `The ${p.asset.coverageKind} on ${p.asset.name} at ${p.asset.store} expired on ${p.asset.coverageUntil}. This asset is no longer covered — renew the contract or budget for out-of-warranty repairs.`,
    cta: "Review asset",
    tone: "#EF4444",
    card: "asset",
  },

  // ── Preventive maintenance ────────────────────────────────────────────────
  pm_due: {
    subject: (p) => `Maintenance due — ${p.pm.title} · ${p.asset.name}`,
    headline: "Preventive maintenance is due",
    intro: (p) =>
      `"${p.pm.title}" on ${p.asset.name} at ${p.asset.store} is ${p.pm.overdueDays > 0 ? `${p.pm.overdueDays} day(s) overdue` : "due now"}. Complete it and mark it done so the schedule resets.`,
    cta: "Open asset",
    tone: "#E07B39",
    card: "asset",
  },

  // ── Vendor dispatch (recipient is the AMC vendor, not an app user) ─────────
  vendor_dispatch: {
    subject: (p) => `Service request — ${p.asset.name} @ ${p.asset.store} [${p.ticket.severity}]`,
    headline: "New service request under your AMC",
    intro: (p) =>
      `A fault has been reported on ${p.asset.name} (${p.asset.code}) at ${p.asset.store}, which is covered under your AMC${p.vendor?.slaHours ? ` with a ${p.vendor.slaHours}-hour response SLA` : ""}. Details below — please arrange a service visit.`,
    cta: null,
    tone: "#7C5CFF",
    card: "vendor",
  },

  // ── Inter-store asset transfers ──────────────────────────────────────────
  transfer_requested: {
    subject: (p) => `Transfer requested — ${p.asset.name}`,
    headline: "Asset transfer requested",
    intro: (p) =>
      `A transfer has been requested for ${p.asset.name}: ${p.transfer.fromStore} → ${p.transfer.toStore}.` +
      (p.transfer.notes ? ` Note: "${p.transfer.notes}"` : "") +
      ` Open the asset to advance or cancel the transfer.`,
    cta: "Review asset",
    tone: "#7C5CFF",
    card: "asset",
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  P0: "#EF4444",
  P1: "#EAB308",
  P2: "#3B82F6",
  P3: "#7A7A88",
};

function ticketCard(t: any): string {
  const sevColor = SEVERITY_COLOR[t.severity] ?? "#7A7A88";
  return `
    <div style="background:#0C0C0F;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 18px;margin-bottom:22px;">
      <div style="margin-bottom:8px;">
        <span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:0.06em;color:${sevColor};border:1px solid ${sevColor}55;border-radius:99px;padding:3px 9px;margin-right:6px;">${t.severity ?? ""}</span>
        <span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#A1A1AE;border:1px solid rgba(255,255,255,0.14);border-radius:99px;padding:3px 9px;">${t.category ?? ""}</span>
      </div>
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#E4E4E9;">${t.title ?? ""}</p>
      <p style="margin:0;font-size:12px;color:#7A7A88;">#${t.code ?? ""} · ${t.store ?? ""}${t.region ? " · " + t.region : ""}</p>
    </div>`;
}

function assetCard(a: any): string {
  return `
    <div style="background:#0C0C0F;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 18px;margin-bottom:22px;">
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#E4E4E9;">${a.name ?? ""}</p>
      <p style="margin:0;font-size:12px;color:#7A7A88;">${a.code ?? ""}${a.category ? " · " + a.category : ""} · ${a.store ?? ""}${a.region ? " · " + a.region : ""}</p>
      ${a.coverageUntil ? `<p style="margin:8px 0 0;font-size:12px;color:#A1A1AE;">${a.coverageKind}: <b style="color:#E4E4E9;">${a.coverageUntil}</b></p>` : ""}
    </div>`;
}

function vendorCard(p: any): string {
  const a = p.asset ?? {};
  const t = p.ticket ?? {};
  const sevColor = SEVERITY_COLOR[t.severity] ?? "#7A7A88";
  const rows: string[] = [
    ["Asset", `${a.name ?? ""} (${a.code ?? ""})`],
    ["Reported issue", t.title ?? ""],
    ["Severity", t.severity ?? ""],
    ["Store", `${a.store ?? ""}${a.region ? " · " + a.region : ""}`],
    a.storeAddress ? ["Address", a.storeAddress] : null,
    a.storePhone ? ["Store phone", a.storePhone] : null,
  ].filter(Boolean).map((r) => {
    const [k, v] = r as string[];
    return `<tr>
      <td style="padding:6px 0;font-size:11px;color:#7A7A88;vertical-align:top;white-space:nowrap;padding-right:14px;">${k}</td>
      <td style="padding:6px 0;font-size:13px;color:#E4E4E9;font-weight:600;">${v}</td>
    </tr>`;
  });
  return `
    <div style="background:#0C0C0F;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 18px;margin-bottom:22px;">
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:0.06em;color:${sevColor};border:1px solid ${sevColor}55;border-radius:99px;padding:3px 9px;">${t.severity ?? ""}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rows.join("")}</table>
    </div>`;
}

function renderHtml(event: string, payload: any, appUrl: string): string {
  const copy = EVENTS[event];
  const card =
    copy.card === "ticket" ? ticketCard(payload.ticket ?? {})
    : copy.card === "asset" ? assetCard(payload.asset ?? {})
    : copy.card === "vendor" ? vendorCard(payload)
    : "";

  const linkPath = payload.ticket?.path ?? payload.asset?.path ?? "/";
  const link = `${appUrl}${linkPath}`;
  const button = copy.cta
    ? `<a href="${link}" style="display:block;text-align:center;background:linear-gradient(135deg,#C76A2E,#E07B39);color:#1A0E05;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;padding:13px 18px;">${copy.cta} →</a>`
    : "";

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
        <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#A1A1AE;">${copy.intro(payload)}</p>
        ${card}
        ${button}
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

  const html = renderHtml(event, payload, appUrl);
  const subject = copy.subject(payload);

  // One API call, individual delivery (bcc-like) so recipients don't see each other
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      recipients.map((r) => ({ from, to: [r.email], subject, html })),
    ),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("resend error", res.status, JSON.stringify(body));
    return json({ error: "resend failed", status: res.status, detail: body }, 502);
  }

  return json({ sent: recipients.length, event });
});
