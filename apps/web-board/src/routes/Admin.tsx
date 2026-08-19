import { useState, type FormEvent } from "react";
import { intlTag } from "../lib/locale";
import {
  ApiError,
  useAdminAudit,
  useAdminOverview,
  useAdminUserLookup,
  useAuth,
  useBanUser,
  useDeleteUser,
  useMarkVerified,
  useResendVerification,
  useRunDemoSeed,
  useRunPlacesSeed,
  useUnbanUser,
} from "@gtp/api-client";
import { BAN_REASON_MAX, banIsActive } from "@gtp/types";
import type {
  AdminUserDeletion,
  AdminDemoSeed,
  AdminPlacesSeed,
  AdminEmail,
  AdminRates,
  AdminUserSummary,
  AdminVolume,
} from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { Brand } from "../components/Brand";
import { UserMenu } from "../components/UserMenu";
import { plural, t, tNode } from "../lib/i18n";

/**
 * The operator's console.
 *
 * Not a product screen — this is for running the deployment, and it is built
 * around the questions that actually come up while doing that: is the mail
 * queue moving, are the exchange rates fresh, which build is serving, and why
 * can this one person not create a trip.
 *
 * Everything here is a count, a timestamp or an address. There is deliberately
 * no trip content — no option titles, no messages, no amounts — so that the
 * console cannot become a way to read the app's users, only a way to run the
 * service they use.
 */
export function Admin() {
  const { user } = useAuth();
  const overview = useAdminOverview();

  return (
    <main className="board">
      <header className="board__bar">
        <Brand />
        <div className="board__bar-actions">
          <UserMenu />
        </div>
      </header>

      <p className="board__eyebrow">
        {t("Operations · signed in as {email}", { email: user?.email ?? "" })}
      </p>
      <h1 className="board__title">{t("Console")}</h1>

      {overview.isPending ? (
        <p className="board__muted" role="status">
          {t("Reading the deployment…")}
        </p>
      ) : overview.isError ? (
        <p className="board__form-error" role="alert">
          {overview.error.status === 404
            ? t("This deployment has no console configured for you.")
            : t("Couldn't read the deployment.")}
        </p>
      ) : (
        <div className="admin">
          <SystemPanel
            system={overview.data.system}
            onRefresh={() => void overview.refetch()}
            refreshing={overview.isFetching}
          />
          <EmailPanel email={overview.data.email} />
          <RatesPanel rates={overview.data.rates} />
          <VolumePanel volume={overview.data.volume} />
        </div>
      )}

      <UserLookup />
      <DemoPanel />
      <PlacesPanel />
      <AuditPanel />
    </main>
  );
}

/**
 * Loading the gazetteer, which is the one step a new environment needs by hand.
 *
 * It exists here for the reason the demo panel does, only more so: the CLI route
 * meant a `railway ssh` and a remembered command for something that has to happen
 * exactly once, and whose absence is **silent**. Nothing breaks without it — the
 * destination field just offers no suggestions, which reads as a feature that was
 * never built rather than a table that was never filled.
 *
 * No confirmation step, unlike the demo rebuild. There is nothing to lose: it
 * writes one reference table that no trip has a foreign key into, and a trip that
 * resolved to a place already keeps its own copy of the clock and coordinates it
 * took. The worst a stray click costs is a few seconds.
 *
 * It does say it is working, though. This is the slowest thing on the page by an
 * order of magnitude, and a button that looks inert for eight seconds is a button
 * people press twice.
 */
function PlacesPanel() {
  const seed = useRunPlacesSeed();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminPlacesSeed | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    try {
      setResult(await seed.mutateAsync());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("That didn't work."));
    }
  }

  return (
    <section
      className="admin__panel admin__panel--wide"
      aria-label={t("Place list")}
    >
      <h2 className="admin__panel-title">{t("Place list")}</h2>
      <p className="admin__note">
        {t(
          "Loads the destination suggestions — every populated place over 5,000 people, every region and every country — from the dataset shipped with this build. Needed once per environment; nothing else uses it and nothing depends on it, so re-running is safe. Until it has run, the destination field on the create-trip form simply offers nothing.",
        )}
      </p>

      <div className="admin__actions">
        <Button
          type="button"
          variant="secondary"
          disabled={seed.isPending}
          onClick={() => void run()}
        >
          {seed.isPending ? t("Loading places…") : t("Load the place list")}
        </Button>
      </div>
      {/* Said out loud, because the button being disabled is not an explanation
          and this takes long enough to look stuck. */}
      {seed.isPending ? (
        <p className="admin__note" role="status">
          {t("Writing tens of thousands of rows — this takes a few seconds.")}
        </p>
      ) : null}

      {result ? (
        <div>
          <p className="admin__done" role="status">
            {t("Places loaded.")}
          </p>
          {/* The shape of the answer is the check: seventy-odd thousand against
              two hundred and fifty is what a loaded dataset looks like, and it
              is how an operator tells a real load from an empty file. */}
          <Row
            label={t("Places")}
            value={`${result.places - result.regions - result.nations} cities · ${result.regions} regions · ${result.nations} countries`}
          />
          <Row
            label={t("Currencies")}
            value={`${result.countries} countries`}
          />
        </div>
      ) : null}
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Rebuild the public demo trip.
 *
 * The only destructive button in the app, and the only thing here that writes
 * trip content rather than reading metadata — so it is the only one that asks
 * twice. The confirm step is inline rather than a dialog, matching how deleting
 * a lane asks: a question in the place the answer will land, not a layer over
 * the screen.
 *
 * What it is *for*: the demo drifts. Visitors sign in with the published
 * credentials and vote, propose and lock things, and a migration can quietly
 * change the shape of what the demo was built to show. Until now the fix was a
 * CLI run against the production database — which meant reaching for a
 * connection string to repair a display trip.
 */
function DemoPanel() {
  const reseed = useRunDemoSeed();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminDemoSeed | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    setConfirming(false);
    try {
      setResult(await reseed.mutateAsync());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("That didn't work."));
    }
  }

  return (
    <section
      className="admin__panel admin__panel--wide"
      aria-label={t("Demo data")}
    >
      <h2 className="admin__panel-title">{t("Demo data")}</h2>
      <p className="admin__note">
        {tNode(
          "Deletes the trips owned by {account} and rebuilds the published demo board from the seed — five members, fourteen options, four decisions, the chat and the votes. No other account is touched, and the demo password is reset to the one in the README.",
          { account: <strong>demo@example.com</strong> },
        )}
      </p>

      {confirming ? (
        <>
          <p className="admin__alert" role="alert">
            {t(
              "This throws away whatever visitors have done to the demo, and cannot be undone.",
            )}
          </p>
          <div className="admin__actions">
            <Button type="button" onClick={() => void run()}>
              {t("Yes, rebuild it")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              {t("Cancel")}
            </Button>
          </div>
        </>
      ) : (
        <div className="admin__actions">
          <Button
            type="button"
            variant="secondary"
            disabled={reseed.isPending}
            onClick={() => setConfirming(true)}
          >
            {reseed.isPending ? t("Rebuilding…") : t("Rebuild the demo trip")}
          </Button>
        </div>
      )}

      {result ? (
        <div>
          <p className="admin__done" role="status">
            {t("Demo rebuilt.")}
          </p>
          <Row label={t("Trip")} value={result.tripName} />
          <Row label={t("Board id")} value={result.tripId} />
          <Row
            label={t("Contents")}
            value={`${result.members} members · ${result.options} options · ${result.decisions} decisions · ${result.messages} messages`}
          />
          <Row
            label={t("Replaced")}
            value={
              result.removedTrips === 0
                ? t("nothing — there was no demo trip here")
                : `${result.removedTrips} previous demo trip(s)`
            }
          />
        </div>
      ) : null}
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** A titled block. Every panel is one, so they align without each re-stating it. */
function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  /** `warn` paints the left edge when the panel is reporting a problem. */
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section
      className={"admin__panel" + (tone ? ` admin__panel--${tone}` : "")}
      aria-label={title}
    >
      <h2 className="admin__panel-title">{title}</h2>
      {children}
    </section>
  );
}

/** One label/value row. The value is monospaced — most of them are identifiers. */
function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "good";
}) {
  return (
    <div className="admin__row">
      <span className="admin__row-label">{label}</span>
      <span
        className={
          "admin__row-value" + (tone ? ` admin__row-value--${tone}` : "")
        }
      >
        {value}
      </span>
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(intlTag());
}

/** "3 days ago" for a calendar day or an instant — staleness reads better relative. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SystemPanel({
  system,
  onRefresh,
  refreshing,
}: {
  system: import("@gtp/types").AdminSystem;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Panel title={t("This deployment")}>
      <Row label={t("Environment")} value={system.environment} />
      <Row
        label={t("Commit")}
        value={system.commit ? system.commit.slice(0, 10) : "unstamped"}
      />
      <Row label={t("Contract")} value={system.contractVersion} />
      <Row label={t("Node")} value={system.nodeVersion} />
      <Row
        label={t("Up since")}
        value={`${when(system.startedAt)} (${ago(system.startedAt)})`}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? t("Reading…") : t("Refresh")}
      </Button>
    </Panel>
  );
}

/**
 * The mail queue.
 *
 * `stuckSending` is the reason this panel exists. A job claimed `SENDING` by a
 * worker that then died sits claimed until something reclaims it, and every
 * other signal in the system stays green while no mail goes out at all.
 */
function EmailPanel({ email }: { email: AdminEmail }) {
  const stuck = email.stuckSending > 0;
  return (
    <Panel title={t("Email queue")} tone={stuck ? "warn" : undefined}>
      {!email.configured ? (
        <p className="admin__note">
          {t("No provider key set — mail is logged to the console, not sent.")}
        </p>
      ) : null}
      <Row label={t("Pending")} value={email.pending} />
      <Row label={t("Sending")} value={email.sending} />
      <Row label={t("Sent")} value={email.sent} />
      <Row
        label={t("Failed")}
        value={email.failed}
        tone={email.failed > 0 ? "warn" : undefined}
      />
      {stuck ? (
        <p className="admin__alert" role="alert">
          {plural(
            email.stuckSending,
            "{n} job claimed longer ago than the reclaim window — a worker probably died mid-send.",
            "{n} jobs claimed longer ago than the reclaim window — a worker probably died mid-send.",
          )}
        </p>
      ) : null}
      {email.recentFailures.length > 0 ? (
        <ul className="admin__list">
          {email.recentFailures.map((f) => (
            <li key={f.id} className="admin__failure">
              <span className="admin__failure-to">{f.to}</span>
              <span className="admin__failure-meta">
                {f.type} · {plural(f.attempts, "{n} attempt", "{n} attempts")} ·{" "}
                {ago(f.updatedAt)}
              </span>
              {f.lastError ? (
                <span className="admin__failure-error">{f.lastError}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/**
 * The exchange-rate snapshot.
 *
 * Conversion fails silently by design, so this is the only place the difference
 * between "switched off on purpose" and "the feed has been broken for a week"
 * is visible at all. Rates publish on working days, so the staleness threshold
 * allows for a weekend before it says anything.
 */
function RatesPanel({ rates }: { rates: AdminRates }) {
  const stale =
    rates.configured &&
    (rates.fetchedAt === null ||
      Date.now() - new Date(rates.fetchedAt).getTime() > 4 * 24 * 3600_000);
  return (
    <Panel title={t("Exchange rates")} tone={stale ? "warn" : undefined}>
      {!rates.configured ? (
        <p className="admin__note">
          {t(
            "No feed configured — conversion is off, and every dashboard reports exact per-currency figures only. This is a valid deployment.",
          )}
        </p>
      ) : (
        <>
          <Row label={t("Currencies")} value={rates.currencies} />
          <Row label={t("Published")} value={rates.asOf ?? "—"} />
          <Row
            label={t("Fetched")}
            value={`${when(rates.fetchedAt)} (${ago(rates.fetchedAt)})`}
            tone={stale ? "warn" : "good"}
          />
          <Row label={t("Source")} value={rates.source ?? "—"} />
          {stale ? (
            <p className="admin__alert" role="alert">
              {t(
                "A feed is configured but the snapshot has not refreshed in days. Every ≈ total in the app is being computed from it.",
              )}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Bytes, in the unit a human would say. */
function bytes(n: number | null): string {
  if (n === null) return "unreadable";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function VolumePanel({ volume }: { volume: AdminVolume }) {
  const peak = Math.max(1, ...volume.signups.map((d) => d.count));
  const total = volume.signups.reduce((sum, d) => sum + d.count, 0);
  return (
    <Panel title={t("Volume")}>
      <Row
        label={t("Users")}
        value={`${volume.users} (${volume.verifiedUsers} verified)`}
      />
      <Row
        label={t("Trips")}
        value={`${volume.trips} (${volume.activeTrips} active)`}
      />
      <Row label={t("Options")} value={volume.options} />
      <Row label={t("Messages")} value={volume.messages} />
      <Row label={t("Uploads")} value={bytes(volume.uploadBytes)} />
      {/* Zero-filled server-side, so a quiet month draws as a quiet month
          rather than as a dense one with fewer bars. */}
      <div
        className="admin__spark"
        role="img"
        aria-label={t("{n} signups in the last 30 days", { n: total })}
      >
        {volume.signups.map((d) => (
          <span
            key={d.date}
            className="admin__spark-bar"
            style={{ height: `${Math.round((d.count / peak) * 100)}%` }}
            title={t("{date}: {count}", { date: d.date, count: d.count })}
          />
        ))}
      </div>
      <p className="admin__note">
        {t("{n} signups in the last 30 days", { n: total })}
      </p>
    </Panel>
  );
}

/**
 * Find one person and act on them.
 *
 * The realistic support case is "I can't create a trip", which is almost always
 * an unverified address — so verification state is the first thing this shows,
 * and the two things it can do about it sit directly under it.
 */
function UserLookup() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const results = useAdminUserLookup(query);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setQuery(input.trim());
  }

  return (
    <section
      className="admin__panel admin__panel--wide"
      aria-label={t("Find a user")}
    >
      <h2 className="admin__panel-title">{t("Find a user")}</h2>
      <form className="admin__search" onSubmit={onSubmit}>
        <label className="board__sr-only" htmlFor="admin-q">
          {t("Email, name, or user id")}
        </label>
        <input
          id="admin-q"
          className="board__input"
          value={input}
          placeholder={t("email, name, or user id")}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          {t("Find")}
        </Button>
      </form>

      {query && results.isPending ? (
        <p className="board__muted" role="status">
          {t("Looking…")}
        </p>
      ) : results.isError ? (
        <p className="board__form-error" role="alert">
          {t("Couldn't run that lookup.")}
        </p>
      ) : results.data && results.data.users.length === 0 ? (
        <p className="board__muted">
          {t("Nobody matches “{query}”.", { query })}
        </p>
      ) : (
        results.data?.users.map((u) => <UserCard key={u.id} user={u} />)
      )}
    </section>
  );
}

function UserCard({ user }: { user: AdminUserSummary }) {
  const resend = useResendVerification();
  const verify = useMarkVerified();
  const unban = useUnbanUser();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Asked of the shared rule rather than of `user.ban !== null`, which is the
  // difference between "is suspended" and "has ever been suspended" — and this
  // card shows both, so it is the one screen where confusing them is easy.
  const banned = user.ban ? banIsActive(user.ban) : false;

  async function run(what: "resend" | "verify" | "unban") {
    setError(null);
    setDone(null);
    try {
      if (what === "resend") {
        await resend.mutateAsync(user.id);
        setDone(t("Verification email sent."));
      } else if (what === "verify") {
        await verify.mutateAsync(user.id);
        setDone(t("Marked verified."));
      } else {
        await unban.mutateAsync(user.id);
        setDone(t("Suspension lifted."));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("That didn't work."));
    }
  }

  const busy = resend.isPending || verify.isPending || unban.isPending;

  return (
    <article className="admin__user">
      <header className="admin__user-head">
        <strong>{user.displayName}</strong>
        <span className="admin__user-email">{user.email}</span>
        {user.emailVerified ? (
          <span className="admin__badge admin__badge--good">
            {t("Verified")}
          </span>
        ) : (
          <span className="admin__badge admin__badge--warn">
            {t("Unverified")}
          </span>
        )}
        {user.anonymizedAt ? (
          <span className="admin__badge">{t("Anonymized")}</span>
        ) : null}
        {banned ? (
          <span className="admin__badge admin__badge--warn">
            {t("Suspended")}
          </span>
        ) : user.ban ? (
          // A lapsed one still shows. The row is kept past its own expiry
          // precisely so an operator looking someone up after a complaint can
          // see that this happened, and a badge that vanished with the ban
          // would hide exactly the fact they came here for.
          <span className="admin__badge">{t("Was suspended")}</span>
        ) : null}
      </header>
      <Row label={t("Signed up")} value={when(user.createdAt)} />
      <Row label={t("Last seen")} value={ago(user.lastSeenAt)} />
      <Row label={t("Trips")} value={user.tripCount} />
      <Row
        label={t("Sign-in")}
        value={user.hasPassword ? "password" : t("Google only")}
      />

      {user.emailJobs.length > 0 ? (
        <ul className="admin__list">
          {user.emailJobs.map((j) => (
            <li key={j.id} className="admin__failure">
              <span className="admin__failure-meta">
                {j.type} · {j.status} · {ago(j.createdAt)}
              </span>
              {j.lastError ? (
                <span className="admin__failure-error">{j.lastError}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin__note">
          {t("No mail has been queued for this account.")}
        </p>
      )}

      {user.ban ? (
        <>
          <Row
            label={banned ? t("Suspended until") : t("Was suspended until")}
            value={
              user.ban.bannedUntil === null
                ? t("Permanent")
                : // Sliced, not formatted: the instant is midnight UTC standing
                  // for a calendar day, and a local-time formatter renders it
                  // as the day before for any operator west of Greenwich.
                  user.ban.bannedUntil.slice(0, 10)
            }
          />
          <Row label={t("Reason given")} value={user.ban.banReason} />
        </>
      ) : null}

      <div className="admin__actions">
        {!user.emailVerified ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void run("resend")}
            >
              {t("Resend verification")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void run("verify")}
            >
              {t("Mark verified")}
            </Button>
          </>
        ) : null}
        {banned ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void run("unban")}
          >
            {t("Lift suspension")}
          </Button>
        ) : suspending ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setDone(null);
              setSuspending(true);
            }}
          >
            {t("Suspend account")}
          </Button>
        )}
        {/* Not offered on an account that has already been through erasure —
            there is nothing left to erase, and a button that does nothing is
            worse than no button on a screen this consequential. */}
        {user.anonymizedAt === null && !deleting ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setDone(null);
              setDeleting(true);
            }}
          >
            {t("Delete account")}
          </Button>
        ) : null}
      </div>

      {deleting ? (
        <DeleteAccountConfirm
          user={user}
          onCancel={() => setDeleting(false)}
          onDone={() => setDeleting(false)}
        />
      ) : null}

      {suspending ? (
        <SuspendForm
          user={user}
          onCancel={() => setSuspending(false)}
          onDone={() => {
            setSuspending(false);
            setDone(t("Account suspended."));
          }}
        />
      ) : null}

      {done ? (
        <p className="admin__done" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/**
 * Erasing an account: what it will do, then what it did.
 *
 * The warning is not boilerplate — it states the one thing that is not obvious
 * and that nobody can undo: **the trips this person owns do not follow them
 * out.** Each either changes hands or is deleted with everything in it, and
 * which of the two is decided by who else is on it. An operator pressing this
 * on somebody's behalf is deciding that for a group they have never met.
 *
 * Afterwards it reports what actually happened, by name, for the same reason the
 * demo-seed button reports its counts: "done" leaves the operator unable to
 * answer the next question they will be asked, which is "and what happened to
 * our trip?"
 */
function DeleteAccountConfirm({
  user,
  onCancel,
  onDone,
}: {
  user: AdminUserSummary;
  onCancel: () => void;
  onDone: () => void;
}) {
  const remove = useDeleteUser();
  const [result, setResult] = useState<AdminUserDeletion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      setResult(await remove.mutateAsync(user.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("That didn't work."));
    }
  }

  if (result) {
    return (
      <div className="admin__danger" role="status">
        <p className="admin__note">
          {t("{email} is erased.", { email: result.email })}
        </p>
        {result.impact.transfers.length === 0 &&
        result.impact.deletions.length === 0 ? (
          <p className="admin__note">{t("They owned no trips.")}</p>
        ) : (
          <ul className="admin__list">
            {result.impact.transfers.map((tr) => (
              <li key={tr.tripId} className="admin__failure">
                <span className="admin__failure-to">
                  {t("{trip} → {name}", {
                    trip: tr.tripName,
                    name: tr.successorDisplayName,
                  })}
                </span>
              </li>
            ))}
            {result.impact.deletions.map((d) => (
              <li key={d.tripId} className="admin__failure">
                <span className="admin__failure-to">
                  {t("{trip} — deleted", { trip: d.tripName })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="admin__actions">
          <Button type="button" variant="secondary" onClick={onDone}>
            {t("Close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin__danger">
      {/* Two paragraphs and two catalogue entries, not one wall: they answer
          two different questions — what happens to the trips this person owns,
          and what happens to everything they wrote in everyone else's. */}
      <p className="admin__note">
        {t(
          "Any trip they own passes to a co-organizer, or to the longest-standing participant. A trip with nobody else on it is deleted, with everything in it.",
        )}
      </p>
      <p className="admin__note">
        {t(
          "Their proposals and messages in other people's trips stay, credited to “Deleted user”. This cannot be undone.",
        )}
      </p>
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="admin__actions">
        <Button
          type="button"
          variant="primary"
          disabled={remove.isPending}
          onClick={() => void confirm()}
        >
          {remove.isPending ? t("Erasing…") : t("Yes, erase this account")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The terms of a suspension, asked for before it happens.
 *
 * Inline in the card rather than in a dialog, deliberately: the account being
 * suspended stays on screen above the form, and this is the one action in the
 * console where aiming at the wrong person is both easy and expensive.
 *
 * **Permanent is a choice, not a default and not an absence.** A blank date
 * meaning "forever" would let a slip of the finger become an indefinite ban, so
 * the switch is explicit and the date field goes quiet while it is on.
 *
 * The date is a native `<input type="date">`, which the trip board itself
 * retired in favour of a calendar the app draws. That was right there — a group
 * picking a holiday needs to see the month — and wrong here: an operator typing
 * "the end of next month" wants a field with a picker attached, and this screen
 * has no business carrying the board's calendar.
 */
function SuspendForm({
  user,
  onCancel,
  onDone,
}: {
  user: AdminUserSummary;
  onCancel: () => void;
  onDone: () => void;
}) {
  const ban = useBanUser();
  const [permanent, setPermanent] = useState(false);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Tomorrow, as the earliest end a ban can have: "until today" is one that has
  // already lapsed by the rule that reads it, which would present as a button
  // that did nothing.
  const earliest = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Both checked here as well as by the server, because the server's answer
    // to a missing reason is a validation envelope naming a field, and the
    // person who needs to read it is standing in front of that field.
    if (reason.trim() === "") {
      setError(t("Say why — the person is shown this."));
      return;
    }
    if (!permanent && until === "") {
      setError(t("Pick an end date, or choose permanent."));
      return;
    }
    try {
      await ban.mutateAsync({
        userId: user.id,
        input: { until: permanent ? null : until, reason: reason.trim() },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("That didn't work."));
    }
  }

  return (
    <form className="admin__suspend" onSubmit={submit}>
      <label className="admin__suspend-label" htmlFor={`ban-why-${user.id}`}>
        {t("Why this account is being suspended")}
      </label>
      <textarea
        id={`ban-why-${user.id}`}
        className="board__input"
        rows={2}
        maxLength={BAN_REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <label className="admin__suspend-perm">
        <input
          type="checkbox"
          checked={permanent}
          onChange={(e) => setPermanent(e.target.checked)}
        />
        {t("Permanent")}
      </label>

      <label className="admin__suspend-label" htmlFor={`ban-until-${user.id}`}>
        {t("Ends on")}
      </label>
      <input
        id={`ban-until-${user.id}`}
        type="date"
        className="board__input"
        min={earliest}
        value={until}
        disabled={permanent}
        onChange={(e) => setUntil(e.target.value)}
      />

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin__actions">
        <Button type="submit" variant="primary" disabled={ban.isPending}>
          {ban.isPending ? t("Suspending…") : t("Suspend")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

/** What operators have done here. Short, because it should stay short. */
function AuditPanel() {
  const audit = useAdminAudit();
  const entries = audit.data?.entries ?? [];
  return (
    <section
      className="admin__panel admin__panel--wide"
      aria-label={t("Operator log")}
    >
      <h2 className="admin__panel-title">{t("Operator log")}</h2>
      {audit.isPending ? (
        <p className="board__muted" role="status">
          {t("Loading…")}
        </p>
      ) : entries.length === 0 ? (
        <p className="board__muted">
          {t("Nothing has been done from this console yet.")}
        </p>
      ) : (
        <ul className="admin__list">
          {entries.map((e) => (
            <li key={e.id} className="admin__failure">
              <span className="admin__failure-to">
                {e.action.toLowerCase().replace(/_/g, " ")}
                {e.subject ? ` · ${e.subject}` : ""}
              </span>
              <span className="admin__failure-meta">
                {e.actorEmail} · {when(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
