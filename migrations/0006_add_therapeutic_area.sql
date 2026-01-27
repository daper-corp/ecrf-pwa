-- Migration: Add therapeutic_area column to studies table
-- Created: 2026-01-27

ALTER TABLE studies ADD COLUMN therapeutic_area TEXT;
