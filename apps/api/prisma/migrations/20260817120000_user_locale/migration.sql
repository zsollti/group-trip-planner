-- The language each account reads the interface in.
--
-- Text with a default rather than a Postgres enum, so offering another language
-- is a dictionary plus a one-line contract change instead of a migration on a
-- type — the same reasoning as `admin_audit_events.action`. The shared `LOCALES`
-- is what constrains it: the API validates on the way in and narrows on the way
-- out, so a value this build does not offer can neither be stored through the
-- app nor reach a screen.
--
-- Additive and safe to re-run against a populated table: every existing row
-- takes the default, which is the language the app was already written in, so
-- nobody's screen changes.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
