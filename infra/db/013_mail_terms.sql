ALTER TABLE service_plans
  ADD COLUMN biennial_price_vnd integer CHECK (biennial_price_vnd >= 0);

UPDATE service_plans SET trial_days = 7 WHERE name = 'Email Free' AND trial_days = 30;
