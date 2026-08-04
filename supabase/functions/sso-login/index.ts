// Supabase Edge Function: sso-login
// ---------------------------------------------------------------------------
// Accepts a prism-platform-issued RS256 session JWT (verified against its
// published JWKS — no shared secret to configure or rotate here), matches it
// to an ACTIVE row in employee_roster (synced from Prism Platform, same gate
// self-signup uses), and mints a real Supabase session via a magic-link
// token_hash — no password prompt, no service-role key ever touches the
// browser.
//
// This has to be an Edge Function rather than a Next.js API route because
// this app builds as a static export (next.config.ts: output: "export",
// deployed to GitHub Pages) — there is no Next.js server at runtime.
//
// JWT verification is OFF for this function (there's no Supabase session
// yet) — deploy with --no-verify-jwt, same as self-signup/send-email.
//
// Deploy:
//   supabase functions deploy sso-login --no-verify-jwt
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@6";

const ALLOWED_ORIGINS = [
  "https://escalations.prismintelligence.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// prism-platform's published public key — RS256, no shared secret.
const PRISM_JWKS_URL = "https://effervescent-gopher-848.convex.site/.well-known/jwks.json";
const prismJwks = createRemoteJWKSet(new URL(PRISM_JWKS_URL));

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

  const token: string = String(body?.token ?? "");
  if (!token) return json({ error: "Missing sign-in token" }, 400, cors);

  let claims: { empId?: string; email?: string; companySlug?: string };
  try {
    const { payload } = await jwtVerify(token, prismJwks, { issuer: "prism-platform" });
    claims = payload as typeof claims;
  } catch {
    return json({ error: "Invalid or expired sign-in link." }, 401, cors);
  }
  if (!claims.empId) {
    return json({ error: "Sign-in token is missing required fields." }, 400, cors);
  }

  const { data: employee } = await admin
    .from("employee_roster")
    .select("emp_id, name, email, department, region, store_code")
    .ilike("emp_id", claims.empId)
    .eq("is_active", true)
    .maybeSingle();

  if (!employee || !employee.email) {
    return json(
      { error: "We couldn't find an active employee record for this account. Contact your manager." },
      404,
      cors,
    );
  }
  const email = employee.email.toLowerCase();

  let store_id: string | null = null;
  if (employee.store_code) {
    const { data: store } = await admin
      .from("stores")
      .select("id")
      .eq("store_code", employee.store_code)
      .maybeSingle();
    store_id = store?.id ?? null;
  }

  // Create the Supabase auth user if this is their first SSO login (mirrors
  // self-signup, minus a user-chosen password — SSO users never need one).
  // "Already registered" is expected and fine — generateLink below resolves
  // the existing user either way, so its error is intentionally ignored.
  await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { name: employee.name, role: "store_team" },
  });

  // Mint a real session without a password prompt: generate a magic-link,
  // return its token_hash for the client to redeem via supabase.auth.verifyOtp.
  // This also resolves the user (data.user) regardless of whether they were
  // just created above or already existed.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.user) {
    return json({ error: linkErr?.message ?? "Could not create sign-in link" }, 500, cors);
  }

  // handle_new_user() (new accounts) or a prior signup already has a profiles
  // row — patch in the roster-derived scope fields either way.
  await admin
    .from("profiles")
    .update({ emp_id: employee.emp_id, department: employee.department, region: employee.region, store_id })
    .eq("id", link.user.id);

  return json({ token_hash: link.properties.hashed_token, email }, 200, cors);
});
