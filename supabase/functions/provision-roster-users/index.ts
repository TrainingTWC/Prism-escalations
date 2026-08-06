// Supabase Edge Function: provision-roster-users
// ---------------------------------------------------------------------------
// Gives every active employee_roster row a dashboard account — silently.
//
// This replaces invite-user (deleted). The old flow emailed a Supabase
// invitation and the account only materialised once the person clicked the
// link, which meant Owner/assignee pickers stayed empty and 2,000-odd people
// would have needed 2,000-odd invite emails. Here, `createUser` makes the
// auth user (and via handle_new_user(), the profile) with NO password and NO
// email of any kind. The account just sits there until the employee shows up
// on their own — SSO from Prism Platform, or /login/setup to set a password.
//
// Called two ways:
//   • Team page, super_admin/leadership, looping until remaining = 0 (backfill)
//   • pg_cron nightly at 02:15 IST via dispatch_roster_provisioning(),
//     authenticated with the service-role key
//
// JWT verification stays ON (same as the invite-user it replaces) — the cron
// passes the service-role key, which satisfies it.
//
// Deploy:
//   supabase functions deploy provision-roster-users
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://escalations.prismintelligence.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// How many auth users we're willing to create in one invocation. Each
// createUser is a round trip to GoTrue; 400 at a concurrency of 6 sits
// comfortably inside the Edge Function wall clock.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 400;
const CONCURRENCY = 6;

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

interface RosterEmployee {
  emp_id: string;
  name: string;
  email: string;
  department: string | null;
  region: string | null;
  store_code: string | null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server not configured: Supabase service env missing" }, 500, cors);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ── Authorisation ────────────────────────────────────────────────────
  // Either the nightly cron (service-role key verbatim) or a signed-in
  // super_admin / leadership. Never the browser's anon key.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing Authorization header" }, 401, cors);

  const isCron = token === serviceKey;
  if (!isCron) {
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return json({ error: "Not authenticated" }, 401, cors);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .maybeSingle();

    if (!callerProfile || !["super_admin", "leadership"].includes(callerProfile.role)) {
      return json({ error: "Only super admins and leadership can provision dashboard users" }, 403, cors);
    }
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — cron sends a limit, a bare ping doesn't have to */
  }

  const limit = Math.min(Math.max(Number(body?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  // ── Who still needs an account? ──────────────────────────────────────
  const { data: employees, error: rosterErr } = await admin.rpc("unprovisioned_roster_employees", {
    p_limit: limit,
  });

  if (rosterErr) {
    return json({ error: `Could not read the roster: ${rosterErr.message}` }, 500, cors);
  }

  const batch = (employees ?? []) as RosterEmployee[];

  // Resolve store_code → store_id once for the whole batch rather than per employee.
  const storeMap = new Map<string, string>();
  const codes = Array.from(new Set(batch.map((e) => e.store_code).filter(Boolean))) as string[];
  if (codes.length > 0) {
    const { data: stores } = await admin.from("stores").select("id, store_code").in("store_code", codes);
    for (const s of (stores ?? []) as { id: string; store_code: string }[]) {
      storeMap.set(s.store_code, s.id);
    }
  }

  let created = 0;
  let linked = 0;
  const failures: { email: string; reason: string }[] = [];

  async function provision(emp: RosterEmployee) {
    const email = emp.email.trim().toLowerCase();
    const scope = {
      emp_id: emp.emp_id,
      department: emp.department,
      region: emp.region,
      store_id: emp.store_code ? storeMap.get(emp.store_code) ?? null : null,
    };

    // No password, no email_confirm link, no invite — nothing leaves the
    // building. Least privilege: everyone lands as store_team and gets
    // elevated by hand on the Team page.
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: emp.name, role: "store_team" },
    });

    if (createErr || !createdUser?.user) {
      const msg = createErr?.message ?? "createUser returned no user";

      // Already in auth.users but not matched by the roster query — i.e. an
      // older account whose profile never got an emp_id. Stamp it so this
      // employee stops coming back as unprovisioned on every run.
      if (/already.*(registered|exists)/i.test(msg)) {
        const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
        if (existing) {
          await admin.from("profiles").update(scope).eq("id", existing.id);
          linked++;
          return;
        }
      }

      failures.push({ email, reason: msg });
      return;
    }

    // handle_new_user() already wrote name/email/role from the metadata above;
    // patch in the roster-derived scope fields the trigger doesn't know about.
    const { error: patchErr } = await admin.from("profiles").update(scope).eq("id", createdUser.user.id);
    if (patchErr) {
      failures.push({ email, reason: `Account created but scope patch failed: ${patchErr.message}` });
      return;
    }

    created++;
  }

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(provision));
  }

  // A short batch means we've drained the queue — settle leavers on the way out.
  let departed: { deactivated: number; reactivated: number } | null = null;
  if (batch.length < limit) {
    const { data: dep } = await admin.rpc("sync_departed_profiles");
    const row = Array.isArray(dep) ? dep[0] : dep;
    if (row) departed = { deactivated: row.deactivated ?? 0, reactivated: row.reactivated ?? 0 };
  }

  const { data: remaining } = await admin.rpc("unprovisioned_roster_count");

  return json(
    {
      ok: true,
      created,
      linked,
      failed: failures.length,
      failures: failures.slice(0, 10),
      remaining: typeof remaining === "number" ? remaining : 0,
      departed,
    },
    200,
    cors,
  );
});
