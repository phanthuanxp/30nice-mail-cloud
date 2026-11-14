ALTER TABLE service_plans
  ADD COLUMN monthly_price_vnd integer CHECK (monthly_price_vnd >= 0),
  ADD COLUMN yearly_price_vnd integer CHECK (yearly_price_vnd >= 0);

UPDATE service_plans
SET monthly_price_vnd = CASE WHEN billing_period = 'month' THEN price_vnd END,
    yearly_price_vnd = CASE WHEN billing_period = 'year' THEN price_vnd END
WHERE trial_days IS NULL;

UPDATE service_plans AS plan
SET monthly_price_vnd = rates.monthly,
    yearly_price_vnd = rates.yearly,
    price_vnd = rates.monthly,
    billing_period = 'month'
FROM (VALUES
  ('Email Basic', 49000, 490000),
  ('Email Business', 79000, 790000),
  ('Email Professional', 129000, 1290000),
  ('Email Enterprise', 189000, 1890000)
) AS rates(name, monthly, yearly)
WHERE plan.name = rates.name AND plan.trial_days IS NULL;
