import { useState, type ReactNode } from "react";
import { useTripCategories, useTripDashboard } from "@gtp/api-client";
import type { CategoryView, TripDashboardView } from "@gtp/types";
import { CostBar } from "./CostBar";
import { CostComposition } from "./CostComposition";
import { EmptyCostDonut } from "./CostDonut";
import { costComposition, myCostComposition } from "../lib/costComposition";
import { PersonalBudgetDialog } from "./PersonalBudgetDialog";
// The strip's private formatter moved to `lib/money` when the option cards
// needed the same thing. One definition, so a total and the cards it is the sum
// of cannot disagree about how money is written.
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";
import {
  groupTargetVerdict,
  lockedCost,
  personalCost,
  personalTargetVerdict,
  targetVerdict,
  viewerAllIn,
  viewerCost,
  type AllInTotal,
  type CostUnit,
  type LockedCost,
} from "../lib/costSummary";
import { plural, t } from "../lib/i18n";

/**
 * What the figure under a headline is denominated in, said in words.
 *
 * One definition, because the caption appears in four places on this surface
 * (the chart's hole, and three empty-state rings) and a chart captioned "per
 * person" over group money is the exact defect this pass exists to remove.
 */
function unitCaption(unit: CostUnit): string {
  return unit === "group" ? t("for the group") : t("per person");
}

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
    <section
      className="board__cost-strip"
      aria-label={t("Cost")}
      // The guided tour points here. An attribute of its own rather than the
      // class beside it: a class is a styling decision and gets renamed, and the
      // label is translated, so neither can be a stable selector. See `lib/tour`.
      data-tour="cost"
    >
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
  /*
   * Which of the two readings is on screen.
   *
   * **Two positions, not three.** "The trip", "mine" and "both added together"
   * looks like the obvious set and the third one is not a figure anybody should
   * be given: adding a member's private spend to the group's committed total
   * produces a number that claims the trip agreed to buy someone's flight. The
   * reader's own all-in already *is* the sum that means something, and it is
   * what "Mine" shows.
   *
   * **Always offered.** It used to appear only once the reader had things of
   * their own, on the grounds that "Mine" would otherwise differ from "The
   * trip" only by the opt-in options they had declined — which the target line
   * under the trip's chart said in words anyway.
   *
   * That was true while both readings were per person. It is not any more: the
   * trip's chart is group money and its target line speaks for the group, so
   * without this switch a member with no private list would have nowhere at all
   * to read what *they* owe. The two readings answer different questions now,
   * which is precisely what makes the control worth its space.
   */
  const [view, setView] = useState<CostView>("trip");

  const locked = lockedCost(d);

  if (view === "mine") {
    return (
      <MineBody
        d={d}
        categories={categories}
        // The reader's own reading keeps the per-person verdict, read against
        // **their** money: the trip's total includes options they may have
        // declined, and warning them about those is the bug that made this
        // verdict per-viewer in the first place.
        verdict={targetVerdict(d, viewerCost(d))}
        view={view}
      >
        <CostViewToggle view={view} onChange={setView} />
      </MineBody>
    );
  }

  // The trip's reading is group money throughout — the chart, the headline and
  // the sentence under them. See `groupTargetVerdict`.
  const verdict = groupTargetVerdict(d);
  const composition = costComposition(d);

  // Nothing decided and priced yet. The ring still draws, empty: the strip's
  // shape should not change the moment the first option is locked, and a grey
  // circle says "nothing decided" in the same language a part-filled one says
  // the rest. It says it *alone* — the line of instruction that used to sit
  // under it ("Lock a priced option to start the tally") was explaining an
  // empty ring to someone looking at an empty ring, on a panel whose one job is
  // to state a figure. The figure in its hole is a real zero in the trip's own currency
  // — the unit the target below is in, so the two can be read together.
  //
  // The target still shows if there is one: hiding it until the first price
  // would read as an edit that failed to save.
  //
  // `nothingLocked` is deliberately wider than "no subtotals". A locked option
  // priced at **zero** produces a subtotal, and a real one — but it is a
  // subtotal of nothing, so the branch below would print "0 USD" as a total and
  // "0 USD for the group" beside it, then draw the same zero a third time in the
  // empty ring underneath. Three statements of nothing, in a panel whose one job
  // is to say what the trip costs. The ring alone says it.
  const nothingLocked =
    locked.parts.length === 0 ||
    locked.parts.every((p) => p.group === 0 && p.perPerson === 0);
  if (nothingLocked) {
    return (
      <>
        <CostViewToggle view={view} onChange={setView} />
        <div className="cost-comp__chart">
          <EmptyCostDonut
            label={{
              headline: money(0, d.defaultCurrency),
              caption: unitCaption("group"),
            }}
          />
        </div>
        {verdict ? <TargetLine v={verdict} /> : null}
      </>
    );
  }

  const exact = exactParts(locked);

  return (
    <>
      <CostViewToggle view={view} onChange={setView} />
      {/* One figure on this surface, and the composition states it when it can
          — in the donut's hole, or as the caption over the bar. The fallback
          below exists for the one case it cannot cover: several currencies with
          no rate to cross them. Without it a trip in that state would get a
          cost panel with no money on it at all.
          ("Nothing drawable because everything is priced for part of the group"
          was a second such case, and stopped being one when this chart moved
          into group money — there is no option it cannot hold now.) */}
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
            // The unit comes off the composition, so the words under the figure
            // and the money in it cannot disagree. This one is always the
            // group's; `MineBody` draws the other.
            caption: unitCaption(composition.unit),
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
      {/* The shortfall belongs to the composition's own list when there is one;
          this line states it only when nothing above it can. */}
      {verdict ? <TargetLine v={verdict} gap={!composition} /> : null}
      <p className="board__tally-foot">
        {plural(d.memberCount, "{n} member", "{n} members")}
      </p>
    </>
  );
}

/** Whose money the strip is describing. */
type CostView = "trip" | "mine";

/**
 * The switch between the two readings.
 *
 * Wears `ViewToggle`'s clothes deliberately — this is the same kind of control
 * doing the same kind of job, and a second segmented control drawn differently
 * would read as a different mechanism. Buttons rather than links, because
 * unlike Plan/Timeline there is nothing here worth a URL: which reading of a
 * cost panel you last had open is not a place, and sending someone a link to
 * "my private total" would be a link that shows them their own.
 *
 * `aria-pressed` is the state a screen reader gets, and the sliding thumb is
 * driven off `data-view` — one source of truth, decoration over it, exactly as
 * on the view toggle.
 */
function CostViewToggle({
  view,
  onChange,
}: {
  view: CostView;
  onChange: (next: CostView) => void;
}) {
  return (
    <div
      className="viewtoggle viewtoggle--cost"
      data-view={view}
      role="group"
      aria-label={t("Whose money")}
    >
      <span className="viewtoggle__thumb" aria-hidden="true" />
      <button
        type="button"
        className="viewtoggle__option"
        aria-pressed={view === "trip"}
        onClick={() => onChange("trip")}
      >
        {t("The trip")}
      </button>
      <button
        type="button"
        className="viewtoggle__option"
        aria-pressed={view === "mine"}
        onClick={() => onChange("mine")}
      >
        {t("Mine")}
      </button>
    </div>
  );
}

/**
 * The strip read for one person: their share of the group's decisions plus the
 * things only they are paying for.
 *
 * A body of its own rather than branches through the trip's, so each reading is
 * provably about one kind of money. The member count is gone: it is the divisor
 * for the trip's per-person figures and has nothing to divide here.
 *
 * ## Which target this reading is measured against
 *
 * Two cases, and the difference between them is the whole of this slice.
 *
 * **With a budget of their own**, the ring is drawn against it and the sentence
 * beneath reads their all-in — their share of the group's decisions *plus*
 * their private things — because that is exactly what a personal limit is a
 * limit on. This is the only verdict on the surface private money belongs in.
 *
 * **Without one**, nothing changes from before it was possible to set one: no
 * ring, the group's per-person target stated below, read against
 * `viewerCommitted` alone, and the reader's own spending named separately as
 * money that verdict does not cover. The owner's rule holds either way —
 * private money is never read against the *trip's* target — and the budget is
 * what turns the ring on rather than something that bends the rule.
 */
function MineBody({
  d,
  categories,
  verdict,
  children,
}: {
  d: TripDashboardView;
  categories: readonly CategoryView[];
  /**
   * The group's per-person verdict — the fallback, used only when this reader
   * has set no budget of their own.
   */
  verdict: ReturnType<typeof targetVerdict>;
  view: CostView;
  /** The switch, passed in so this body does not own the state it reads. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const own = personalCost(d);
  const composition = myCostComposition(d, t("Personal"));
  const allIn = viewerAllIn(d);
  // Their own limit wins where they have one. The two are never shown together:
  // a panel stating two targets for one figure is asking the reader to work out
  // which of them they are being judged by.
  const mine = personalTargetVerdict(d);

  return (
    <>
      {children}
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
            caption: t("yours, all in"),
            exact: null,
          }}
        />
      ) : allIn ? (
        <Headline all={allIn} verdict={null} exact={null} />
      ) : (
        <div className="cost-comp__chart">
          <EmptyCostDonut
            label={{
              headline: money(0, d.defaultCurrency),
              caption: t("yours, all in"),
            }}
          />
        </div>
      )}
      {/*
       * Same rule as the trip's reading, with one wrinkle worth stating: the
       * chart on this surface is drawn against **their own budget** and nothing
       * else (see `myCostComposition`). So it has a remainder row to carry the
       * shortfall only when they have one of those — and when the line below is
       * falling back to the group's per-person target, there is no such row and
       * this is the only thing on the panel that can say how far there is to go.
       */}
      {mine ? (
        <TargetLine v={mine} gap={!composition} />
      ) : verdict ? (
        <TargetLine v={verdict} gap />
      ) : null}
      {/*
       * Said out loud whenever the verdict above is the **group's**.
       *
       * That target is the group's budget for the group's plan, and a member's
       * own flight is not something the trip agreed to — so it is not counted,
       * and a reader looking at one figure sitting above another needs to be
       * told which of them the verdict was about. Leaving it implicit is how
       * someone concludes they are over budget when they are not.
       *
       * Dropped once they have a budget of their own, because then the sentence
       * would be false: their own things *are* counted against that one, which
       * is the point of it.
       */}
      {mine === null && own.allIn ? (
        <p className="board__tally-foot">
          {t("Personal: {amount}. Not counted against the target.", {
            amount: figure(
              own.allIn.group,
              own.allIn.currency,
              own.allIn.approximate,
            ),
          })}
        </p>
      ) : null}
      {/*
       * The way in to a budget of their own.
       *
       * A quiet link rather than a button: it is the least important thing on
       * the panel and competes with nothing. Its label says which of the two
       * budgets it is, because the trip's is one tap away on the same surface.
       */}
      <p className="board__tally-foot">
        <button
          type="button"
          className="board__link-btn"
          onClick={() => setEditing(true)}
        >
          {d.viewerBudget === null
            ? t("Set your own budget")
            : t("Change your budget")}
        </button>
      </p>
      {editing ? (
        <PersonalBudgetDialog
          tripId={d.tripId}
          currency={d.defaultCurrency}
          current={d.viewerBudget}
          onClose={() => setEditing(false)}
        />
      ) : null}
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
 * With a target the bar is drawn in **the verdict's own unit**, because that is
 * what its target is denominated in, and the two have to be measured in the
 * same thing or the mark and the sentence under it will disagree in front of
 * the reader.
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
              caption: unitCaption(verdict.unit),
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
 * The target, and how the locked spend stands against it.
 *
 * It reads against **locked** money now, not the projection. Comparing a target
 * to what the front-runners *might* cost answered a question about a possible
 * future; a group deciding whether it can afford the next thing is asking about
 * the present.
 *
 * **The unit comes from the verdict**, and with it the whole sentence. Under
 * the trip's chart this is group money against the group's budget; under the
 * reader's own it is their money against a per-person figure. The line used to
 * be the per-person one in both places, which is how a chart and the sentence
 * beneath it came to be measuring different things.
 */
function TargetLine({
  v,
  gap = false,
}: {
  v: NonNullable<ReturnType<typeof targetVerdict>>;
  /**
   * Whether this line is the one that states the shortfall.
   *
   * Off wherever a composition is drawn above it, because its list already has
   * a row for exactly this: "Still to spend · 12% · 320 EUR", or "Over budget"
   * in the same place. The line used to repeat that figure two lines further
   * down, under a target the row is a share of — the same number twice, once
   * with a percentage and once without, and a reader is entitled to assume two
   * figures on one panel are answering two questions.
   *
   * On where there is no such row to carry it: several currencies with no rate
   * to cross them leaves a headline and a bar rather than a ring, and a bar has
   * no legend.
   */
  gap?: boolean;
}) {
  return (
    <p
      className={"board__budget" + (v.over ? " board__budget--over" : "")}
      role="status"
    >
      <span className="board__budget-label">{t("Target")}</span>
      <strong>{money(v.target, v.currency)}</strong>
      {/* The group's target is a figure nobody typed — the organizer authored
          the per-person one it was scaled from. Naming that basis is what keeps
          it from reading as a number the app invented. */}
      <span className="board__budget-per">
        {v.basis === null
          ? t("/person")
          : t("({amount} /person)", {
              amount: money(v.basis, v.currency),
            })}
      </span>
      {gap ? (
        <span className="board__budget-verdict">
          {/* Both halves were bare English literals, and the pair is worth a
              note: the i18n test reads the source tree for `t()` calls, so a
              string that never asks to be translated is the one kind it cannot
              see. On a Hungarian board the verdict read "1 200 Ft over" beside
              a fully translated label. */}
          {figure(v.gap, v.currency, v.approximate)}{" "}
          {v.over ? t("over") : t("to spare")}
        </span>
      ) : null}
      {/* Never silently compare across currencies, whichever surface states the
          shortfall — this one is about the target itself, so it stays. */}
      {v.uncounted.length > 0 ? (
        <span className="board__budget-verdict">
          {t("{currencies} not counted", {
            currencies: v.uncounted.join(", "),
          })}
        </span>
      ) : null}
    </p>
  );
}
