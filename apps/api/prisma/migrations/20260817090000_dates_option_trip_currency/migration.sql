-- Put the seeded Dates option's currency right on trips that already exist.
--
-- `OptionsService.seedLockedDates` hardcoded 'EUR' on every trip created with
-- dates on the form, on the reasoning that a Dates option is unpriced so its
-- currency code is arbitrary. The cost engine disagreed: it aggregated locked
-- options by currency whether or not they carried an amount, so a trip created
-- in USD reported a zero-EUR subtotal and the board drew a total, a per-person
-- figure and a chart for money nobody had committed.
--
-- The engine no longer aggregates unpriced options and the seed now stores the
-- trip's own currency, but the rows written before both fixes still hold the
-- wrong code. Narrow on purpose: only options that are unpriced AND in a
-- built-in DATES category, which is exactly the set that can never carry a
-- price (the option form hides the cost fields there). A priced option's
-- currency is a user's own choice and is never touched.
--
-- Additive and idempotent: an UPDATE to a value the row should already have had.
UPDATE "options" o
SET "currency" = t."defaultCurrency"
FROM "categories" c, "trips" t
WHERE o."categoryId" = c."id"
  AND c."tripId" = t."id"
  AND c."builtinKey" = 'DATES'
  AND o."amount" IS NULL
  AND o."currency" <> t."defaultCurrency";
