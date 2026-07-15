-- =====================================================================
-- Migration: Prism Assets v1 — registry, vendors, categories, QR codes
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Adds (all additive — no existing table changes shape):
--   1. asset_categories  — what kind of thing an asset is + owning dept
--   2. vendors           — AMC / service vendors (captured fresh)
--   3. assets            — the registry; asset_code is what the QR encodes
--   4. tickets.asset_id  — nullable FK; a breakdown report is just a
--                          ticket that points at an asset
--   5. RLS mirroring the tickets scoping model
--
-- QR strategy: each asset gets a unique human-typable code (AST-00042).
-- The printed QR encodes the URL /assets/view?code=AST-00042 so staff can
-- scan with the native phone camera — no app, opens straight in browser.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. ASSET CATEGORIES
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  department  TEXT NOT NULL DEFAULT 'Maintenance'
              CHECK (department IN ('Operations','HR','IT','SCM','QA','Finance','Maintenance','L&D')),
  default_pm_interval_days INT,          -- used by Phase 2 preventive maintenance
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_categories_select ON public.asset_categories;
CREATE POLICY asset_categories_select ON public.asset_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS asset_categories_write ON public.asset_categories;
CREATE POLICY asset_categories_write ON public.asset_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('super_admin','leadership')));

-- Seed the common café/retail equipment set (idempotent)
INSERT INTO public.asset_categories (name, department, default_pm_interval_days) VALUES
  ('Espresso Machine',   'Maintenance', 30),
  ('Coffee Grinder',     'Maintenance', 30),
  ('Coffee Brewer',      'Maintenance', 30),
  ('Refrigerator / Chiller', 'Maintenance', 90),
  ('Freezer',            'Maintenance', 90),
  ('Ice Machine',        'Maintenance', 60),
  ('Oven / Merrychef',   'Maintenance', 60),
  ('Blender',            'Maintenance', 90),
  ('Dishwasher',         'Maintenance', 90),
  ('Water Filtration (RO)', 'Maintenance', 90),
  ('HVAC / Air Conditioner', 'Maintenance', 90),
  ('Furniture & Fixtures', 'Maintenance', NULL),
  ('Signage',            'Operations', NULL),
  ('POS Terminal',       'IT', NULL),
  ('Receipt Printer',    'IT', NULL),
  ('WiFi Router / Network', 'IT', NULL),
  ('CCTV / Security',    'IT', 180),
  ('Music / AV System',  'IT', NULL),
  ('Weighing Scale',     'QA', 180),
  ('Fire Extinguisher',  'QA', 365)
ON CONFLICT (name) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────
-- 2. VENDORS (AMC / service partners)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vendors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  sla_hours     INT,                    -- contracted response window
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_select ON public.vendors;
CREATE POLICY vendors_select ON public.vendors
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS vendors_write ON public.vendors;
CREATE POLICY vendors_write ON public.vendors
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid())
                   AND p.role IN ('super_admin','leadership','area_manager','store_manager','dept_owner')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = (SELECT auth.uid())
                        AND p.role IN ('super_admin','leadership','area_manager','store_manager','dept_owner')));


-- ─────────────────────────────────────────────────────────────────────
-- 3. ASSETS — the registry
-- ─────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.assets_code_seq START 1;

CREATE TABLE IF NOT EXISTS public.assets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_code     TEXT NOT NULL UNIQUE,   -- QR encodes /assets/view?code=<this>
  name           TEXT NOT NULL,          -- "La Marzocco Linea — Bar 1"
  category_id    UUID NOT NULL REFERENCES public.asset_categories(id),
  store_id       UUID NOT NULL REFERENCES public.stores(id),
  make           TEXT,
  model          TEXT,
  serial_no      TEXT,
  purchase_date  DATE,
  warranty_until DATE,
  amc_vendor_id  UUID REFERENCES public.vendors(id),
  amc_until      DATE,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','in_repair','retired')),
  notes          TEXT,
  created_by     UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assets_store_idx    ON public.assets (store_id);
CREATE INDEX IF NOT EXISTS assets_category_idx ON public.assets (category_id);
CREATE INDEX IF NOT EXISTS assets_status_idx   ON public.assets (status);

-- Auto-generate the human-typable code when the client doesn't send one
CREATE OR REPLACE FUNCTION public.assets_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.asset_code IS NULL OR NEW.asset_code = '' THEN
    NEW.asset_code := 'AST-' || lpad(nextval('public.assets_code_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_autocode ON public.assets;
CREATE TRIGGER assets_autocode
  BEFORE INSERT ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.assets_before_insert();

DROP TRIGGER IF EXISTS assets_updated_at ON public.assets;
CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── RLS: mirror the tickets scoping model ────────────────────────────
-- store_team / store_manager → their store's assets
-- area_manager               → their region
-- dept_owner                 → assets whose category belongs to their dept
-- auditor                    → everything (they audit any store)
-- leadership / super_admin   → everything

CREATE OR REPLACE FUNCTION public.can_view_asset(a_store UUID, a_category UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN RETURN FALSE; END IF;

  IF me.role IN ('super_admin','leadership','auditor') THEN RETURN TRUE; END IF;

  IF me.role IN ('store_team','store_manager') THEN
    RETURN me.store_id IS NOT NULL AND a_store = me.store_id;
  ELSIF me.role = 'area_manager' THEN
    RETURN me.region IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stores s WHERE s.id = a_store AND s.region = me.region);
  ELSIF me.role = 'dept_owner' THEN
    RETURN me.department IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.asset_categories c WHERE c.id = a_category AND c.department = me.department);
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_asset(a_store UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN RETURN FALSE; END IF;

  IF me.role IN ('super_admin','leadership') THEN RETURN TRUE; END IF;
  IF me.role = 'store_manager' THEN
    RETURN me.store_id IS NOT NULL AND a_store = me.store_id;
  ELSIF me.role = 'area_manager' THEN
    RETURN me.region IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stores s WHERE s.id = a_store AND s.region = me.region);
  END IF;

  RETURN FALSE;
END;
$$;

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets
  FOR SELECT TO authenticated
  USING (public.can_view_asset(store_id, category_id));

DROP POLICY IF EXISTS assets_insert ON public.assets;
CREATE POLICY assets_insert ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_asset(store_id));

DROP POLICY IF EXISTS assets_update ON public.assets;
CREATE POLICY assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING (public.can_manage_asset(store_id))
  WITH CHECK (public.can_manage_asset(store_id));

DROP POLICY IF EXISTS assets_delete ON public.assets;
CREATE POLICY assets_delete ON public.assets
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = (SELECT auth.uid()) AND p.role = 'super_admin'));


-- ─────────────────────────────────────────────────────────────────────
-- 4. TICKETS ← ASSETS link (the only touch on an existing table)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tickets_asset_idx ON public.tickets (asset_id);


SELECT 'assets v1 migration complete ✅' AS result;
