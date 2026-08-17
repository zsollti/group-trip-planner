import { useTripCategories, useTripDashboard } from "@gtp/api-client";
import type { CategoryView, TripDashboardView } from "@gtp/types";
import { CostBar } from "./CostBar";
import { CostComposition } from "./CostComposition";
import { EmptyCostDonut } from "./CostDonut";
import { costComposition } from "../lib/costComposition";
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
  viewerCost,
  type AllInTotal,
  type LockedCost,
} from "../lib/costSummary";
import { plural, t } from "../lib/i18n";

/** Write a figure the way its certainty deserves. */
function figure(
  amount: number,
  currency: string,
  approximate: boolean,
): string {
  return approximate ? approx(amount, currency) : money(amount, currency);
}

/**
 * The exact per-currency sums, joined — or null when there is only one, since a
 * sum of one term is the term.
 *
 * These are the figures FR-27 guarantees: never combined, never approximated.
 * They used to be a line of their own under the total, and on a single-currency
 * trip that line said nothing while on a mixed one it repeated in longhand what
 * the ≈ figure had just said. It is the ≈ figure's tooltip now, and its
 * screen-reader text, so the guarantee is still reachable by anyone who asks
 * for it and is not in the way of anyone who doesn't.
 */
function exactParts(locked: LockedCost): string | null {
  if (locked.parts.length < 2) return null;
  return locked.parts.map((p) => money(p.group, p.currency)).join("  +  ");
}

/**
 * Trip-Board cost surface — the top of the board's reference rail: where the
 * locked money went, the target it is read against, and who it is divided by.
 *
 * **Locked money only.** The projection used to share every bar as a hatched
 * second segment, so the larger part of the picture was hypothetical and the
 * part that had actually been decided was the harder of the two to read. The
 * engine still computes it; this stopped drawing it. See `lib/costSummary`.
 *
 * **No label, no total, no disclosure.** It was a `<details>` headed "💶 Locked
 * in" with the group total large beneath it. Every part of that was answering a
 * question the chart below already answers better: the composition states the
 * per-person figure in the donut's hole, which is the unit the target is in and
 * the one a reader is deciding against. A group total sitting above it was a
 * second figure in a different unit, and the label was a caption for a panel
 * whose contents say what they are. The strip keeps an `aria-label`, since a
 * region still needs a name even when it does not need a heading.
 *
 * Functional four states: loading, error, nothing-yet, and the tally.
 */
export function CostTally({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);
  // The board has already fetched these, so this costs a cache read rather
  // than a request. The charts need each lane's palette, which the cost lines
  // (being about money) do not carry.
  const categories = useTripCategories(tripId);

  return (
    <section className="board__cost-strip" aria-label={t("Cost")}>
      {dash.isPending ? (
        <p className="board__tally-muted">{t("Counting…")}</p>
      ) : dash.isError ? (
        <p className="board__tally-muted" role="alert">
          {t("Couldn't load the cost.")}
        </p>
      ) : (
        <TallyBody d={dash.data} categories={categories.data ?? []} />
      )}
    </section>
  );
}

function TallyBody({
  d,
  categories,
}: {
  d: TripDashboardView;
  categories: readonly CategoryView[];
}) {
  const locked = lockedCost(d);
  // The target is per person, so it is read against **this reader's** money —
  // the trip's total includes options they may have declined.
  const mine = viewerCost(d);
  const verdict = targetVerdict(d, mine);
  const composition = costComposition(d);
  // True only when the two genuinely differ, i.e. some locked option is priced
  // for part of the group and the split matters to this reader.
  const personal = mine.allIn?.perPerson !== locked.allIn?.perPerson;

  // Nothing decided and priced yet. The ring still draws, empty: the strip's
  // shape should not change the moment the first option is locked, and a grey
  // circle says "nothing decided" in the same language a part-filled one says
  // the rest. The figure in its hole is a real zero in the trip's own currency
  // — the unit the target below is in, so the two can be read together.
  //
  // The target still shows if there is one: hiding it until the first price
  // would read as an edit that failed to save.
  //
  // `nothingLocked` is deliberately wider than "no subtotals". A locked option
  // priced at **zero** produces a subtotal, and a real one — but it is a
  // subtotal of nothing, so the branch below would print "0 USD" as a total and
  // "0 USD per person" beside it, then draw the same zero a third time in the
  // empty ring underneath. Three statements of nothing, in a panel whose one job
  // is to say what the trip costs. The ring alone says it.
  const nothingLocked =
    locked.parts.length === 0 ||
    locked.parts.every((p) => p.group === 0 && p.perPerson === 0);
  if (nothingLocked) {
    return (
      <>
        <div className="cost-comp__chart">
          <EmptyCostDonut
            label={{
              headline: money(0, d.defaultCurrency),
              caption: t("per person"),
            }}
          />
        </div>
        <p className="board__tally-muted">
          {t("Lock a priced option to start the tally.")}
        </p>
        {verdict ? <TargetLine v={verdict} personal={false} /> : null}
      </>
    );
  }

  const exact = exactParts(locked);

  return (
    <>
      {/* One figure on this surface, and the composition states it when it can
          — in the donut's hole, or as the caption over the bar. The fallbacks
          below exist for the two cases it cannot cover: nothing drawable
          (everything priced for part of the group), and several currencies with
          no rate to cross them. Without them a trip in that state would get a
          cost panel with no money on it at all. */}
      {composition ? (
        <CostComposition
          composition={composition}
          categories={categories}
          headline={{
            headline: figure(
              composition.charted,
              composition.currency,
              composition.approximate,
            ),
            // Named "shared" only when something was held back, so the word
            // earns its place by answering the question the aside raises.
            caption:
              composition.excluded.length > 0
                ? t("per person, shared")
                : t("per person"),
            exact,
          }}
        />
      ) : locked.allIn ? (
        <>
          <Headline all={locked.allIn} verdict={verdict} exact={exact} />
          <Uncrossed all={locked.allIn} />
        </>
      ) : (
        <SplitTotals locked={locked} />
      )}
      {verdict ? <TargetLine v={verdict} personal={personal} /> : null}
      <p className="board__tally-foot">
        {plural(d.memberCount, "{n} member", "{n} members")}
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
  exact,
}: {
  all: AllInTotal;
  verdict: ReturnType<typeof targetVerdict>;
  /** The exact per-currency sums behind an approximate figure; see {@link exactParts}. */
  exact: string | null;
}) {
  return (
    <div className="board__tally-head">
      <p className="board__tally-total">
        <strong title={exact ?? undefined}>
          {figure(all.group, all.currency, all.approximate)}
        </strong>
        {exact ? (
          <span className="board__sr-only">
            {" "}
            {t("— exactly {amount}", { amount: exact })}
          </span>
        ) : null}
        <span className="board__tally-per">
          {t("{amount} per person", {
            amount: figure(all.perPerson, all.currency, all.approximate),
          })}
        </span>
      </p>
      {verdict && verdict.spend > 0 ? (
        <CostBar spend={verdict.spend} target={verdict.target} />
      ) : null}
      {/*
       * A target with nothing counted against it yet.
       *
       * The bar above is drawn from `verdict.spend`, which is the locked money
       * **in the trip's own currency** — so a trip whose only locked option is
       * priced in something else (or priced at zero) fills none of it, and an
       * empty track beside a figure of zero reads as a chart that failed rather
       * than one with nothing to say. The ring says the same thing on purpose.
       */}
      {verdict && verdict.spend <= 0 ? (
        <div className="cost-comp__chart">
          <EmptyCostDonut
            label={{
              headline: money(0, verdict.currency),
              caption: t("per person"),
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Currencies no rate reached, so the figure above does not account for them.
 *
 * This used to lead with the rates' publication date — "converted at 14 Aug" —
 * provenance for a figure nobody had asked the provenance of, printed under
 * every approximate total whether or not anything was actually missing. The
 * part worth saying is where the total is *incomplete*, and only then.
 */
function Uncrossed({ all }: { all: AllInTotal }) {
  if (all.missing.length === 0) return null;
  return (
    <p className="board__tally-rates">
      {t("{currencies} not converted", { currencies: all.missing.join(", ") })}
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
      <p className="board__tally-rates">{t("no rate to add these up with")}</p>
    </div>
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
  personal,
}: {
  v: NonNullable<ReturnType<typeof targetVerdict>>;
  /**
   * True when this reader's share differs from the trip's per-person total —
   * i.e. some locked option is priced for part of the group.
   *
   * The verdict is always about the reader; this only decides whether to *say*
   * so. On a trip where everything is shared, "yours" would imply a distinction
   * that does not exist and invite the question of whose figure it isn't.
   */
  personal: boolean;
}) {
  const gap = figure(v.gap, v.currency, v.approximate);
  return (
    <p
      className={"board__budget" + (v.over ? " board__budget--over" : "")}
      role="status"
    >
      <span className="board__budget-label">{t("Target")}</span>
      <strong>{money(v.target, v.currency)}</strong>
      <span className="board__budget-per">{t("/person")}</span>
      <span className="board__budget-verdict">
        {personal ? t("yours: ") : ""}
        {gap} {v.over ? "over" : t("to spare")}
        {/* Never silently compare across currencies. */}
        {v.uncounted.length > 0
          ? ` · ${v.uncounted.join(", ")} not counted`
          : ""}
      </span>
    </p>
  );
}
