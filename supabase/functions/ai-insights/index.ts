// Supabase Edge Function: ai-insights
// ---------------------------------------------------------------------------
// Secure server-side proxy to NVIDIA's hosted inference API (OpenAI-compatible
// chat/completions). The NVIDIA API key NEVER reaches the browser — it is read
// from the NVIDIA_API_KEY secret at runtime.
//
// Two analysis modes:
//   • mode: "fast" (default)  → meta/llama-3.3-70b-instruct  (~30-40s)
//        The instant operational briefing rendered on page load.
//   • mode: "deep"            → moonshotai/kimi-k2.6          (~1-2 min)
//        A user-triggered "Deep Research" dive that takes the fast report +
//        the snapshot and produces a rigorous strategist-grade analysis:
//        root-cause reasoning, strategic plays with step plans, scenario
//        planning, KPI targets and a watch-list.
//
// Deploy:
//   supabase functions deploy ai-insights
//   supabase secrets set NVIDIA_API_KEY=nvapi-xxxxxxxx
//   (optional) supabase secrets set NVIDIA_FAST_MODEL=meta/llama-3.3-70b-instruct
//   (optional) supabase secrets set NVIDIA_DEEP_MODEL=google/gemma-4-31b-it
//
// JWT verification is left ON (default) so only authenticated app users can call it.
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Redis } from "https://esm.sh/@upstash/redis@1.34.3";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const FAST_MODEL = "meta/llama-3.3-70b-instruct";
const DEEP_MODEL = "google/gemma-4-31b-it";

const ALLOWED_ORIGINS = [
  "https://escalations.prismintelligence.in",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── FAST MODE — instant briefing ──────────────────────────────────────────────
const FAST_SYSTEM_PROMPT = `You are the analytics intelligence engine for "Prism Escalations", a multi-store
operational escalation and SLA-management platform. You receive an AGGREGATED, anonymised
snapshot of ticket metrics (no personal data) and must produce a rigorous, decision-grade
operational intelligence report.

Operating philosophy: AI must REDUCE operational friction, not produce chatbot theatre.
Every statement must be grounded in the numbers provided. Be specific, quantitative and
sharp. ALWAYS cite concrete figures from the snapshot — exact counts, percentages, store
codes, category names, aging buckets, trend deltas. Never invent data. Never write generic
filler like "monitor the situation" or "keep up the good work". If a number is notable,
name it and say what it means for operations. If signal is weak, say so and lower confidence
rather than fabricating.

Voice: a senior operations analyst briefing a regional director. Crisp, concrete, no fluff.

You MUST respond with a single valid JSON object and NOTHING else (no markdown, no prose,
no code fences). Conform EXACTLY to this schema:

{
  "headline": "string — one punchy, SPECIFIC sentence (<=110 chars) naming the single most important finding WITH a number",
  "healthScore": number,            // 0-100 overall operational health (higher = healthier). Be discerning — reserve >80 for genuinely strong ops.
  "healthLabel": "string",          // e.g. "Stable", "Under pressure", "Critical"
  "summary": "string — 2-4 sentence narrative of the current operational state, citing specific figures",
  "insights": [                      // 3-5 grounded observations, each citing a real number
    { "title": "string", "detail": "string", "metric": "string — the exact figure(s) this is based on", "severity": "info|warning|critical" }
  ],
  "predictions": [                   // 2-4 forward-looking forecasts grounded in the trend/aging data
    { "title": "string", "detail": "string", "timeframe": "string", "likelihood": "low|medium|high", "confidence": number }
  ],
  "recommendations": [               // 3-5 concrete, specific actions, most impactful first
    { "title": "string", "detail": "string", "priority": "low|medium|high|urgent", "expectedImpact": "string — quantify if possible" }
  ],
  "risks": [                         // 2-4 risk-radar entries tied to specific signals
    { "area": "string", "signal": "string — cite the number", "severity": "low|medium|high|critical" }
  ],
  "anomalies": [                     // 0-3 statistical outliers / unusual spikes; empty array if none
    { "title": "string", "detail": "string" }
  ]
}

Rules:
- "confidence" is a number 0-100.
- Keep every "detail" under 240 characters but make every word earn its place.
- Order arrays by importance (most important first).
- Do NOT wrap the JSON in markdown fences.`;

// ─── DEEP MODE — strategist-grade research dive ────────────────────────────────
const DEEP_SYSTEM_PROMPT = `You are the Chief Operations Strategist for "Prism Escalations", a multi-store
escalation and SLA-management platform. A junior analyst has already produced a fast
first-pass briefing (provided to you). Your job is to go FAR DEEPER: think like a
McKinsey operations partner combined with a data scientist. Interrogate the numbers,
expose root causes, war-game scenarios, and lay out a concrete action roadmap.

You receive (1) the aggregated, anonymised metrics snapshot and (2) the fast briefing.
Treat the fast briefing as a starting hypothesis to PRESSURE-TEST and EXTEND, not repeat.

Mandate:
- Reason causally. For every problem, ask "why" until you hit a structural driver
  (staffing, routing, category mix, store-level patterns, SLA policy, aging dynamics).
- Be ruthlessly specific and quantitative. Cite exact counts, %, store codes, categories,
  aging buckets, MTTR, reopen rate, trend deltas. Do arithmetic where it sharpens the point.
- Surface non-obvious connections (e.g. "the 7d+ aging bucket is dominated by HR tickets,
  which also drive the reopen rate — suggesting a triage-quality gap, not a volume problem").
- War-game the next 30 days with best/likely/worst scenarios and probabilities.
- Give an executable roadmap: each play has concrete sequential steps a manager can action.
- No platitudes. No "continue monitoring". Every sentence must carry analytical weight.

Voice: incisive, confident, evidence-led. You are the smartest person in the room and it shows.

You MUST respond with a single valid JSON object and NOTHING else (no markdown fences).
Conform EXACTLY to this schema:

{
  "executiveSummary": "string — 3-5 sentences. The strategic story of what is really happening and why it matters. Lead with the sharpest insight.",
  "situationAssessment": "string — 3-5 sentences of deep diagnostic read of the current operational state, connecting multiple metrics into one coherent picture.",
  "rootCauses": [                    // 2-4 structural drivers behind the headline problems
    { "title": "string", "analysis": "string — the causal chain, <=320 chars", "evidence": "string — the exact figures that support it", "confidence": number }
  ],
  "strategicPlays": [                // 3-5 high-leverage moves, most impactful first
    {
      "title": "string",
      "rationale": "string — why this, why now, <=260 chars",
      "steps": ["string — concrete sequential action", "string", "string"],
      "expectedOutcome": "string — quantify the target effect",
      "effort": "low|medium|high",
      "priority": "low|medium|high|urgent",
      "horizon": "string — e.g. 'This week', '30 days', 'Quarter'"
    }
  ],
  "scenarios": [                     // exactly 3: best case, most likely, worst case (in that order)
    { "name": "string — e.g. 'Best case'", "probability": number, "narrative": "string — what unfolds over 30 days, <=300 chars", "impact": "low|medium|high|severe" }
  ],
  "kpiTargets": [                    // 3-5 metrics to drive, with concrete targets
    { "metric": "string", "current": "string", "target": "string", "timeframe": "string" }
  ],
  "watchList": [                     // 2-4 leading indicators to watch with trigger thresholds
    { "item": "string", "why": "string", "trigger": "string — the threshold that should sound an alarm" }
  ],
  "bottomLine": "string — one decisive closing sentence: the single most important thing to do now."
}

Rules:
- "confidence" and "probability" are numbers 0-100. The three scenario probabilities should be plausible (need not sum to 100).
- Order arrays by importance.
- Be concrete and numeric throughout. Do NOT wrap the JSON in markdown fences.`;

function buildFastUserPrompt(snapshot: unknown): string {
  return [
    "Analyse the following operational snapshot and return the fast briefing JSON.",
    "",
    "SNAPSHOT (JSON):",
    JSON.stringify(snapshot, null, 2),
  ].join("\n");
}

function buildDeepUserPrompt(snapshot: unknown, baseReport: unknown, evidence: unknown): string {
  const lines = [
    "Produce the deep research JSON. Pressure-test and extend the fast briefing using the full snapshot.",
    "",
    "METRICS SNAPSHOT (JSON):",
    JSON.stringify(snapshot, null, 2),
    "",
    "FAST FIRST-PASS BRIEFING (JSON) — your starting hypothesis to deepen, not repeat:",
    JSON.stringify(baseReport ?? {}, null, 2),
  ];
  if (Array.isArray(evidence) && evidence.length > 0) {
    lines.push(
      "",
      "EVIDENCE SAMPLE — the most decision-relevant open tickets (breached, then critical, then oldest).",
      "Use these concrete cases to ground root-cause reasoning and name specific patterns:",
      JSON.stringify(evidence, null, 2),
    );
  }
  return lines.join("\n");
}

// Extract the authenticated user's id (sub claim) from the verified JWT.
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

// ─── Upstash Redis (hot path: job state + snapshot/fast-briefing cache) ─────────
// The browser is a static site and cannot hold Redis creds, so Redis is reached
// only from this function. If the env vars are absent we degrade gracefully:
// every cache becomes a miss and the job state falls back to Postgres.
const REDIS_TTL = {
  snapshot: 60, // seconds — dashboard aggregate
  fast: 3600, // seconds — fast briefing keyed by snapshot content
  job: 3600, // seconds — deep-research job lifetime
};
const jobKey = (id: string) => `deep:job:${id}`;
const SNAPSHOT_KEY = "analytics:snapshot";

function getRedis(): Redis | null {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
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

// Stable content hash of a snapshot (excludes the volatile generatedAt field),
// so identical underlying metrics reuse a cached fast briefing.
async function snapshotHash(snapshot: any): Promise<string> {
  const core = JSON.stringify({
    totals: snapshot?.totals,
    rates: snapshot?.rates,
    byStatus: snapshot?.byStatus,
    bySeverity: snapshot?.bySeverity,
    byCategory: snapshot?.byCategory,
    agingOpen: snapshot?.agingOpen,
    trend: snapshot?.trend,
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(core));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function extractJson(content: string): any {
  const trimmed = content.trim();
  // Strip ```json ... ``` fences if the model added them.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: grab the outermost { ... }.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model did not return parseable JSON");
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── Parse the request body & resolve the mode ───────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const mode: string = body?.mode ?? "fast";
  const redis = getRedis();

  // ── SNAPSHOT MODE — cached dashboard aggregate ───────────────────────────────
  // Browser asks the function for the snapshot; we serve it from Redis (60s TTL)
  // and fall back to the Postgres analytics_snapshot() RPC on a miss.
  if (mode === "snapshot") {
    if (redis) {
      const cached = await redis.get(SNAPSHOT_KEY).catch(() => null);
      if (cached) {
        return new Response(JSON.stringify({ snapshot: cached, cached: true }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }
    const admin = serviceClient();
    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Server not configured: Supabase service env missing" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const { data, error } = await admin.rpc("analytics_snapshot");
    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "Failed to compute snapshot", detail: String(error?.message ?? "").slice(0, 300) }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (redis) await redis.set(SNAPSHOT_KEY, data, { ex: REDIS_TTL.snapshot }).catch(() => {});
    return new Response(JSON.stringify({ snapshot: data, cached: false }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── JOB STATUS MODE — poll a deep-research job ───────────────────────────────
  // Reads the hot job state from Redis, falling back to the Postgres audit row.
  if (mode === "job") {
    const jobId: string | undefined = body?.jobId;
    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing jobId" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (redis) {
      const job = await redis.get(jobKey(jobId)).catch(() => null);
      if (job) {
        return new Response(JSON.stringify(job), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }
    const admin = serviceClient();
    if (admin) {
      const { data } = await admin
        .from("deep_research_jobs")
        .select("status, report, error")
        .eq("id", jobId)
        .single();
      if (data) {
        return new Response(JSON.stringify(data), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ status: "running" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── fast & deep both need the model key and a snapshot ───────────────────────
  const apiKey = Deno.env.get("NVIDIA_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server not configured: NVIDIA_API_KEY missing" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const snapshot: unknown = body?.snapshot ?? body;
  const baseReport: unknown = body?.baseReport ?? null;
  const evidence: unknown = body?.evidence ?? null;
  if (!snapshot || typeof snapshot !== "object") {
    return new Response(
      JSON.stringify({ error: "Invalid request body — expected { snapshot: {...}, mode?, baseReport?, evidence? }" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const isDeep = mode === "deep";
  const model = isDeep
    ? (Deno.env.get("NVIDIA_DEEP_MODEL") || DEEP_MODEL)
    : (Deno.env.get("NVIDIA_FAST_MODEL") || FAST_MODEL);
  const systemPrompt = isDeep ? DEEP_SYSTEM_PROMPT : FAST_SYSTEM_PROMPT;
  const userPrompt = isDeep
    ? buildDeepUserPrompt(snapshot, baseReport, evidence)
    : buildFastUserPrompt(snapshot);

  // ── DEEP MODE — ASYNC JOB (kimi-k2.6) ────────────────────────────────────────
  // kimi-k2.6 is slow (~1-2 min). Generating it inside the request would blow the
  // Edge Function compute budget (WORKER_RESOURCE_LIMIT). Instead we:
  //   1. create a `deep_research_jobs` row (status 'running'),
  //   2. return the jobId immediately (202),
  //   3. run the model in a background task via EdgeRuntime.waitUntil — while the
  //      worker awaits the network fetch it uses ~0 CPU, so it stays within budget,
  //   4. write the finished report back to the row; the client polls for it.
  if (isDeep) {
    const admin = serviceClient();
    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Server not configured: Supabase service env missing" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const userId = getUserId(req);
    // Shared id so Redis (hot path) and the Postgres audit row reference the same job.
    const jobId = crypto.randomUUID();

    // 1a. Hot state in Redis so the client can poll immediately.
    if (redis) {
      await redis.set(jobKey(jobId), { status: "running", model }, { ex: REDIS_TTL.job }).catch(() => {});
    }
    // 1b. Durable audit row in Postgres.
    const { error: insErr } = await admin
      .from("deep_research_jobs")
      .insert({ id: jobId, requested_by: userId, status: "running", model, snapshot, evidence });

    if (insErr && !redis) {
      // No hot store and no audit row — nothing can track this job.
      return new Response(
        JSON.stringify({ error: "Failed to create job", detail: String(insErr?.message ?? "").slice(0, 300) }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // 2. Run the model in the background and write the result to Redis + Postgres.
    const work = (async () => {
      try {
        const res = await fetch(NVIDIA_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 2400,
            temperature: 0.5,
            top_p: 0.9,
            stream: false,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Upstream ${res.status}: ${errText.slice(0, 300)}`);
        }
        const data = await res.json();
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        if (!content) throw new Error("Empty model response");
        const report = extractJson(content);
        report.generatedAt = new Date().toISOString();
        report.model = model;
        report.mode = "deep";
        if (redis) {
          await redis.set(jobKey(jobId), { status: "complete", report }, { ex: REDIS_TTL.job }).catch(() => {});
        }
        await admin
          .from("deep_research_jobs")
          .update({ status: "complete", report, completed_at: new Date().toISOString() })
          .eq("id", jobId);
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err).slice(0, 500);
        if (redis) {
          await redis.set(jobKey(jobId), { status: "error", error: message }, { ex: REDIS_TTL.job }).catch(() => {});
        }
        await admin
          .from("deep_research_jobs")
          .update({
            status: "error",
            error: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime.
    EdgeRuntime.waitUntil(work);

    return new Response(JSON.stringify({ jobId }), {
      status: 202,
      headers: { ...cors, "Content-Type": "application/json", "X-Model": model },
    });
  }

  // ── FAST MODE — buffered JSON briefing (Redis-cached by snapshot content) ────
  const fastCacheKey = redis ? `fast:${await snapshotHash(snapshot)}` : null;
  if (redis && fastCacheKey) {
    const cached = await redis.get(fastCacheKey).catch(() => null);
    if (cached) {
      return new Response(JSON.stringify({ report: cached, cached: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const nvidiaRes = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.4,
        top_p: 0.9,
        stream: false,
      }),
    });

    if (!nvidiaRes.ok) {
      const errText = await nvidiaRes.text();
      return new Response(
        JSON.stringify({ error: "Upstream model error", status: nvidiaRes.status, detail: errText.slice(0, 500) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const data = await nvidiaRes.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content) {
      return new Response(
        JSON.stringify({ error: "Empty model response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const report = extractJson(content);
    report.generatedAt = new Date().toISOString();
    report.model = model;
    report.mode = mode;

    if (redis && fastCacheKey) {
      await redis.set(fastCacheKey, report, { ex: REDIS_TTL.fast }).catch(() => {});
    }

    return new Response(JSON.stringify({ report }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate insights", detail: String(err).slice(0, 300) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
