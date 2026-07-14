# Workflow v3 — Setup & Rollout

The app was overhauled: role-scoped visibility, a 4-step automated workflow,
email notifications, a mobile-first UI, and audit auto-close. The web app
deploys as before (GitHub Pages / APK build), but the backend needs a
**one-time setup** below — do these in order.

---

## 1. Run the database migration

Supabase SQL Editor → run **`supabase/migration_workflow_v3.sql`**.

This migrates roles + statuses + severities, creates `department_routing`,
rewrites the RLS policies (scoped visibility), installs the transition guard,
notification triggers, verification sweep, and the photo-evidence storage
bucket. Existing tickets are converted automatically
(acknowledged/accepted/waiting → in_progress, snag → in_progress+blocked,
verification → resolved).

## 2. Email (Resend)

1. Create an account at <https://resend.com> → add your domain
   (e.g. `prismintelligence.in`, add the DNS records they show) → create an
   **API key**.
2. Set the function secrets:

   ```bash
   supabase secrets set EMAIL_FN_SECRET="<random-long-string>"
   supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
   supabase secrets set EMAIL_FROM="Prism Escalations <alerts@prismintelligence.in>"
   supabase secrets set APP_URL="https://escalations.prismintelligence.in"
   ```

   > No domain yet? Skip `EMAIL_FROM` — it falls back to Resend's sandbox
   > sender, which only delivers to your own Resend account email (fine for
   > testing, swap in the domain later).

3. Deploy the sender:

   ```bash
   supabase functions deploy send-email --no-verify-jwt
   ```

4. Vault secrets (SQL editor — lets Postgres call the function). `project_url`
   already exists if you set up push earlier; skip it then:

   ```sql
   select vault.create_secret('https://sldvlxpxdcgzrlyqezsi.supabase.co', 'project_url');
   select vault.create_secret('<same EMAIL_FN_SECRET value>', 'email_fn_secret');
   ```

Until step 2 is done the app works fine — emails are simply skipped (no-op).

## 3. Redeploy the audit webhook

```bash
supabase functions deploy audit-ingest --no-verify-jwt
```

New behaviour: P0–P3 severities, 8 departments (incl. Maintenance/Finance/L&D),
recurrences reopen resolved tickets, and **auto-close** — when the same audit
program runs again at a store and a previously-flagged section is clean, its
ticket closes itself with the audit as evidence (system comment + notification).

## 4. Configure people & routing (in the app)

1. **Team page** — give every user the right role, and set their scope
   (super admin sees a scope picker next to each role):
   - `store_team` / `store_manager` → their **store**
   - `dept_owner` → their **department**
   - `area_manager` → their **region**
2. **Routing page** (`/routing`) — for each department add an owner, optionally
   per region (region rule wins over the "All regions" fallback). From then on
   every new ticket in that department is auto-assigned + instantly
   emailed/pushed. Without a rule, tickets wait unassigned in the department
   queue.

---

## How the new workflow behaves

```
Open ──▶ In Progress ──▶ Resolved ──▶ Closed        (✕ Rejected for invalid)
(auto-assigned   (fixer taps      (fixer taps       (store manager taps
 + email/push)    "Start work")    "Mark fixed"      "Verify & close";
                                   + photo)          "Not fixed" reopens)
```

- **Blocked (snag)** is a flag on an in-progress ticket, with a reason —
  notifies the raiser, store manager and area manager. Unblock resumes.
- Timestamps (`first_response_at`, `resolved_at`, `closed_at`, reopen counts)
  are stamped by the DB, not the client. Illegal transitions are rejected by
  the DB; only manager-level roles can close.
- **Reminders**: verifiers are nudged 24h and 48h after a fix is marked;
  unverified tickets **auto-close after 7 days** with a note.
- **SLA**: P0 4h · P1 24h · P2 72h · P3 7d (auto-set on create; breach sweep
  emails the assignee + area manager).

## Who sees what (enforced by RLS, not just the UI)

| Role | Sees |
|---|---|
| Store team / Store manager | Their store's tickets |
| Dept owner | Their department's tickets |
| Area manager | Their region's tickets |
| Auditor | Audit-sourced tickets + their own |
| Leadership / Super admin | Everything |

Everyone additionally always sees tickets they raised or are assigned to.

## Mobile

On phones the sidebar is replaced by a bottom tab bar
(Home · Tickets · **＋** · Alerts · Menu). Home is a role-aware
**"Needs your action"** inbox with one-tap Start/Verify buttons; creating a
ticket takes ~30 seconds with camera capture and a live "will be assigned to…"
preview. Rebuild the APK as usual (`Actions → Build Android APK`) — no
Capacitor/native changes were needed.
