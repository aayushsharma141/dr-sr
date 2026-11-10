-- ===========================================================================
-- Schema v4: Kalyan Hospital billing rules (SW-27, BIL-01, D-05)
--
-- Adds print_count to payments for tracking duplicate receipt reprints.
-- Enforces Invariant 10: Payment history preserved, duplicate reprints tracked.
-- ===========================================================================

ALTER TABLE payments ADD COLUMN print_count INTEGER NOT NULL DEFAULT 0;

