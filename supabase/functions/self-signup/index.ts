// Supabase Edge Function: self-signup
// ---------------------------------------------------------------------------
// First-time login setup for staff who aren't coming in via Prism Platform
// SSO. This is public — anyone can call it — but it only proceeds if the
// email matches an ACTIVE row in employee_roster (synced daily from Prism
// Platform). That roster match is the entire gate: this is what "anyone on
// the employee master can log in" means in practice, without letting
// literally anyone self-register.
//
// Most callers won't be creating anything: provision-roster-users has
// already made a passwordless account for every active employee, so this
// mostly sets the password on an account that exists but has never been
// signed into. There is no invitation email anywhere in this flow.
//
// New accounts always land as role=store_team (least privilege). Elevated
// roles (dept_owner, area_manager, leadership, super_admin, store_manager)
// are granted by hand on the Team page.
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

  const scope = {
    emp_id: employee.emp_id,
    department: employee.department,
    region: employee.region,
    store_id,
  };

  // Since provision-roster-users runs nightly, the overwhelming case is that an
  // account ALREADY exists for this person — created silently, with no password,
  // never touched. "First-time setup" then means claiming it, not creating it.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingProfile) {
    const { data: existingUser } = await admin.auth.admin.getUserById(existingProfile.id);

    // A sign-in on record means this is a live account with a password its owner
    // knows — sending them down the reset path is the only safe answer.
    if (existingUser?.user?.last_sign_in_at) {
      return json({ error: `${email} already has an account — sign in instead.` }, 409, cors);
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(existingProfile.id, {
      password,
      email_confirm: true,
    });
    if (pwErr) return json({ error: pwErr.message }, 500, cors);

    await admin.from("profiles").update(scope).eq("id", existingProfile.id);
    return json({ ok: true }, 200, cors);
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
  await admin.from("profiles").update(scope).eq("id", created.user.id);

  return json({ ok: true }, 200, cors);
});
