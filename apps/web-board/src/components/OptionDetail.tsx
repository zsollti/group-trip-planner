import { Button } from "@gtp/ui-primitives";
import type { CategoryView, OptionView } from "@gtp/types";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { Dialog } from "./Dialog";

/**
 * A read-only "full card" view (Phase 3.5 feedback). Locked cards in the Decided
 * column — and any card a viewer can't edit — collapse their notes to two lines
 * on the board, so there was no way to read an option in full once it was decided.
 * This dialog shows every field un-clamped: which category it belongs to, the
 * decision state, dates, cost, the complete notes, the link, the proposer, and the
 * public vote tally. Purely presentational; all mutating actions still live on the
 * card's "⋯" menu. Dismisses on the close button or Escape — never on a backdrop
 * click, which is the board-wide rule (see {@link Dialog}).
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
  const dates = dateRangeLabel(option.startsAt, option.endsAt);
  const cost = costLabel(option);
  const locked = option.status === "LOCKED";

  return (
    <Dialog
      eyebrow={
        <span className="lane__tag lane__tag--badge">{category.name}</span>
      }
      title={option.title}
      onClose={onClose}
    >
      <>
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
          <Button type="button" variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    </Dialog>
  );
}
