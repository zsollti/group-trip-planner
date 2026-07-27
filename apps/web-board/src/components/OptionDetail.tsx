import { useEffect } from "react";
import { Button } from "@gtp/ui-primitives";
import type { CategoryView, OptionView } from "@gtp/types";
import { costLabel, dateRangeLabel } from "./optionFormat";

/**
 * A read-only "full card" view (Phase 3.5 feedback). Locked cards in the Decided
 * column — and any card a viewer can't edit — collapse their notes to two lines
 * on the board, so there was no way to read an option in full once it was decided.
 * This dialog shows every field un-clamped: which category it belongs to, the
 * decision state, dates, cost, the complete notes, the link, the proposer, and the
 * public vote tally. Purely presentational; all mutating actions still live on the
 * card's "⋯" menu. Dismisses on the close button, a backdrop click, or Escape.
 */
export function OptionDetail({
  category,
  option,
  onClose,
}: {
  category: CategoryView;
  option: OptionView;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dates = dateRangeLabel(option.startsAt, option.endsAt);
  const cost = costLabel(option);
  const locked = option.status === "LOCKED";

  // No backdrop-click dismiss: every dialog on the board closes by Esc or an
  // explicit control only, so a stray click never discards what you were looking
  // at (or, in the form dialogs, what you were typing).
  return (
    <div className="board__backdrop" role="presentation">
      <article
        className="board__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${option.title} — details`}
      >
        <p className="board__eyebrow lane__tag lane__tag--badge">
          {category.name}
        </p>
        <h2 className="board__title">{option.title}</h2>

        {locked ? (
          <p className="lane__decided">
            ✦ Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
          </p>
        ) : null}

        <dl className="board__detail">
          {dates ? (
            <>
              <dt>Dates</dt>
              <dd>🗓 {dates}</dd>
            </>
          ) : null}
          {cost ? (
            <>
              <dt>Cost</dt>
              <dd>{cost}</dd>
            </>
          ) : null}
          {option.description ? (
            <>
              <dt>Notes</dt>
              <dd className="board__detail-notes">{option.description}</dd>
            </>
          ) : null}
          {option.url ? (
            <>
              <dt>Link</dt>
              <dd>
                <a
                  className="lane__link"
                  href={option.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {option.url}
                </a>
              </dd>
            </>
          ) : null}
          <dt>Proposed by</dt>
          <dd>
            {option.proposerName}
            {option.materialChangedAt ? " · edited" : ""}
          </dd>
          <dt>Votes</dt>
          <dd>
            {option.voteCount}
            {option.voters.length > 0
              ? ` · ${option.voters.map((v) => v.displayName).join(", ")}`
              : ""}
          </dd>
        </dl>

        <div className="board__dialog-actions">
          <Button type="button" variant="primary" autoFocus onClick={onClose}>
            Close
          </Button>
        </div>
      </article>
    </div>
  );
}
