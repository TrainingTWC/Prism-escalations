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
//   (optional) supabase secrets set NVIDIA_DEEP_MODEL=moonshotai/kimi-k2.6
//
// JWT verification is left ON (default) so only authenticated app users can call it.
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const FAST_MODEL = "meta/llama-3.3-70b-instruct";
const DEEP_MODEL = "moonshotai/kimi-k2.6";

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

function buildDeepUserPrompt(snapshot: unknown, baseReport: unknown): string {
  return [
    "Produce the deep research JSON. Pressure-test and extend the fast briefing using the full snapshot.",
    "",
    "METRICS SNAPSHOT (JSON):",
    JSON.stringify(snapshot, null, 2),
    "",
    "FAST FIRST-PASS BRIEFING (JSON) — your starting hypothesis to deepen, not repeat:",
    JSON.stringify(baseReport ?? {}, null, 2),
  ].join("\n");
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

  const apiKey = Deno.env.get("NVIDIA_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server not configured: NVIDIA_API_KEY missing" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let snapshot: unknown;
  let baseReport: unknown = null;
  let mode = "fast";
  try {
    const body = await req.json();
    snapshot = body?.snapshot ?? body;
    baseReport = body?.baseReport ?? null;
    if (body?.mode === "deep") mode = "deep";
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("missing snapshot");
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body — expected { snapshot: {...}, mode?, baseReport? }" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const isDeep = mode === "deep";
  const model = isDeep
    ? (Deno.env.get("NVIDIA_DEEP_MODEL") || DEEP_MODEL)
    : (Deno.env.get("NVIDIA_FAST_MODEL") || FAST_MODEL);
  const systemPrompt = isDeep ? DEEP_SYSTEM_PROMPT : FAST_SYSTEM_PROMPT;
  const userPrompt = isDeep
    ? buildDeepUserPrompt(snapshot, baseReport)
    : buildFastUserPrompt(snapshot);

  // ── DEEP MODE — STREAM kimi tokens to the client ─────────────────────────────
  // kimi-k2.6 is slow (~80-120s). A buffered response would exceed the Edge
  // Function compute budget (WORKER_RESOURCE_LIMIT), so we stream the assembled
  // text content out as it arrives, keeping the worker active and memory flat.
  if (isDeep) {
    let nvidiaRes: Response;
    try {
      nvidiaRes = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 3200,
          temperature: 0.5,
          top_p: 0.9,
          stream: true,
        }),
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Failed to reach model", detail: String(err).slice(0, 300) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!nvidiaRes.ok || !nvidiaRes.body) {
      const errText = await nvidiaRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: "Upstream model error", status: nvidiaRes.status, detail: errText.slice(0, 500) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Transform the upstream SSE stream into a plain-text stream of content deltas.
    const upstream = nvidiaRes.body;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // ignore partial / non-JSON SSE keep-alive lines
              }
            }
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Model": model,
      },
    });
  }

  // ── FAST MODE — buffered JSON briefing ───────────────────────────────────────
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
