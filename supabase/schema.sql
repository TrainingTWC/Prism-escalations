-- =====================================================================
-- Prism Escalations — Database Schema
-- Run this in your Supabase SQL Editor: 
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- STORES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name  TEXT NOT NULL,
  store_code  TEXT NOT NULL UNIQUE,
  city        TEXT,
  region      TEXT NOT NULL,
  tier        TEXT DEFAULT 'standard',
  manager_id  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read stores
CREATE POLICY "stores_select" ON public.stores
  FOR SELECT TO authenticated USING (true);

-- Only leadership/admin can manage stores  
CREATE POLICY "stores_insert" ON public.stores
  FOR INSERT TO authenticated WITH CHECK (true);

-- =====================================================================
-- PROFILES (extends auth.users)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'store_team',
  region      TEXT,
  department  TEXT,
  store_id    UUID REFERENCES public.stores(id),
  status      TEXT DEFAULT 'active',
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'store_team')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- TICKETS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code       TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL CHECK (category IN ('Operations','HR','IT','SCM','QA')),
  sub_category      TEXT,
  severity          TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','accepted','in_progress','waiting','snag','resolved','verification','closed')),
  store_id          UUID REFERENCES public.stores(id),
  raised_by         UUID REFERENCES public.profiles(id),
  assigned_to       UUID REFERENCES public.profiles(id),
  source_type       TEXT DEFAULT 'store' CHECK (source_type IN ('audit','store','am','leadership')),
  sla_deadline      TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  reopen_count      INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_select" ON public.tickets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tickets_insert" ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = raised_by);

CREATE POLICY "tickets_update" ON public.tickets
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tickets_updated_at ON public.tickets;
CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =====================================================================
-- ESCALATIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.escalations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id    UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  level        INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  triggered_by UUID REFERENCES public.profiles(id),
  reason       TEXT NOT NULL CHECK (reason IN ('no_ack','sla_breach','repeated_issue','critical_severity')),
  resolved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "escalations_select" ON public.escalations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "escalations_insert" ON public.escalations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "escalations_update" ON public.escalations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- COMMENTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.comments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id       UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id       UUID REFERENCES public.profiles(id),
  content         TEXT NOT NULL,
  is_status_change BOOLEAN DEFAULT FALSE,
  old_status      TEXT,
  new_status      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON public.comments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "comments_insert" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = author_id);

-- =====================================================================
-- ATTACHMENTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.attachments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id    UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES public.profiles(id),
  file_url     TEXT NOT NULL,
  file_name    TEXT,
  file_type    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select" ON public.attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "attachments_insert" ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = uploaded_by);

-- =====================================================================
-- INTELLIGENCE INTEGRATION — Auto-ticket columns
-- Run this migration in Supabase SQL Editor after the base schema.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS intelligence_source         BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intelligence_submission_id  TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_section_id     TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_program_id     TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_program_name   TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_store_code     TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_deductions     JSONB,
  ADD COLUMN IF NOT EXISTS intelligence_audit_score    FLOAT,
  ADD COLUMN IF NOT EXISTS intelligence_audit_pct      FLOAT,
  ADD COLUMN IF NOT EXISTS intelligence_ai_confidence  FLOAT,
  ADD COLUMN IF NOT EXISTS intelligence_pattern_flag   BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intelligence_pattern_note   TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_suggested_role TEXT;

-- Dedup index: prevent duplicate tickets for the same submission+section
CREATE UNIQUE INDEX IF NOT EXISTS tickets_intelligence_dedup
  ON public.tickets (intelligence_submission_id, intelligence_section_id)
  WHERE intelligence_source = TRUE;

-- Allow the webhook service-role to bypass RLS for ticket inserts
CREATE POLICY IF NOT EXISTS "tickets_service_insert" ON public.tickets
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "tickets_service_update" ON public.tickets
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
  WITH CHECK ((SELECT auth.uid()) = uploaded_by);

-- =====================================================================
-- SEED DATA — Sample stores
-- =====================================================================
INSERT INTO public.stores (store_name, store_code, city, region, tier) VALUES
  ('Indiranagar Flagship', 'IND-001', 'Bangalore', 'South', 'flagship'),
  ('Koramangala Store', 'KOR-002', 'Bangalore', 'South', 'standard'),
  ('Whitefield Express', 'WHT-003', 'Bangalore', 'East', 'express'),
  ('MG Road Premium', 'MGR-004', 'Bangalore', 'Central', 'flagship'),
  ('Bandra West', 'BAN-005', 'Mumbai', 'West', 'standard'),
  ('Juhu Store', 'JUH-006', 'Mumbai', 'West', 'express'),
  ('Connaught Place', 'CP-007', 'Delhi', 'North', 'flagship'),
  ('Saket Store', 'SAK-008', 'Delhi', 'North', 'standard')
ON CONFLICT (store_code) DO NOTHING;

-- =====================================================================
-- Enable Realtime on key tables
-- =====================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.escalations;

SELECT 'Schema created successfully! 🚀' AS result;
