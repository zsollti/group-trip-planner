import type { ReactNode } from "react";
import {
  categoryOptionFields,
  isHttpUrl,
  showsOutsideDatesHint,
  type CategoryView,
  type OptionParticipantView,
  type OptionView,
  type TripDateRange,
} from "@gtp/types";
import { costLabel, dateRangeLabel, linkLabel } from "./optionFormat";
import { Dialog } from "./Dialog";
import { CategoryIcon } from "./CategoryIcon";
import { Avatar } from "./Avatar";
import { CalendarIcon, LinkIcon, MoneyIcon, PeopleIcon } from "./icons";
import { categoryHueStyle } from "../lib/categoryTheme";
import { plural, t } from "../lib/i18n";

/**
 * A read-only "full card" view (Phase 3.5 feedback). A card on the board clamps
 * its notes to a single line and no longer names its proposer, so there was no
 * way to read an option in full without being able to edit it.
 *
 * **Rebuilt, because it read as the row behind the card rather than as the
 * card.** It was a `<dl>` — six label/value pairs down a white dialog, every
 * one of them the same size, the same weight and the same distance apart, with
 * the URL printed whole across four lines and the votes at the bottom under the
 * word "Votes". Everything the board knew was there and nothing was arranged:
 * no answer was more important than any other, the lane's own colour stopped at
 * the chip above the title, and the two facts a reader actually opens this for
 * — when, and how much — were the third and fourth lines of a list they had to
 * read in order to find.
 *
 * What replaces it is the same information in three tiers:
 *
 *  - **the state**, in a band tinted with the lane's own colour, because
 *    "decided" or "still being voted on" is what changes how everything below
 *    it should be read;
 *  - **the two facts**, as a pair of tiles — a glyph, a quiet label, the answer
 *    in the largest type on the card — so they are read rather than found;
 *  - **the rest**, in blocks, with the people drawn as people: who proposed it,
 *    who voted for it, and who is in.
 *
 * Still purely presentational; every mutating action stays on the card's "⋯"
 * menu. Dismisses on the close button or Escape — never on a backdrop click,
 * which is the board-wide rule (see {@link Dialog}).
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
  const fields = categoryOptionFields(category);
  const dates = dateRangeLabel(
    option.startsAt,
    option.endsAt,
    fields.dateGranularity,
  );
  const cost = costLabel(option);
  const elsewhere = showsOutsideDatesHint(option, tripDates, category);
  const locked = option.status === "LOCKED";
  const optIn = option.participationMode === "OPT_IN";
  const notes = option.description?.trim();

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
      {/*
       * The hue is set here rather than on the dialog, so the panel is tinted
       * and the frame around it stays the board's own paper. `--cat-*` is
       * declared per element and never at `:root` — see the palette block in
       * `index.css`; a surface that sets the hue without appearing on that list
       * resolves every colour to nothing and paints white.
       */}
      <div className="odetail" style={categoryHueStyle(category)}>
        {/* First, because it decides how to read everything under it. */}
        <p
          className={
            "odetail__state" +
            (locked ? " odetail__state--decided" : " odetail__state--open")
          }
        >
          <span aria-hidden="true">{locked ? "✦ " : "○ "}</span>
          {locked
            ? option.lockedByName
              ? t("Decided · {name}", { name: option.lockedByName })
              : t("Decided")
            : t("Still being decided")}
        </p>

        {/* The two questions this panel is opened for. Answered in the largest
            type on the card, side by side, rather than as the third and fourth
            rows of a list of six. A tile with no answer says so — an option
            with no price and an option nobody has priced yet look identical to
            a reader, and the difference is worth a line. */}
        <ul className="odetail__facts">
          <Fact
            icon={<CalendarIcon size={16} />}
            label={t("When")}
            value={dates}
            empty={t("No dates yet")}
            /* Advisory — nothing here was rejected. This is the one surface
               with room to say why rather than only flagging it. */
            note={elsewhere ? t("outside the trip’s dates") : null}
            warn={elsewhere}
          />
          {fields.cost ? (
            <Fact
              icon={<MoneyIcon size={16} />}
              label={t("Cost")}
              value={cost}
              empty={t("No price yet")}
              note={
                optIn
                  ? t("split between whoever’s in")
                  : plural(
                      option.effectiveHeadcount,
                      "for {n} person on the trip",
                      "for {n} people on the trip",
                    )
              }
            />
          ) : null}
        </ul>

        {notes ? (
          <section className="odetail__block">
            <h3 className="board__eyebrow">{t("Notes")}</h3>
            {/* Set apart rather than rendered as one more `<dd>`: this is the
                one field on the card written by a person in sentences, and it
                was previously indistinguishable from the machine-readable ones
                beside it. */}
            <p className="odetail__notes">{notes}</p>
          </section>
        ) : null}

        {option.url ? (
          <section className="odetail__block">
            <h3 className="board__eyebrow">{t("Link")}</h3>
            {/* Rows stored before the scheme was constrained at the boundary
                can still hold a non-http(s) URL, so the render side decides
                what may become an href. Anything else is shown as text —
                visible, and in full, because a reader looking at a link the app
                refused to make clickable is owed exactly what was stored
                (Phase 7.2). */}
            {isHttpUrl(option.url) ? (
              <a
                className="odetail__link"
                href={option.url}
                title={option.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <LinkIcon size={14} />
                {linkLabel(option.url)}
              </a>
            ) : (
              <p className="odetail__link odetail__link--inert">{option.url}</p>
            )}
          </section>
        ) : null}

        <section className="odetail__block">
          <h3 className="board__eyebrow">{t("Proposed by")}</h3>
          <ul className="voters">
            <li className="voters__item">
              <Avatar
                name={option.proposerName}
                userId={option.proposerId}
                url={null}
                size={26}
              />
              <span className="voters__name">{option.proposerName}</span>
              {option.materialChangedAt ? (
                <span className="voters__stale">{t("edited since")}</span>
              ) : null}
            </li>
          </ul>
        </section>

        <People
          heading={t("Votes")}
          count={option.voteCount}
          empty={t("Nobody has voted for this yet.")}
          people={option.voters.map((v) => ({
            userId: v.userId,
            displayName: v.displayName,
            avatarUrl: v.avatarUrl,
            note: v.stale ? t("voted before the last change") : null,
          }))}
        />

        {/* Only where being in is a question. A whole-group option has every
            member in it by definition, and listing the whole trip against it
            would be a paragraph that says nothing. */}
        {optIn ? (
          <People
            heading={t("Who’s in")}
            count={option.participants.length}
            empty={t("Nobody is in yet.")}
            people={option.participants.map((p: OptionParticipantView) => ({
              userId: p.userId,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
              note: null,
            }))}
          />
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * One of the two headline answers.
 *
 * The empty state is a real state and not an omission: a tile reading "No price
 * yet" tells a reader the question is still open, where a missing row tells
 * them nothing at all — and the previous panel simply dropped the line, so an
 * option nobody had priced looked exactly like an option that is free.
 */
function Fact({
  icon,
  label,
  value,
  empty,
  note,
  warn,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  /** What stands in for the answer when there isn't one. */
  empty: string;
  note?: string | null;
  warn?: boolean;
}) {
  return (
    <li className={"odetail__fact" + (value ? "" : " odetail__fact--empty")}>
      <span className="odetail__fact-head">
        {icon}
        {label}
      </span>
      <strong className="odetail__fact-value">{value ?? empty}</strong>
      {note ? (
        <span
          className={
            "odetail__fact-note" + (warn ? " odetail__fact-note--warn" : "")
          }
        >
          {note}
        </span>
      ) : null}
    </li>
  );
}

/**
 * A group of people, with the count in the heading rather than in a sentence.
 *
 * Faces and full names, which is what this panel is *for*: it is where a
 * truncated card sends you, so the voters are a list rather than a comma-joined
 * line that wraps into a paragraph on a long trip.
 */
function People({
  heading,
  count,
  empty,
  people,
}: {
  heading: string;
  count: number;
  empty: string;
  people: readonly {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    note: string | null;
  }[];
}) {
  return (
    <section className="odetail__block">
      <h3 className="board__eyebrow">
        <PeopleIcon size={13} />
        {heading}
        <span className="odetail__tally">{count}</span>
      </h3>
      {people.length === 0 ? (
        <p className="board__muted odetail__none">{empty}</p>
      ) : (
        <ul className="voters">
          {people.map((person) => (
            <li key={person.userId} className="voters__item">
              <Avatar
                name={person.displayName}
                userId={person.userId}
                url={person.avatarUrl}
                size={26}
              />
              <span className="voters__name">{person.displayName}</span>
              {person.note ? (
                <span className="voters__stale">{person.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
