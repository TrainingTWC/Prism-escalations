-- =====================================================================
-- DEPARTMENT-WISE TICKET CODES
-- =====================================================================
-- Replaces the old opaque ticket_code (AI-<timestamp>-<id fragments>,
-- TKT-<base36 timestamp>) with a human-readable, department-scoped code:
--
--   {DEPT}-{AUDITCODE}-{NNNN}
--
--   DEPT      - short code for tickets.category (OPS, HR, IT, SCM, QA, ...)
--   AUDITCODE - abbreviation of intelligence_program_name, or GEN for
--               manually-raised tickets with no audit behind them
--   NNNN      - a counter that increments per department only (shared
--               across all audit types and manual tickets), zero-padded
--               to 4 digits
--
-- Generation happens entirely server-side via a BEFORE INSERT trigger so
-- both callers (Convex's supabaseTicketWriter.ts and the Next.js
-- tickets/new page) get atomic, collision-free codes without needing to
-- coordinate with each other. Any ticket_code supplied by the caller is
-- overwritten. Existing rows/codes are untouched -- this only affects
-- tickets created from here on.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ticket_counters (
  department_code TEXT PRIMARY KEY,
  next_val         INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION public.department_ticket_code(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_category
    WHEN 'Operations'  THEN 'OPS'
    WHEN 'HR'          THEN 'HR'
    WHEN 'IT'          THEN 'IT'
    WHEN 'SCM'         THEN 'SCM'
    WHEN 'QA'          THEN 'QA'
    WHEN 'L&D'         THEN 'LND'
    WHEN 'Finance'     THEN 'FIN'
    WHEN 'Maintenance' THEN 'MNT'
    ELSE upper(left(regexp_replace(coalesce(p_category, 'GEN'), '[^a-zA-Z]', '', 'g'), 4))
  END;
$$;

CREATE OR REPLACE FUNCTION public.abbreviate_audit_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
  words   TEXT[];
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN 'GEN';
  END IF;

  -- drop the standalone word "audit" and any non-letters, collapse whitespace
  cleaned := regexp_replace(p_name, '\yaudit\y', '', 'gi');
  cleaned := regexp_replace(cleaned, '[^a-zA-Z\s]', ' ', 'g');
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));

  IF cleaned = '' THEN
    RETURN 'GEN';
  END IF;

  words := regexp_split_to_array(cleaned, '\s+');

  IF array_length(words, 1) = 1 THEN
    RETURN upper(left(words[1], 6));
  ELSE
    RETURN upper(left(words[1], 3) || left(words[2], 3));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_ticket_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  dept_code  TEXT;
  audit_code TEXT;
  seq_num    INTEGER;
BEGIN
  dept_code  := public.department_ticket_code(NEW.category);
  audit_code := public.abbreviate_audit_name(NEW.intelligence_program_name);

  INSERT INTO public.ticket_counters (department_code, next_val)
  VALUES (dept_code, 1)
  ON CONFLICT (department_code)
  DO UPDATE SET next_val = public.ticket_counters.next_val + 1
  RETURNING next_val INTO seq_num;

  NEW.ticket_code := dept_code || '-' || audit_code || '-' || lpad(seq_num::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_ticket_code ON public.tickets;
CREATE TRIGGER trg_assign_ticket_code
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_ticket_code();
