import {
  categoryOptionFields,
  isHttpUrl,
  type InvitePreview,
  type InvitePreviewLane,
  type InvitePreviewOption,
} from "@gtp/types";
import { Avatar } from "./Avatar";
import { CategoryIcon } from "./CategoryIcon";
import { CalendarIcon, GlobeIcon, LockIcon, MoneyIcon } from "./icons";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { categoryHueStyle } from "../lib/categoryTheme";
import { truncateName } from "../lib/truncate";
import { t, plural } from "../lib/i18n";

/**
 * The board, to somebody who has not signed in yet.
 *
 * **Not the board component with its controls switched off.** `CategoryLane`
 * and `OptionCard` are built on a session: they vote, lock, drag, open dialogs,
 * ask the cache who the reader is. Threading "there is no reader" through all of
 * that would leave every branch of the real board carrying a case that only
 * exists on this page, and one missed branch is a control offered to a stranger.
 * This is a separate, read-only rendering of a separate, read-only payload,
 * which is the same reason `PersonalLane` is not `CategoryLane` with a flag.
 *
 * It wears the board's own classes on purpose. What a visitor is being shown is
 * the thing they are being invited to, and a preview drawn in some other visual
 * language would be a picture of a different app.
 *
 * Nothing here is a button, an input, or a link into the app. The only way
 * forward is the call to action the page puts underneath it.
 */
export function InvitePreviewBoard({ preview }: { preview: InvitePreview }) {
  return (
    <div className="preview__board">
      <Crew preview={preview} />
      {preview.lanes.length === 0 ? (
        <p className="board__muted">{t("Nothing has been proposed yet.")}</p>
      ) : (
        <div className="preview__lanes">
          {preview.lanes.map((lane) => (
            <Lane key={lane.id} lane={lane} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Who is going, by name and face.
 *
 * The half of "what is this trip" that the lanes cannot answer. Names and
 * pictures only: an address would be somebody else's to give out, and a role is
 * about what a member may do on a board this reader cannot act on anyway.
 */
function Crew({ preview }: { preview: InvitePreview }) {
  return (
    <section className="preview__crew" aria-label={t("Who's going")}>
      <h2 className="preview__section-title">
        {plural(preview.memberCount, "{n} person going", "{n} people going")}
      </h2>
      <ul className="preview__faces">
        {preview.members.map((m) => (
          <li key={m.userId} className="preview__face">
            <Avatar
              name={m.displayName}
              userId={m.userId}
              url={m.avatarUrl}
              size={28}
            />
            <span>{truncateName(m.displayName)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One lane and everything proposed in it, in the order the board shows them. */
function Lane({ lane }: { lane: InvitePreviewLane }) {
  return (
    <section
      className="lane"
      style={categoryHueStyle(lane)}
      aria-labelledby={`preview-lane-${lane.id}`}
    >
      <div className="lane__pin">
        <div className="lane__head">
          <CategoryIcon category={lane} className="lane__icon" />
          <h3 className="lane__title" id={`preview-lane-${lane.id}`}>
            {lane.name}
          </h3>
        </div>
      </div>
      {lane.options.length === 0 ? (
        <div className="lane__card lane__card--ghost">
          {t("Nothing here yet")}
        </div>
      ) : (
        lane.options.map((option) => (
          <Card key={option.id} lane={lane} option={option} />
        ))
      )}
    </section>
  );
}

/**
 * One proposal, said and not asked.
 *
 * The card the board draws minus everything that takes an answer: no vote dots,
 * no "I'm in", no menu. The tally survives as a count, because how many people
 * liked an idea is a fact about the idea; who they were is not this reader's to
 * know.
 */
function Card({
  lane,
  option,
}: {
  lane: InvitePreviewLane;
  option: InvitePreviewOption;
}) {
  const dates = dateRangeLabel(
    option.startsAt,
    option.endsAt,
    categoryOptionFields(lane).dateGranularity,
  );
  const cost = costLabel(option);

  return (
    <article
      className={
        "lane__card lane__card--option" +
        (option.locked ? " lane__card--settled" : "")
      }
    >
      <div className="lane__card-head">
        <strong>
          <span className="lane__field-btn" title={option.title}>
            {truncateName(option.title)}
          </span>
        </strong>
        <div className="lane__card-tools">
          {/* Labelled rather than hidden, exactly as on the board: it is the
              one mark here that says something the words do not. */}
          {option.locked ? (
            <span className="lane__lock" role="img" aria-label={t("Decided")}>
              <LockIcon size={13} />
            </span>
          ) : null}
        </div>
      </div>
      {dates ? (
        <span className="lane__dates">
          <CalendarIcon /> {dates}
        </span>
      ) : null}
      {cost ? (
        <span className="lane__cost">
          <MoneyIcon /> {cost}
        </span>
      ) : null}
      {option.description ? (
        <span className="lane__notes">{option.description}</span>
      ) : null}
      {/* A real link, and the only one on the page that leaves it: it is the
          proposal's own reference, which is part of what is being shown. */}
      {option.url && isHttpUrl(option.url) ? (
        <a
          className="lane__link"
          href={option.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <GlobeIcon /> {t("Link")}
        </a>
      ) : null}
      <p className="preview__votes">
        {plural(option.voteCount, "{n} vote", "{n} votes")}
      </p>
    </article>
  );
}
