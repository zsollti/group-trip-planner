import {
  categoryOptionFields,
  isHttpUrl,
  showsOutsideDatesHint,
  type CategoryView,
  type OptionView,
  type TripDateRange,
} from "@gtp/types";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { Dialog } from "./Dialog";
import { CategoryIcon } from "./CategoryIcon";
import { Avatar } from "./Avatar";
import { categoryHueStyle } from "../lib/categoryTheme";
import { t } from "../lib/i18n";

/**
 * A read-only "full card" view (Phase 3.5 feedback). A card on the board clamps
 * its notes to a single line and no longer names its proposer, so there was no
 * way to read an option in full without being able to edit it.
 * This dialog shows every field un-clamped: which category it belongs to, the
 * decision state, dates, cost, the complete notes, the link, the proposer, and the
 * public vote tally. Purely presentational; all mutating actions still live on the
 * card's "⋯" menu. Dismisses on the close button or Escape — never on a backdrop
 * click, which is the board-wide rule (see {@link Dialog}).
 */
export function OptionDetail({
  category,
  option,
  tripDates = null,
  onClose,
}: {
  category: CategoryView;
  option: OptionView;
  /** The trip's settled range, for the "outside the trip's dates" note. */
  tripDates?: TripDateRange | null;
  onClose: () => void;
}) {
  const dates = dateRangeLabel(
    option.startsAt,
    option.endsAt,
    categoryOptionFields(category).dateGranularity,
  );
  const cost = costLabel(option);
  const elsewhere = showsOutsideDatesHint(option, tripDates, category);
  const locked = option.status === "LOCKED";

  return (
    <Dialog
      eyebrow={
        <span
          className="lane__tag lane__tag--badge"
          style={categoryHueStyle(category)}
        >
          <CategoryIcon category={category} size={13} />
          {category.name}
        </span>
      }
      title={option.title}
      onClose={onClose}
    >
      <>
        {locked ? (
          <p className="lane__decided">
            <span aria-hidden="true">✦ </span>
            {option.lockedByName
              ? t("Decided · {name}", { name: option.lockedByName })
              : t("Decided")}
          </p>
        ) : null}

        <dl className="board__detail">
          {dates ? (
            <>
              <dt>{t("Dates")}</dt>
              <dd>
                🗓 {dates}
                {/* The one surface with room to say why, rather than just
                    flagging it. Advisory — nothing here was rejected. */}
                {elsewhere ? (
                  <em className="board__detail-note">
                    {" "}
                    {t("· outside the trip’s dates")}
                  </em>
                ) : null}
              </dd>
            </>
          ) : null}
          {cost ? (
            <>
              <dt>{t("Cost")}</dt>
              <dd>{cost}</dd>
            </>
          ) : null}
          {option.description ? (
            <>
              <dt>{t("Notes")}</dt>
              <dd className="board__detail-notes">{option.description}</dd>
            </>
          ) : null}
          {option.url ? (
            <>
              <dt>{t("Link")}</dt>
              <dd>
                {/* Rows stored before the scheme was constrained at the
                    boundary can still hold a non-http(s) URL, so the render
                    side decides what may become an href. Anything else is
                    shown as text — visible, but not clickable (Phase 7.2). */}
                {isHttpUrl(option.url) ? (
                  <a
                    className="lane__link"
                    href={option.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {option.url}
                  </a>
                ) : (
                  option.url
                )}
              </dd>
            </>
          ) : null}
          <dt>{t("Proposed by")}</dt>
          <dd>
            {option.proposerName}
            {option.materialChangedAt ? " · edited" : ""}
          </dd>
          <dt>{t("Votes")}</dt>
          <dd>
            {option.voters.length === 0 ? (
              option.voteCount
            ) : (
              /* Faces here too, and the full name beside each. This dialog is
                 the surface that shows everything whole — it is where a
                 truncated card sends you — so the voters are a list, not a
                 comma-joined line that wraps into a paragraph on a long trip. */
              <ul className="voters voters--inline">
                {option.voters.map((v) => (
                  <li key={v.userId} className="voters__item">
                    <Avatar
                      name={v.displayName}
                      userId={v.userId}
                      url={v.avatarUrl}
                      size={24}
                    />
                    <span className="voters__name">{v.displayName}</span>
                    {v.stale ? (
                      <span className="voters__stale">
                        {t("voted before the last change")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </>
    </Dialog>
  );
}
