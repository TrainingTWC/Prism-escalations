// ---------------------------------------------------------------------------
// send-push — deliver background push notifications to the Prism Escalations
// Android APK via Firebase Cloud Messaging (FCM HTTP v1).
//
// Called by Postgres (dispatch_push → pg_net) on new tickets and SLA breaches,
// or directly for ad-hoc pushes. Targets are resolved from `device_tokens`.
//
// Auth: shared secret header (machine-to-machine), NOT a user JWT.
//   Deploy:  supabase functions deploy send-push --no-verify-jwt
//   Secrets:
//     supabase secrets set PUSH_FN_SECRET=<long-random-string>
//     supabase secrets set FCM_SERVICE_ACCOUNT='<paste full service-account JSON>'
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//
// Request body:
//   {
//     "title": "...", "body": "...",
//     "data":  { "ticketId": "...", "path": "/tickets/view/?id=..." },
//     "user_ids": ["uuid", ...],        // optional — target these users
//     "tokens":   ["fcm-token", ...],   // optional — target raw tokens
//     "all": true                       // optional — every registered device
//   }
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
};

// ─── OAuth token (cached in-memory per warm instance) ────────────────────────
let cachedToken: { value: string; exp: number } | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`oauth failed: ${JSON.stringify(json)}`);

  cachedToken = { value: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cachedToken.value;
}

// ─── handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const secret = Deno.env.get("PUSH_FN_SECRET");
  if (!secret || req.headers.get("x-push-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!saRaw) {
    return new Response(JSON.stringify({ error: "FCM_SERVICE_ACCOUNT not set" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const sa: ServiceAccount = JSON.parse(saRaw);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve target device tokens.
  const tokenSet = new Set<string>();
  if (Array.isArray(payload.tokens)) {
    for (const t of payload.tokens) if (typeof t === "string") tokenSet.add(t);
  }

  let query = supabase.from("device_tokens").select("token");
  if (!payload.all) {
    const ids: string[] = Array.isArray(payload.user_ids) ? payload.user_ids : [];
    if (ids.length === 0 && tokenSet.size === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no targets" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (ids.length > 0) {
      const { data } = await query.in("user_id", ids);
      for (const row of data ?? []) tokenSet.add((row as any).token);
    }
  } else {
    const { data } = await query;
    for (const row of data ?? []) tokenSet.add((row as any).token);
  }

  const tokens = [...tokenSet];
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const accessToken = await getAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  // FCM data values must be strings.
  const data: Record<string, string> = {};
  if (payload.data && typeof payload.data === "object") {
    for (const [k, v] of Object.entries(payload.data)) data[k] = String(v);
  }

  let sent = 0;
  const stale: string[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      const message = {
        message: {
          token,
          notification: {
            title: payload.title ?? "Prism Escalations",
            body: payload.body ?? "",
          },
          data,
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "prism_alerts",
              default_sound: true,
              default_vibrate_timings: true,
              notification_priority: "PRIORITY_HIGH",
            },
          },
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (res.ok) {
        sent++;
      } else if (res.status === 404 || res.status === 410) {
        stale.push(token); // UNREGISTERED / NOT_FOUND
      }
    }),
  );

  // Prune dead tokens.
  if (stale.length > 0) {
    await supabase.from("device_tokens").delete().in("token", stale);
  }

  return new Response(JSON.stringify({ sent, pruned: stale.length, targeted: tokens.length }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
