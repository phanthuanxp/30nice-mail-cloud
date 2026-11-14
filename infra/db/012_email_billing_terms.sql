ALTER TABLE service_plans
  ADD COLUMN quarterly_price_vnd integer CHECK (quarterly_price_vnd >= 0),
  ADD COLUMN semiannual_price_vnd integer CHECK (semiannual_price_vnd >= 0);

UPDATE service_plans AS plan
SET quarterly_price_vnd = rates.quarterly,
    semiannual_price_vnd = rates.semiannual
FROM (VALUES
  ('Email Basic', 147000, 269500),
  ('Email Business', 237000, 434500),
  ('Email Professional', 387000, 709500),
  ('Email Enterprise', 567000, 1039500)
) AS rates(name, quarterly, semiannual)
WHERE plan.name = rates.name AND plan.trial_days IS NULL;
