-- =====================================================================
-- Diagnostics: email notification pipeline
-- Run each block in the Supabase SQL Editor, one at a time, and check
-- the result against the comment above it. Nothing here exposes secret
-- VALUES — only whether they exist.
-- =====================================================================

-- 1. Do the two Vault secrets dispatch_email() needs actually exist?
--    EXPECT: 2 rows — 'project_url' and 'email_fn_secret'.
--    If you get 0 or 1 rows, that's the whole problem: dispatch_email()
--    silently returns without calling anything.
select name, created_at
from vault.decrypted_secrets
where name in ('project_url', 'email_fn_secret');


-- 2. Who would actually get emailed for your recent tickets?
--    EXPECT: for tickets where would_notify is '[]', that's why no mail
--    went out (raiser == only possible recipient, same as the ticket we
--    just looked at). For any ticket where would_notify has an email in
--    it, that ticket SHOULD have sent mail — if it didn't, the problem
--    is downstream (secrets missing, function not deployed, or Resend).
select
  t.ticket_code,
  t.raised_by,
  t.assigned_to,
  t.created_at,
  public.recipients_from_ids(
    public.distinct_ids(ARRAY[t.assigned_to] || public.store_verifier_ids(t.store_id))
  ) as would_notify
from public.tickets t
order by t.created_at desc
limit 5;


-- 3. Sanity check: does department_routing actually have rules, and who
--    do they point at? (Confirms why assigned_to came out as Amritanshu.)
select department, region, store_id, owner_id, is_active
from public.department_routing
order by department;
