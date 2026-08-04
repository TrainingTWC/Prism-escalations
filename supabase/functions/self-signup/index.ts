// Supabase Edge Function: self-signup
// ---------------------------------------------------------------------------
// First-time login setup for ordinary store staff. Unlike invite-user (which
// requires a super_admin/leadership caller), this is public — anyone can call
// it — but it only creates an account if the email matches an ACTIVE row in
// employee_roster (synced daily from Prism Platform). That roster match is
// the entire gate: this is what "anyone on the employee master can log in"
// means in practice, without letting literally anyone self-register.
//
// New accounts always land as role=store_team (least privilege). Elevated
// roles (dept_owner, area_manager, leadership, super_admin, store_manager)
// stay admin-invite-only via invite-user.
//
// JWT verification is OFF for this function (there's no session yet) —
// deploy with --no-verify-jwt, same as send-email/audit-ingest.
//
// Deploy:
//   supabase functions deploy self-signup --no-verify-jwt
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://escalations.prismintelligence.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }

  const email: string = String(body?.email ?? "").trim().toLowerCase();
  const password: string = String(body?.password ?? "");

  if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400, cors);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400, cors);

  const { data: employee } = await admin
    .from("employee_roster")
    .select("emp_id, name, department, region, store_code")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (!employee) {
    return json(
      { error: "We couldn't find an active employee record for this email. Check the address or contact your manager." },
      404,
      cors,
    );
  }

  let store_id: string | null = null;
  if (employee.store_code) {
    const { data: store } = await admin
      .from("stores")
      .select("id")
      .eq("store_code", employee.store_code)
      .maybeSingle();
    store_id = store?.id ?? null;
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: employee.name, role: "store_team" },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "Could not create account";
    const alreadyExists = /already.*registered|already.*exists/i.test(msg);
    return json(
      { error: alreadyExists ? `${email} already has an account — sign in instead.` : msg },
      alreadyExists ? 409 : 500,
      cors,
    );
  }

  // handle_new_user() already created the profiles row from the metadata above;
  // patch in the roster-derived scope fields it doesn't know about.
  await admin
    .from("profiles")
    .update({ emp_id: employee.emp_id, department: employee.department, region: employee.region, store_id })
    .eq("id", created.user.id);

  return json({ ok: true }, 200, cors);
});
