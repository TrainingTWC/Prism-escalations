// Supabase Edge Function: ai-insights
// ---------------------------------------------------------------------------
// Secure server-side proxy to NVIDIA's hosted inference API (OpenAI-compatible
// chat/completions). The NVIDIA API key NEVER reaches the browser — it is read
// from the NVIDIA_API_KEY secret at runtime.
//
// The client (src/lib/intelligence/analytics-ai.ts) sends a compact, aggregated
// "snapshot" of ticket metrics. This function asks the model to return a strict
// JSON operational-intelligence report (insights / predictions / recommendations
// / risks / anomalies) and relays it back.
//
// Deploy:
//   supabase functions deploy ai-insights
//   supabase secrets set NVIDIA_API_KEY=nvapi-xxxxxxxx
//   (optional) supabase secrets set NVIDIA_MODEL=moonshotai/kimi-k2.6
//
// JWT verification is left ON (default) so only authenticated app users can call it.
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "moonshotai/kimi-k2.6";

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

const SYSTEM_PROMPT = `You are the analytics intelligence engine for "Prism Escalations", a multi-store
operational escalation and SLA-management platform. You receive an AGGREGATED, anonymised
snapshot of ticket metrics (no personal data) and must produce a rigorous, decision-grade
operational intelligence report.

Operating philosophy: AI must REDUCE operational friction, not produce chatbot theater.
Every statement must be grounded in the numbers provided. Be specific, quantitative, and
actionable. Reference concrete figures (counts, percentages, store codes, categories) from
the snapshot. Never invent data that is not present. If signal is weak, say so and lower
your confidence rather than fabricating.

You MUST respond with a single valid JSON object and NOTHING else (no markdown, no prose,
no code fences). Conform EXACTLY to this schema:

{
  "headline": "string — one punchy sentence (<=110 chars) summarising the single most important finding",
  "healthScore": number,            // 0-100 overall operational health (higher = healthier)
  "healthLabel": "string",          // e.g. "Stable", "Under pressure", "Critical"
  "summary": "string — 2-4 sentence narrative of the current operational state",
  "insights": [                      // 3-5 grounded observations of what is happening and why
    { "title": "string", "detail": "string", "metric": "string", "severity": "info|warning|critical" }
  ],
  "predictions": [                   // 2-4 forward-looking forecasts
    { "title": "string", "detail": "string", "timeframe": "string", "likelihood": "low|medium|high", "confidence": number }
  ],
  "recommendations": [               // 3-5 concrete actions, most impactful first
    { "title": "string", "detail": "string", "priority": "low|medium|high|urgent", "expectedImpact": "string" }
  ],
  "risks": [                         // 2-4 risk-radar entries
    { "area": "string", "signal": "string", "severity": "low|medium|high|critical" }
  ],
  "anomalies": [                     // 0-3 statistical outliers / unusual spikes; empty array if none
    { "title": "string", "detail": "string" }
  ]
}

Rules:
- "confidence" is a number 0-100.
- Keep every "detail" under 240 characters.
- Order arrays by importance (most important first).
- Do NOT wrap the JSON in markdown fences.`;

function buildUserPrompt(snapshot: unknown): string {
  return [
    "Analyse the following operational snapshot and return the JSON report.",
    "",
    "SNAPSHOT (JSON):",
    JSON.stringify(snapshot, null, 2),
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
  const model = Deno.env.get("NVIDIA_MODEL") || DEFAULT_MODEL;

  let snapshot: unknown;
  try {
    const body = await req.json();
    snapshot = body?.snapshot ?? body;
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("missing snapshot");
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body — expected { snapshot: {...} }" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(snapshot) },
        ],
        max_tokens: 4096,
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
