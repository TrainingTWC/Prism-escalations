// Supabase Edge Function: invite-user
// ---------------------------------------------------------------------------
// Lets a super_admin/leadership dashboard user invite someone by email who has
// never logged in before — e.g. a department owner who needs to be assignable
// in Ticket Routing or the Escalation Matrix's "People to notify" picker.
//
// Uses the Supabase Auth Admin API (service role only, never exposed to the
// browser) to create the auth user and send Supabase's built-in invite email
// (the recipient clicks the link and sets their own password). The existing
// `handle_new_user()` DB trigger creates their `profiles` row from the
// metadata we pass; we then patch in department/region/store_id, which the
// trigger doesn't know about.
//
// JWT verification is left ON (default) so only an authenticated app user can
// call this at all — the super_admin/leadership check below is what actually
// gates it.
//
// Deploy:
//   supabase functions deploy invite-user
// (No extra secrets needed — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// auto-injected into every Edge Function's environment.)
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://escalations.prismintelligence.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const VALID_ROLES = [
  "store_team", "store_manager", "dept_owner", "area_manager", "auditor", "leadership", "super_admin",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function getUserId(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const admin = serviceClient();
  if (!admin) return json({ error: "Server not configured: Supabase service env missing" }, 500, cors);

  const callerId = getUserId(req);
  if (!callerId) return json({ error: "Not authenticated" }, 401, cors);

  const { data: caller } = await admin.from("profiles").select("role").eq("id", callerId).single();
  if (!caller || (caller.role !== "super_admin" && caller.role !== "leadership")) {
    return json({ error: "Only super admins and leadership can invite people" }, 403, cors);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }

  const email: string = String(body?.email ?? "").trim().toLowerCase();
  const name: string = String(body?.name ?? "").trim();
  const role: string = String(body?.role ?? "store_team").trim();
  const department: string | null = body?.department ? String(body.department) : null;
  const region: string | null = body?.region ? String(body.region) : null;
  const store_id: string | null = body?.store_id ? String(body.store_id) : null;

  if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400, cors);
  if (!name) return json({ error: "Name is required" }, 400, cors);
  if (!VALID_ROLES.includes(role)) return json({ error: `Invalid role "${role}"` }, 400, cors);
  // Only a super_admin can mint another super_admin — leadership is capped below that.
  if (role === "super_admin" && caller.role !== "super_admin") {
    return json({ error: "Only a super admin can invite another super admin" }, 403, cors);
  }

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name, role },
  });

  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message ?? "Could not send invite";
    const alreadyExists = /already.*registered|already.*exists/i.test(msg);
    return json(
      { error: alreadyExists ? `${email} already has an account` : msg },
      alreadyExists ? 409 : 500,
      cors,
    );
  }

  // handle_new_user() already created the profiles row from the metadata above;
  // patch in the scope fields it doesn't know about.
  if (department || region || store_id) {
    await admin
      .from("profiles")
      .update({ department, region, store_id })
      .eq("id", invited.user.id);
  }

  return json({ ok: true, userId: invited.user.id }, 200, cors);
});
