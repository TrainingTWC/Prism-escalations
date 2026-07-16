-- =====================================================================
-- Migration: Prism Assets v3 — inter-store transfers, spare parts
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
--
-- Depends on: migration_assets_v1.sql, migration_assets_v2.sql,
-- migration_workflow_v3.sql (dispatch_email, dispatch_push, distinct_ids,
-- recipients_from_ids, store_verifier_ids, region_am_ids, leadership_ids).
--
-- Adds:
--   1. asset_transfers — request/track a spare asset moving between stores
--   2. Transfer lifecycle trigger — stamps timestamps, moves the asset's
--      store_id the moment a transfer is marked received
--   3. transfer_requested email/push notification to the counterparty store
--   4. spare_parts — simple per-store stock counts
--   5. spare_part_usage_log + spare_part_use() RPC — any fixer (incl. store
--      team) can log "used 1 gasket" without needing broad write access
--
-- AFTER RUNNING: redeploy send-email (new transfer_requested template):
--   supabase functions deploy send-email --no-verify-jwt
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. ASSET TRANSFERS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_transfers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id      UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  from_store_id UUID NOT NULL REFERENCES public.stores(id),
  to_store_id   UUID NOT NULL REFERENCES public.stores(id),
  status        TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','in_transit','received','cancelled')),
  requested_by  UUID REFERENCES public.profiles(id),
  received_by   UUID REFERENCES public.profiles(id),
  notes         TEXT,
  requested_at   TIMESTAMPTZ DEFAULT NOW(),
  in_transit_at  TIMESTAMPTZ,
  received_at    TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  CHECK (from_store_id <> to_store_id)
);

CREATE INDEX IF NOT EXISTS transfers_asset_idx ON public.asset_transfers (asset_id);
CREATE INDEX IF NOT EXISTS transfers_from_idx  ON public.asset_transfers (from_store_id);
CREATE INDEX IF NOT EXISTS transfers_to_idx    ON public.asset_transfers (to_store_id);

-- Only one active (non-terminal) transfer per asset at a time
CREATE UNIQUE INDEX IF NOT EXISTS transfers_one_active_per_asset
  ON public.asset_transfers (asset_id)
  WHERE status IN ('requested', 'in_transit');

-- ── Permission helper: manage/view a transfer if you manage either side ─────

CREATE OR REPLACE FUNCTION public.can_touch_transfer(t_from UUID, t_to UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.can_manage_asset(t_from) OR public.can_manage_asset(t_to);
END;
$$;

ALTER TABLE public.asset_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfers_select ON public.asset_transfers;
CREATE POLICY transfers_select ON public.asset_transfers
  FOR SELECT TO authenticated
  USING (public.can_touch_transfer(from_store_id, to_store_id));

DROP POLICY IF EXISTS transfers_insert ON public.asset_transfers;
CREATE POLICY transfers_insert ON public.asset_transfers
  FOR INSERT TO authenticated
  WITH CHECK (public.can_touch_transfer(from_store_id, to_store_id));

DROP POLICY IF EXISTS transfers_update ON public.asset_transfers;
CREATE POLICY transfers_update ON public.asset_transfers
  FOR UPDATE TO authenticated
  USING (public.can_touch_transfer(from_store_id, to_store_id))
  WITH CHECK (public.can_touch_transfer(from_store_id, to_store_id));

-- ── Lifecycle: stamp timestamps, move the asset on receipt ──────────────────

CREATE OR REPLACE FUNCTION public.transfers_guard_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_transit' THEN
      NEW.in_transit_at := NOW();
    ELSIF NEW.status = 'received' THEN
      NEW.received_at := NOW();
      NEW.received_by := COALESCE(NEW.received_by, auth.uid());
      -- The actual move: the asset now lives at the destination store.
      UPDATE public.assets SET store_id = NEW.to_store_id WHERE id = NEW.asset_id;
    ELSIF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfers_guard ON public.asset_transfers;
CREATE TRIGGER transfers_guard
  BEFORE UPDATE ON public.asset_transfers
  FOR EACH ROW EXECUTE FUNCTION public.transfers_guard_transition();

-- ── Notify the counterparty store when a transfer is requested ──────────────

CREATE OR REPLACE FUNCTION public.notify_asset_transfer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a          public.assets%ROWTYPE;
  from_store RECORD;
  to_store   RECORD;
  requester_at_from BOOLEAN;
  targets    UUID[];
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = NEW.asset_id;
  SELECT store_name, region INTO from_store FROM public.stores WHERE id = NEW.from_store_id;
  SELECT store_name, region INTO to_store   FROM public.stores WHERE id = NEW.to_store_id;

  SELECT (store_id = NEW.from_store_id) INTO requester_at_from
  FROM public.profiles WHERE id = NEW.requested_by;

  -- Notify whichever side did NOT initiate the request.
  IF COALESCE(requester_at_from, TRUE) THEN
    targets := public.distinct_ids(public.store_verifier_ids(NEW.to_store_id) || public.region_am_ids(NEW.to_store_id));
  ELSE
    targets := public.distinct_ids(public.store_verifier_ids(NEW.from_store_id) || public.region_am_ids(NEW.from_store_id));
  END IF;

  PERFORM public.dispatch_email(jsonb_build_object(
    'event', 'transfer_requested',
    'recipients', public.recipients_from_ids(targets),
    'asset', jsonb_build_object(
      'name', a.name, 'code', a.asset_code,
      'path', '/assets/view/?id=' || a.id::text
    ),
    'transfer', jsonb_build_object(
      'fromStore', COALESCE(from_store.store_name, '—'),
      'toStore',   COALESCE(to_store.store_name, '—'),
      'notes',     NEW.notes
    )));

  PERFORM public.dispatch_push(jsonb_build_object(
    'user_ids', to_jsonb(targets),
    'title', 'Asset transfer requested',
    'body', a.name || ': ' || COALESCE(from_store.store_name,'?') || ' → ' || COALESCE(to_store.store_name,'?'),
    'data', jsonb_build_object('path', '/assets/view/?id=' || a.id::text)));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfers_notify ON public.asset_transfers;
CREATE TRIGGER transfers_notify
  AFTER INSERT ON public.asset_transfers
  FOR EACH ROW EXECUTE FUNCTION public.notify_asset_transfer();


-- ─────────────────────────────────────────────────────────────────────
-- 2. SPARE PARTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spare_parts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id          UUID NOT NULL REFERENCES public.stores(id),
  category_id       UUID REFERENCES public.asset_categories(id),
  name              TEXT NOT NULL,
  sku               TEXT,
  qty_on_hand       INT NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  reorder_threshold INT DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS parts_store_idx ON public.spare_parts (store_id);

DROP TRIGGER IF EXISTS parts_updated_at ON public.spare_parts;
CREATE TRIGGER parts_updated_at
  BEFORE UPDATE ON public.spare_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_store_parts(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN RETURN FALSE; END IF;
  IF me.role IN ('super_admin','leadership') THEN RETURN TRUE; END IF;
  IF me.role IN ('store_team','store_manager') THEN RETURN me.store_id = p_store_id; END IF;
  IF me.role = 'area_manager' THEN
    RETURN EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.region = me.region);
  END IF;
  RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS parts_select ON public.spare_parts;
CREATE POLICY parts_select ON public.spare_parts
  FOR SELECT TO authenticated USING (public.can_view_store_parts(store_id));

DROP POLICY IF EXISTS parts_write ON public.spare_parts;
CREATE POLICY parts_write ON public.spare_parts
  FOR ALL TO authenticated
  USING (public.can_manage_asset(store_id))
  WITH CHECK (public.can_manage_asset(store_id));

-- ── Usage log + safe RPC so any fixer can log "used 1 gasket" ───────────────

CREATE TABLE IF NOT EXISTS public.spare_part_usage_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id    UUID NOT NULL REFERENCES public.spare_parts(id) ON DELETE CASCADE,
  ticket_id  UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  qty        INT NOT NULL CHECK (qty > 0),
  used_by    UUID REFERENCES public.profiles(id),
  used_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS parts_usage_part_idx ON public.spare_part_usage_log (part_id);

ALTER TABLE public.spare_part_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_usage_select ON public.spare_part_usage_log;
CREATE POLICY parts_usage_select ON public.spare_part_usage_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.spare_parts p
                 WHERE p.id = spare_part_usage_log.part_id AND public.can_view_store_parts(p.store_id)));

CREATE OR REPLACE FUNCTION public.spare_part_use(p_part_id UUID, p_qty INT, p_ticket_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  part public.spare_parts%ROWTYPE;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  SELECT * INTO part FROM public.spare_parts WHERE id = p_part_id;
  IF part.id IS NULL THEN RAISE EXCEPTION 'Spare part not found'; END IF;
  IF NOT public.can_view_store_parts(part.store_id) THEN
    RAISE EXCEPTION 'Not allowed to use parts at this store';
  END IF;

  INSERT INTO public.spare_part_usage_log (part_id, ticket_id, qty, used_by)
  VALUES (p_part_id, p_ticket_id, p_qty, auth.uid());

  UPDATE public.spare_parts
  SET qty_on_hand = GREATEST(0, qty_on_hand - p_qty)
  WHERE id = p_part_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.spare_part_use(UUID, INT, UUID) TO authenticated;


SELECT 'assets v3 migration complete ✅' AS result;
