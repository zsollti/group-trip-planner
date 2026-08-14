import { useTripDashboard } from "@gtp/api-client";
import type { TripDashboardView } from "@gtp/types";
import { CostBar } from "./CostBar";
// The strip's private formatter moved to `lib/money` when the option cards
// needed the same thing. One definition, so a total and the cards it is the sum
// of cannot disagree about how money is written.
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";
import {
  lockedCost,
  targetVerdict,
  type AllInTotal,
  type LockedCost,
} from "../lib/costSummary";

/** Write a figure the way its certainty deserves. */
function figure(
  amount: number,
  currency: string,
  approximate: boolean,
): string {
  return approximate ? approx(amount, currency) : money(amount, currency);
}

/** A one-line collapsed peek: what the group has committed to, altogether. */
function peek(d: TripDashboardView): string {
  const { parts, allIn } = lockedCost(d);
  if (parts.length === 0) return "No cost yet";
  // The peek used to read "€300 → €300 +", pairing the locked total with the
  // projection and appending a bare "+" for every other currency — three ideas
  // in eight characters, none of them the one being asked for. It is the one
  // number now: what we are committed to.
  if (allIn) return figure(allIn.group, allIn.currency, allIn.approximate);
  // No single figure to be had. The exact subtotals, joined — long, but every
  // character of it is true.
  return parts.map((p) => money(p.group, p.currency)).join(" · ");
}

/**
 * Trip-Board cost surface — a **full-width collapsible strip** under the trip
 * header. Collapsed it shows what the trip is committed to in one line;
 * expanded, that figure large, the target it is read against, and the exact
 * per-currency sums it was made from.
 *
 * **Locked money only.** The projection used to share every bar as a hatched
 * second segment, so the larger part of the picture was hypothetical and the
 * part that had actually been decided was the harder of the two to read. The
 * engine still computes it; this stopped drawing it. See `lib/costSummary`.
 *
 * Native `<details>` gives free keyboard and a11y. Functional four states.
 */
export function CostTally({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);

  return (
    <details className="board__cost-strip" open>
      <summary className="board__cost-summary">
        <span className="board__cost-label">💶 Locked in</span>
        {dash.data && dash.data.committed.length > 0 ? (
          <span className="board__cost-peek">{peek(dash.data)}</span>
        ) : null}
      </summary>
      <div className="board__cost-body">
        {dash.isPending ? (
          <p className="board__tally-muted">Counting…</p>
        ) : dash.isError ? (
          <p className="board__tally-muted" role="alert">
            Couldn't load the cost.
          </p>
        ) : (
          <TallyBody d={dash.data} />
        )}
      </div>
    </details>
  );
}

function TallyBody({ d }: { d: TripDashboardView }) {
  const locked = lockedCost(d);
  const verdict = targetVerdict(d, locked);

  // Nothing decided and priced yet. The target still shows if there is one:
  // hiding it until the first price would read as an edit that failed to save.
  if (locked.parts.length === 0) {
    return (
      <>
        <p className="board__tally-muted">
          Lock a priced option to start the tally.
        </p>
        {verdict ? <TargetLine v={verdict} /> : null}
      </>
    );
  }

  return (
    <>
      {d.hasStaleHeadcount ? (
        <p className="board__tally-stale" role="status">
          ⚠ Fixed headcount out of date
        </p>
      ) : null}
      {locked.allIn ? (
        <Headline all={locked.allIn} verdict={verdict} />
      ) : (
        <SplitTotals locked={locked} />
      )}
      {/* What the figure was made of, then where it came from — in that order,
          because "made of what?" is the question an approximate total provokes
          first, and the rates only matter once you accept the sum. */}
      <Breakdown locked={locked} />
      {locked.allIn?.approximate ? (
        <Provenance all={locked.allIn} asOf={d.converted?.asOf ?? ""} />
      ) : null}
      {verdict ? <TargetLine v={verdict} /> : null}
      <p className="board__tally-foot">
        {d.memberCount} member{d.memberCount === 1 ? "" : "s"}
      </p>
    </>
  );
}

/**
 * The figure, and the one chart on this surface.
 *
 * **The bar is drawn only against a target.** Without one there is nothing for
 * a single measure to be a fraction of, and a bar filled to its own total is
 * decoration — it would be the same picture for a trip €300 under and a trip
 * €3,000 over. The number carries it instead, which is what a number is for.
 *
 * With a target the bar is in **per-person** units, because that is what the
 * target is denominated in, and the two have to be measured in the same thing
 * or the mark and the sentence under it will disagree in front of the reader.
 */
function Headline({
  all,
  verdict,
}: {
  all: AllInTotal;
  verdict: ReturnType<typeof targetVerdict>;
}) {
  return (
    <div className="board__tally-head">
      <p className="board__tally-total">
        <strong>{figure(all.group, all.currency, all.approximate)}</strong>
        <span className="board__tally-per">
          {figure(all.perPerson, all.currency, all.approximate)} per person
        </span>
      </p>
      {verdict ? (
        <CostBar spend={verdict.spend} target={verdict.target} />
      ) : null}
    </div>
  );
}

/** Which day's rates produced the figure, and what they could not reach. */
function Provenance({ all, asOf }: { all: AllInTotal; asOf: string }) {
  return (
    <p className="board__tally-rates">
      converted at {rateDay(asOf)}
      {all.missing.length > 0
        ? ` · ${all.missing.join(", ")} not converted`
        : ""}
    </p>
  );
}

/**
 * Several currencies and no rates to cross them with — so no single figure, and
 * the surface says that rather than inventing one (FR-27).
 */
function SplitTotals({ locked }: { locked: LockedCost }) {
  return (
    <div className="board__tally-head">
      <p className="board__tally-total">
        {locked.parts.map((p, i) => (
          <strong key={p.currency}>
            {i > 0 ? <span className="board__tally-plus">+</span> : null}
            {money(p.group, p.currency)}
          </strong>
        ))}
      </p>
      <p className="board__tally-rates">no rate to add these up with</p>
    </div>
  );
}

/**
 * What the figure above was made of: the exact per-currency sums, added up.
 *
 * These are the numbers FR-27 guarantees — never combined, never approximated —
 * and this line is where they live now that the per-currency bars are gone. It
 * answers the one question an approximate total provokes: *made of what?*
 *
 * It stops at the parts and does **not** restate the total with an `=`. The
 * total is the line directly above; printing it twice, a few pixels apart, is
 * how a surface ends up looking like it is giving two answers to one question.
 *
 * Nothing to show for a single currency: a sum of one term is the term.
 */
function Breakdown({ locked }: { locked: LockedCost }) {
  if (locked.parts.length < 2) return null;
  return (
    <p className="board__tally-sum">
      {locked.parts.map((p) => money(p.group, p.currency)).join("  +  ")}
    </p>
  );
}

/**
 * The per-person target, and how the locked spend stands against it.
 *
 * It reads against **locked** money now, not the projection. Comparing a target
 * to what the front-runners *might* cost answered a question about a possible
 * future; a group deciding whether it can afford the next thing is asking about
 * the present.
 */
function TargetLine({
  v,
}: {
  v: NonNullable<ReturnType<typeof targetVerdict>>;
}) {
  const gap = figure(v.gap, v.currency, v.approximate);
  return (
    <p
      className={"board__budget" + (v.over ? " board__budget--over" : "")}
      role="status"
    >
      <span className="board__budget-label">Target</span>
      <strong>{money(v.target, v.currency)}</strong>
      <span className="board__budget-per">/person</span>
      <span className="board__budget-verdict">
        {gap} {v.over ? "over" : "to spare"}
        {/* Never silently compare across currencies. */}
        {v.uncounted.length > 0
          ? ` · ${v.uncounted.join(", ")} not counted`
          : ""}
      </span>
    </p>
  );
}

/**
 * The rates' publication date, in the reader's locale.
 *
 * `asOf` is a **calendar day**, not an instant — the same class of value as a
 * trip's start date, and it has the same trap: read with local getters, "12
 * August" is 11 August across the Americas. Formatted in UTC, which is the zone
 * the day was named in.
 */
function rateDay(asOf: string): string {
  if (!asOf) return "an unknown date";
  return new Date(`${asOf}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
