-- =====================================================================
-- Migration: Add 'rejected' as a valid ticket status
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/sldvlxpxdcgzrlyqezsi/sql/new
-- =====================================================================

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_status_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN (
    'open', 'acknowledged', 'accepted', 'rejected',
    'in_progress', 'waiting', 'snag',
    'resolved', 'verification', 'closed'
  ));
