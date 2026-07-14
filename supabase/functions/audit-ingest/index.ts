// ---------------------------------------------------------------------------
// audit-ingest — Prism Intelligence → Prism Escalations ticket generator
//
// Receives an audit submission webhook and converts it into tickets using a
// SEVERITY-TIERED grouping algorithm with cross-audit merge AND auto-close:
//
//   • A single failed checkpoint is NEVER a ticket.
//   • Not every section is a ticket either.
//   • P0 / P1 sections        → one dedicated ticket each.
//   • P2 / P3 sections        → collapsed into ONE roll-up follow-up ticket
//                               per audit (severity capped at P2).
//   • Recurrence of the same issue at the same store merges into the existing
//     ticket (append recurrence note + deductions, escalate severity,
//     bump reopen_count, raise pattern flag) instead of creating a duplicate.
//     A recurrence on a ticket awaiting verification reopens it.
//   • AUTO-CLOSE: when the same program is re-audited at a store and a
//     previously-flagged section is clean this time, its open ticket is
//     closed with the audit as verification evidence.
//
// Auth: machine-to-machine. Protected by a shared secret header, NOT a user JWT.
//   Deploy with:
//     supabase functions deploy audit-ingest --no-verify-jwt
//   Secrets:
//     supabase secrets set INTELLIGENCE_WEBHOOK_SECRET=<long-random-string>
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//
// The caller must send header:  x-webhook-secret: <INTELLIGENCE_WEBHOOK_SECRET>
// ---------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── types (mirror src/lib/intelligence) ─────────────────────────────────────
type Severity = "P0" | "P1" | "P2" | "P3";
type Category =
  | "Operations" | "HR" | "IT" | "SCM" | "QA"
  | "Finance" | "Maintenance" | "L&D";

interface FailedQuestion {
  questionId: string;
  questionText: string;
  weightMax: number;
  scoreEarned: number;
  deducted: number;
  isCritical: boolean;
  comment?: string;
}
interface AIAnalysis {
  shouldCreateTicket?: boolean;
  noTicketReason?: string;
  department?: string;
  severity?: string;            // may arrive as P0–P3 or legacy critical/high/…
  title?: string;
  summary?: string;
  patternFlag?: boolean;
  patternNote?: string;
  suggestedAssigneeRole?: string;
  aiConfidence?: number;
}
interface SectionDeduction {
  sectionId: string;
  sectionTitle: string;
  sectionDepartment?: string | null;
  isCritical: boolean;
  totalDeducted: number;
  sectionMaxScore: number;
  deductionPct: number;
  failedQuestions: FailedQuestion[];
  ai?: AIAnalysis;
}
interface Payload {
  submissionId: string;
  submittedAt?: number;
  programId: string;
  programName: string;
  programDepartment?: string | null;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  storeName: string;
  storeCode?: string | null;
  amName?: string | null;
  city?: string;
  deductions: SectionDeduction[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const SLA_MINUTES: Record<Severity, number> = { P0: 240, P1: 1440, P2: 4320, P3: 10080 };
const SEV_RANK: Record<Severity, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
const RANK_SEV: Record<number, Severity> = { 4: "P0", 3: "P1", 2: "P2", 1: "P3" };
const ROLLUP_KEY = "__rollup__";

// Normalise legacy severity strings (from older Intelligence payloads / rows)
function toSeverity(raw?: string | null): Severity | null {
  if (!raw) return null;
  const v = raw.toUpperCase().trim();
  if (v === "P0" || v === "CRITICAL") return "P0";
  if (v === "P1" || v === "HIGH") return "P1";
  if (v === "P2" || v === "MEDIUM") return "P2";
  if (v === "P3" || v === "LOW") return "P3";
  return null;
}

const DEPARTMENT_MAP: Record<string, Category> = {
  operations: "Operations", ops: "Operations", operational: "Operations", store: "Operations",
  floor: "Operations", service: "Operations", customer: "Operations", cx: "Operations",
  hr: "HR", "human resources": "HR", people: "HR", talent: "HR", hrbp: "HR", payroll: "HR",
  training: "L&D", learning: "L&D", lms: "L&D", "l&d": "L&D", lnd: "L&D",
  it: "IT", tech: "IT", technology: "IT", systems: "IT", infra: "IT", infrastructure: "IT",
  scm: "SCM", "supply chain": "SCM", logistics: "SCM", warehouse: "SCM", inventory: "SCM",
  procurement: "SCM", purchase: "SCM",
  qa: "QA", quality: "QA", audit: "QA", compliance: "QA", food: "QA", hygiene: "QA",
  safety: "QA", health: "QA", "food safety": "QA",
  finance: "Finance", accounts: "Finance", billing: "Finance", cash: "Finance",
  maintenance: "Maintenance", repair: "Maintenance", repairs: "Maintenance",
  facilities: "Maintenance", facility: "Maintenance", equipment: "Maintenance",
  electrical: "Maintenance", plumbing: "Maintenance", hvac: "Maintenance",
};

function mapDepartment(raw?: string | null): Category {
  if (!raw) return "Operations";
  const key = raw.toLowerCase().trim();
  if (key in DEPARTMENT_MAP) return DEPARTMENT_MAP[key];
  for (const [k, v] of Object.entries(DEPARTMENT_MAP)) if (key.includes(k)) return v;
  return "Operations";
}

function computeSeverity(s: Pick<SectionDeduction, "isCritical" | "deductionPct">): Severity {
  if (s.isCritical) return "P0";
  if (s.deductionPct >= 60) return "P1";
  if (s.deductionPct >= 30) return "P2";
  return "P3";
}

function sectionSeverity(s: SectionDeduction): Severity {
  return toSeverity(s.ai?.severity) ?? computeSeverity(s);
}

function slaDeadline(severity: Severity, fromISO: string): string {
  return new Date(new Date(fromISO).getTime() + (SLA_MINUTES[severity] ?? 1440) * 60_000).toISOString();
}

function fmtDate(ms?: number | null): string {
  if (!ms) return "Unknown";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function sectionDescription(p: Payload, section: SectionDeduction): string {
  const checkpoints = section.failedQuestions
    .map((q) => {
      const crit = q.isCritical ? " ⚠️ **Critical Checkpoint**" : "";
      const note = q.comment ? `\n  > Auditor note: "${q.comment}"` : "";
      return `- **${q.questionText}**${crit}\n  Scored **${q.scoreEarned}/${q.weightMax}** (deducted ${q.deducted} pts)${note}`;
    })
    .join("\n");
  return [
    `**Auto-generated from Prism Intelligence audit submission**`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Store | ${p.storeName}${p.city ? ` — ${p.city}` : ""} |`,
    `| Audit Program | ${p.programName} |`,
    `| Section | ${section.sectionTitle}${section.isCritical ? " *(Critical)*" : ""} |`,
    `| Overall Audit Score | ${p.percentage != null ? `${p.percentage.toFixed(1)}%` : "N/A"} |`,
    `| Section Deduction | ${section.deductionPct.toFixed(1)}% (${section.totalDeducted} of ${section.sectionMaxScore} pts lost) |`,
    `| Area Manager | ${p.amName ?? "—"} |`,
    `| Submitted | ${fmtDate(p.submittedAt)} |`,
    ``,
    `### Failed Checkpoints`,
    checkpoints,
    ``,
    `---`,
    `*Intelligence Ref: \`${p.submissionId}\`*`,
  ].join("\n");
}

function rollupDescription(p: Payload, sections: SectionDeduction[]): string {
  const rows = sections
    .map((s) => {
      const sev = sectionSeverity(s);
      return `| ${s.sectionTitle} | ${mapDepartment(s.ai?.department ?? s.sectionDepartment ?? p.programDepartment)} | ${sev} | ${s.deductionPct.toFixed(1)}% | ${s.failedQuestions.length} |`;
    })
    .join("\n");
  return [
    `**Auto-generated roll-up of minor audit findings (Prism Intelligence)**`,
    ``,
    `Lower-severity findings from this audit are bundled here so they are tracked`,
    `without flooding the board. P0/P1 findings are tracked as their own tickets.`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Store | ${p.storeName}${p.city ? ` — ${p.city}` : ""} |`,
    `| Audit Program | ${p.programName} |`,
    `| Overall Audit Score | ${p.percentage != null ? `${p.percentage.toFixed(1)}%` : "N/A"} |`,
    `| Area Manager | ${p.amName ?? "—"} |`,
    `| Submitted | ${fmtDate(p.submittedAt)} |`,
    ``,
    `### Bundled Findings (${sections.length})`,
    `| Section | Dept | Severity | Deduction | Failed checkpoints |`,
    `|---|---|---|---|---|`,
    rows,
    ``,
    `---`,
    `*Intelligence Ref: \`${p.submissionId}\`*`,
  ].join("\n");
}

function recurrenceNote(p: Payload, label: string): string {
  return [
    ``,
    `---`,
    `### 🔁 Recurrence — ${fmtDate(p.submittedAt ?? Date.now())}`,
    `This issue reappeared in a later audit (${label}).`,
    `- Submission: \`${p.submissionId}\``,
    `- Overall audit score: ${p.percentage != null ? `${p.percentage.toFixed(1)}%` : "N/A"}`,
  ].join("\n");
}

function autoCloseNote(p: Payload): string {
  return [
    ``,
    `---`,
    `### ✅ Verified resolved by re-audit — ${fmtDate(p.submittedAt ?? Date.now())}`,
    `The next ${p.programName} audit at this store found this issue clean.`,
    `- Submission: \`${p.submissionId}\``,
    `- Overall audit score: ${p.percentage != null ? `${p.percentage.toFixed(1)}%` : "N/A"}`,
  ].join("\n");
}

function randSuffix(n: number): string {
  return Math.random().toString(36).slice(2, 2 + n).toUpperCase();
}

// ─── a normalised ticket "spec" produced by the grouping algorithm ───────────
interface TicketSpec {
  kind: "individual" | "rollup";
  sectionKey: string;          // sectionId for individual, ROLLUP_KEY for roll-up
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  deductions: SectionDeduction[];
  aiConfidence: number | null;
  patternFlag: boolean;
  patternNote: string | null;
  suggestedRole: string | null;
}

// ─── the algorithm: payload → ticket specs ───────────────────────────────────
function buildSpecs(p: Payload): TicketSpec[] {
  const specs: TicketSpec[] = [];
  const rollup: SectionDeduction[] = [];

  for (const section of p.deductions) {
    if (!section.failedQuestions?.length) continue;            // nothing failed → ignore
    if (section.ai?.shouldCreateTicket === false) continue;    // respect AI's "no ticket" call

    const severity = sectionSeverity(section);
    const category = mapDepartment(section.ai?.department ?? section.sectionDepartment ?? p.programDepartment);

    if (severity === "P0" || severity === "P1") {
      specs.push({
        kind: "individual",
        sectionKey: section.sectionId,
        category,
        severity,
        title: (section.ai?.title ?? `${section.sectionTitle} — ${p.storeName}`).slice(0, 120),
        description: sectionDescription(p, section),
        deductions: [section],
        aiConfidence: section.ai?.aiConfidence ?? null,
        patternFlag: section.ai?.patternFlag ?? false,
        patternNote: section.ai?.patternNote ?? null,
        suggestedRole: section.ai?.suggestedAssigneeRole ?? null,
      });
    } else {
      rollup.push(section);
    }
  }

  if (rollup.length) {
    // roll-up severity = highest among bundled (P2/P3), capped at P2
    const maxRank = Math.min(2, Math.max(...rollup.map((s) => SEV_RANK[sectionSeverity(s)])));
    // dominant category = the one with the greatest total deduction
    const byCat = new Map<Category, number>();
    for (const s of rollup) {
      const c = mapDepartment(s.ai?.department ?? s.sectionDepartment ?? p.programDepartment);
      byCat.set(c, (byCat.get(c) ?? 0) + s.totalDeducted);
    }
    const category = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0];
    specs.push({
      kind: "rollup",
      sectionKey: ROLLUP_KEY,
      category,
      severity: RANK_SEV[maxRank] ?? "P3",
      title: `Audit follow-up — ${p.programName} (${p.storeName})`.slice(0, 120),
      description: rollupDescription(p, rollup),
      deductions: rollup,
      aiConfidence: null,
      patternFlag: false,
      patternNote: null,
      suggestedRole: null,
    });
  }

  return specs;
}

// ─── handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. shared-secret auth (machine-to-machine)
  const expected = Deno.env.get("INTELLIGENCE_WEBHOOK_SECRET");
  if (!expected) return json({ error: "Server not configured: webhook secret missing" }, 500);
  if (req.headers.get("x-webhook-secret") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  // 2. parse + validate
  let p: Payload;
  try {
    p = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const problems = validate(p);
  if (problems.length) return json({ error: "Invalid payload", problems }, 400);

  const admin = serviceClient();
  if (!admin) return json({ error: "Server not configured: Supabase env missing" }, 500);

  // 3. resolve store_id (best effort)
  let storeId: string | null = null;
  if (p.storeCode) {
    const { data: store } = await admin.from("stores").select("id").eq("store_code", p.storeCode).maybeSingle();
    storeId = (store as { id?: string } | null)?.id ?? null;
  }

  // 4. run the grouping algorithm
  const specs = buildSpecs(p);

  const created: string[] = [];
  const merged: string[] = [];
  const autoClosed: string[] = [];
  const errors: string[] = [];
  let codeSeq = 0;

  for (const spec of specs) {
    try {
      // 5. merge into an existing ACTIVE intelligence ticket for this store + key
      const existing = p.storeCode
        ? await findActiveTicket(admin, p.storeCode, p.programId, spec)
        : null;

      if (existing) {
        const existingSev = toSeverity(existing.severity) ?? "P3";
        const escalatedRank = Math.max(SEV_RANK[existingSev], SEV_RANK[spec.severity]);
        const escalated = RANK_SEV[escalatedRank];
        const prevDeductions = Array.isArray(existing.intelligence_deductions) ? existing.intelligence_deductions : [];
        const update: Record<string, unknown> = {
          severity: escalated,
          reopen_count: (existing.reopen_count ?? 0) + 1,
          description: `${existing.description ?? ""}${recurrenceNote(p, spec.kind === "rollup" ? "roll-up" : spec.title)}`,
          intelligence_deductions: [...prevDeductions, ...spec.deductions],
          intelligence_audit_score: p.score ?? null,
          intelligence_audit_pct: p.percentage ?? null,
          intelligence_pattern_flag: true,
          intelligence_pattern_note: `Recurring issue — seen again on ${fmtDate(p.submittedAt ?? Date.now())} (submission ${p.submissionId}).`,
        };
        // a recurrence on a ticket awaiting verification means the fix didn't hold
        if (existing.status === "resolved") {
          update.status = "in_progress";
          update.resolved_at = null;
        }
        // if severity escalated, restart the SLA clock from now
        if (escalated !== existingSev) {
          update.sla_deadline = slaDeadline(escalated, new Date().toISOString());
        }
        const { error } = await admin.from("tickets").update(update).eq("id", existing.id);
        if (error) throw error;
        merged.push(existing.ticket_code as string);
        continue;
      }

      // 6. otherwise create a fresh ticket
      const nowISO = new Date().toISOString();
      const ticket_code = `AUD-${Date.now().toString(36).toUpperCase()}-${codeSeq++}${randSuffix(2)}`;
      const { error } = await admin.from("tickets").insert({
        ticket_code,
        title: spec.title,
        description: spec.description,
        category: spec.category,
        severity: spec.severity,
        status: "open",
        store_id: storeId,
        source_type: "audit",
        sla_deadline: slaDeadline(spec.severity, nowISO),
        intelligence_source: true,
        intelligence_submission_id: p.submissionId,
        intelligence_section_id: spec.sectionKey,
        intelligence_program_id: p.programId,
        intelligence_program_name: p.programName,
        intelligence_store_code: p.storeCode ?? null,
        intelligence_deductions: spec.deductions,
        intelligence_audit_score: p.score ?? null,
        intelligence_audit_pct: p.percentage ?? null,
        intelligence_ai_confidence: spec.aiConfidence,
        intelligence_pattern_flag: spec.patternFlag,
        intelligence_pattern_note: spec.patternNote,
        intelligence_suggested_role: spec.suggestedRole,
      });
      if (error) throw error;
      created.push(ticket_code);
    } catch (err) {
      errors.push(`${spec.kind}:${spec.sectionKey} — ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    }
  }

  // 7. AUTO-CLOSE — a re-audit of this program at this store verifies fixes.
  //    Any active intelligence ticket for a section that is NOT flagged in
  //    this submission is considered resolved-and-verified by the audit.
  if (p.storeCode) {
    try {
      const flaggedKeys = new Set(specs.map((s) => s.sectionKey));
      const { data: openRows } = await admin
        .from("tickets")
        .select("id, ticket_code, description, intelligence_section_id, created_at")
        .eq("intelligence_source", true)
        .eq("intelligence_store_code", p.storeCode)
        .eq("intelligence_program_id", p.programId)
        .in("status", ["open", "in_progress", "resolved"]);

      for (const row of (openRows ?? []) as Array<{
        id: string; ticket_code: string; description: string | null; intelligence_section_id: string | null;
      }>) {
        if (row.intelligence_section_id && flaggedKeys.has(row.intelligence_section_id)) continue;

        const { error: closeErr } = await admin
          .from("tickets")
          .update({
            status: "closed",
            closed_at: new Date().toISOString(),
            blocked: false,
            description: `${row.description ?? ""}${autoCloseNote(p)}`,
          })
          .eq("id", row.id);
        if (closeErr) {
          errors.push(`autoclose:${row.ticket_code} — ${closeErr.message.slice(0, 200)}`);
          continue;
        }

        await admin.from("comments").insert({
          ticket_id: row.id,
          author_id: null,
          content: `Auto-closed: the ${p.programName} re-audit on ${fmtDate(p.submittedAt ?? Date.now())} found this issue resolved (score ${p.percentage != null ? p.percentage.toFixed(1) + "%" : "N/A"}).`,
          is_status_change: true,
          old_status: "resolved",
          new_status: "closed",
        });

        autoClosed.push(row.ticket_code);
      }
    } catch (err) {
      errors.push(`autoclose — ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    }
  }

  return json({
    submissionId: p.submissionId,
    sectionsReceived: p.deductions.length,
    ticketsCreated: created.length,
    ticketsMerged: merged.length,
    ticketsAutoClosed: autoClosed.length,
    created,
    merged,
    autoClosed,
    errors,
  }, errors.length && !created.length && !merged.length && !autoClosed.length ? 500 : 200);
});

// ─── data access ─────────────────────────────────────────────────────────────
function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function findActiveTicket(admin: any, storeCode: string, programId: string, spec: TicketSpec) {
  let q = admin
    .from("tickets")
    .select("id, ticket_code, severity, reopen_count, description, intelligence_deductions, status")
    .eq("intelligence_source", true)
    .eq("intelligence_store_code", storeCode)
    .eq("intelligence_section_id", spec.sectionKey)
    .not("status", "in", "(closed,rejected)")
    .order("created_at", { ascending: false })
    .limit(1);
  // roll-up tickets share the ROLLUP_KEY section id, so additionally scope them
  // to the same audit program to avoid merging unrelated programs' roll-ups.
  if (spec.kind === "rollup") q = q.eq("intelligence_program_id", programId);
  const { data } = await q.maybeSingle();
  return data as
    | { id: string; ticket_code: string; severity: string; reopen_count: number; description: string | null; intelligence_deductions: unknown; status: string }
    | null;
}

// ─── validation ──────────────────────────────────────────────────────────────
function validate(p: any): string[] {
  const e: string[] = [];
  if (!p || typeof p !== "object") return ["body is not an object"];
  if (typeof p.submissionId !== "string" || !p.submissionId) e.push("submissionId required");
  if (typeof p.programId !== "string") e.push("programId required");
  if (typeof p.programName !== "string") e.push("programName required");
  if (typeof p.storeName !== "string") e.push("storeName required");
  if (!Array.isArray(p.deductions)) e.push("deductions must be an array");
  return e;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
