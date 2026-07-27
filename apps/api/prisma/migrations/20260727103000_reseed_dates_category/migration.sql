-- Re-seed the Dates category into every trip that no longer has one.
--
-- Deleting Dates is blocked from now on (canDeleteCategory), but trips that lost
-- it before that rule existed had no way back: `categories_tripId_builtinKey_key`
-- means a custom category can never reclaim the DATES key, so those trips were
-- stuck without a date-setting path and silently fell back to a created-plus-one-
-- year expiry. This makes "every trip has a Dates category" true everywhere, so
-- no later code needs a null check.
--
-- Applied to History trips too: a re-seeded category is read-only there anyway
-- (write paths check the freeze), and leaving frozen trips as the one exception
-- would reintroduce exactly the null case this removes.
--
-- Appended at the end rather than inserted at position 0, so a trip's manually
-- dragged category order is left untouched. singleChoice/isBuiltin/name mirror
-- BUILTIN_CATEGORIES' DATES entry.
INSERT INTO "categories" (
    "id",
    "tripId",
    "name",
    "singleChoice",
    "isBuiltin",
    "builtinKey",
    "position",
    "version",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid(),
    t."id",
    'Dates',
    true,
    true,
    'DATES',
    COALESCE(
        (SELECT MAX(c2."position") + 1 FROM "categories" c2 WHERE c2."tripId" = t."id"),
        0
    ),
    0,
    NOW(),
    NOW()
FROM "trips" t
WHERE NOT EXISTS (
    SELECT 1
    FROM "categories" c
    WHERE c."tripId" = t."id"
      AND c."builtinKey" = 'DATES'
);
