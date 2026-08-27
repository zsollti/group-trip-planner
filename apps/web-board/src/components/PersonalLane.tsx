import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  DEFAULT_MAX_PERSONAL_ITEMS,
  isHttpUrl,
  type CategoryView,
  type PersonalItemView,
  type TripDateRange,
} from "@gtp/types";
import {
  ApiError,
  useDeletePersonalItem,
  usePersonalItems,
  useReorderPersonalItems,
} from "@gtp/api-client";
import { Menu, type MenuItem } from "./Menu";
import { Dialog } from "./Dialog";
import { PersonalItemForm } from "./PersonalItemForm";
import { CategoryIcon } from "./CategoryIcon";
import { CalendarIcon, GlobeIcon, MoneyIcon, PersonIcon } from "./icons";
import { dateRangeLabel } from "./optionFormat";
import { categoryHueStyle } from "../lib/categoryTheme";
import { formatMoney } from "../lib/money";
import { truncateName } from "../lib/truncate";
import { t } from "../lib/i18n";

/**
 * One private card.
 *
 * Deliberately **not** an `OptionCard` with a flag. That component is built
 * around the machinery a proposal has and this has none of — a vote tally, an
 * "I'm in" control, a padlock, a proposer, a stale-vote mark, a lock action on
 * its menu. Threading a boolean through all of it would have left a card whose
 * every second branch is "except when it is personal", and a reader of either
 * surface would have to hold both in their head. The two share their CSS and
 * their formatters instead, which is where the actual duplication would have
 * been.
 *
 * The money label is the plain amount, with no `/person` or `total` suffix:
 * those exist because an option's price has to be read against a headcount, and
 * this one is simply what its owner pays.
 */
function PersonalItemCard({
  item,
  category,
  canEdit,
  onEdit,
  onDelete,
  onMove,
  moveUp,
  moveDown,
  deleting,
}: {
  item: PersonalItemView;
  /** The lane this item borrows its colour and glyph from, if it is tagged. */
  category: CategoryView | undefined;
  canEdit: boolean;
  onEdit: (item: PersonalItemView) => void;
  onDelete: (item: PersonalItemView) => void;
  onMove: (item: PersonalItemView, delta: -1 | 1) => void;
  moveUp: boolean;
  moveDown: boolean;
  deleting: boolean;
}) {
  const dates = dateRangeLabel(item.startsAt, item.endsAt, "minute");
  const money =
    item.amount == null ? null : formatMoney(item.amount, item.currency);

  const items: MenuItem[] = [];
  if (canEdit) {
    items.push({ label: t("Edit"), onSelect: () => onEdit(item) });
    // Reorder lives on the menu rather than on a drag grip. The board owns a
    // single DndContext, and it is switched on only for organizers on an active
    // trip — while this column is every member's, Guests included. Rather than
    // widen that context (which would change how the shared lanes behave for
    // everyone) or nest a second one inside it, the two moves that a drag would
    // have expressed are stated outright. They also work from a keyboard, which
    // the grip never did.
    if (moveUp) {
      items.push({ label: t("Move up"), onSelect: () => onMove(item, -1) });
    }
    if (moveDown) {
      items.push({ label: t("Move down"), onSelect: () => onMove(item, 1) });
    }
    items.push({
      label: deleting ? t("Deleting…") : t("Delete"),
      onSelect: () => onDelete(item),
      danger: true,
    });
  }

  return (
    <article
      style={category ? categoryHueStyle(category) : undefined}
      className="lane__card lane__card--option lane__card--personal"
    >
      <div className="lane__card-head">
        <strong>
          <span className="lane__field-btn" title={item.title}>
            {truncateName(item.title)}
          </span>
        </strong>
        <div className="lane__card-tools">
          {/* The tag, where a decision's padlock would be: a mark about what
              this card *is*, not part of the text that names it. Shown only
              when the item borrows a lane — an untagged item simply has no
              glyph, rather than a placeholder standing in for one. */}
          {category ? (
            <span
              className="lane__personal-tag"
              role="img"
              aria-label={t("Tagged {lane}", { lane: category.name })}
            >
              <CategoryIcon category={category} size={13} />
            </span>
          ) : null}
          {items.length > 0 ? (
            <Menu
              label={t("Actions for {card}", { card: item.title })}
              items={items}
            />
          ) : null}
        </div>
      </div>
      {dates ? (
        <span className="lane__dates">
          <CalendarIcon /> {dates}
        </span>
      ) : null}
      {money ? (
        <span className="lane__cost">
          <MoneyIcon /> {money}
        </span>
      ) : null}
      {item.description ? (
        <span className="lane__notes">{item.description}</span>
      ) : null}
      {item.url && isHttpUrl(item.url) ? (
        <a
          className="lane__link"
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <GlobeIcon /> {t("Link")}
        </a>
      ) : null}
    </article>
  );
}

/**
 * The board's last column: the things this reader alone is paying for and
 * planning around.
 *
 * A column of its own rather than private cards mixed into the shared lanes.
 * A lane carries ordered, capped state that the whole trip shares, so per-viewer
 * rows inside it make three separate questions ambiguous — whether a private
 * card counts toward a public cap, what happens when an organizer reorders a
 * list containing a card they cannot see, and which of the lane's controls a
 * card without votes is supposed to show. A column answers all three by not
 * asking them.
 *
 * **Always rendered, even empty.** It is the only place the feature announces
 * itself; a column that appeared once you already had an item would be a
 * feature you could only find by already knowing about it.
 *
 * The header says who can see this once, so no card has to repeat it.
 */
export function PersonalLane({
  tripId,
  myUserId,
  categories,
  defaultCurrency,
  frozen = false,
  tripDates = null,
}: {
  tripId: string;
  /**
   * The reader, threaded down from the board exactly as it is to the lanes and
   * the cards. Only ever a **cache key** here — the server answers these routes
   * for whoever the access token names — but it has to be in the key, or a
   * second person signing in on the same browser would render the first one's
   * list out of a cache that is never cleared on logout.
   */
  myUserId: string | undefined;
  /** The trip's lanes, offered as optional tags on the form. */
  categories: readonly CategoryView[];
  defaultCurrency: string;
  frozen?: boolean;
  tripDates?: TripDateRange | null;
}) {
  const viewerId = myUserId ?? "";
  const items = usePersonalItems(tripId, viewerId);
  const remove = useDeletePersonalItem(tripId, viewerId);
  const reorder = useReorderPersonalItems(tripId, viewerId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonalItemView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PersonalItemView | null>(null);

  const list = items.data ?? [];
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const canEdit = !frozen;
  const isFull = list.length >= DEFAULT_MAX_PERSONAL_ITEMS;

  async function onDelete(item: PersonalItemView) {
    setError(null);
    setConfirming(null);
    try {
      await remove.mutateAsync(item.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Could not delete"));
    }
  }

  /**
   * Swap one item with its neighbour and send the whole order.
   *
   * The endpoint takes the complete list, so the move is computed here and the
   * server is told the result rather than the gesture — which is what makes the
   * write idempotent and keeps it gap-free.
   */
  async function onMove(item: PersonalItemView, delta: -1 | 1) {
    setError(null);
    const ids = list.map((i) => i.id);
    const from = ids.indexOf(item.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [next[to]!, next[from]!];
    try {
      await reorder.mutateAsync({ orderedIds: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Could not reorder"));
    }
  }

  return (
    <section
      className="lane lane--personal"
      aria-labelledby={`lane-title-personal-${tripId}`}
    >
      <div className="lane__pin">
        <div className="lane__head">
          <PersonIcon size={16} />
          <h2 className="lane__title" id={`lane-title-personal-${tripId}`}>
            {t("Just for me")}
          </h2>
        </div>
        {/* Where a lane states how it picks a winner, this states who can read
            it — said once, at the top, rather than badged onto every card. The
            column is the claim, so a card inside it needs no second mark.

            Inside the pin, like `.lane__meta` always is: a margin out here
            would sit within the sticky box and hold every card a line further
            down the column forever. */}
        <p className="lane__meta">{t("Only you can see these")}</p>
      </div>

      {items.isPending ? (
        <div className="lane__card lane__card--ghost">{t("Loading…")}</div>
      ) : items.isError ? (
        <p className="board__form-error" role="alert">
          {t("Couldn’t load your own items.")}
        </p>
      ) : list.length === 0 ? (
        canEdit ? (
          <button
            type="button"
            className="lane__card lane__card--ghost lane__card--cta"
            onClick={() => setAdding(true)}
          >
            {t("＋ Add something only you pay for")}
          </button>
        ) : (
          <div className="lane__card lane__card--ghost">
            {t("Nothing of your own here")}
          </div>
        )
      ) : (
        list.map((item, i) => (
          <PersonalItemCard
            key={item.id}
            item={item}
            category={item.categoryId ? byId.get(item.categoryId) : undefined}
            canEdit={canEdit}
            onEdit={setEditing}
            onDelete={setConfirming}
            onMove={onMove}
            moveUp={i > 0}
            moveDown={i < list.length - 1}
            deleting={remove.isPending}
          />
        ))
      )}

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {canEdit && list.length > 0 ? (
        isFull ? (
          /* Named rather than silently withheld, the same way a full lane
             names its cap: a button that simply vanished would read as the
             board losing an action. */
          <p className="lane__full">
            {t("Full at {cap} items. Remove one to add another.", {
              cap: DEFAULT_MAX_PERSONAL_ITEMS,
            })}
          </p>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAdding(true)}
          >
            {t("+ Add card")}
          </Button>
        )
      ) : null}

      {confirming ? (
        <Dialog
          title={t("Delete “{card}”?", { card: confirming.title })}
          describedById={`personal-delete-blurb-${tripId}`}
          onClose={() => setConfirming(null)}
        >
          <p className="board__muted" id={`personal-delete-blurb-${tripId}`}>
            {t("This can’t be undone.")}
          </p>
          <div className="board__dialog-actions">
            <Button
              type="button"
              variant="primary"
              disabled={remove.isPending}
              onClick={() => void onDelete(confirming)}
            >
              {remove.isPending ? t("Deleting…") : t("Delete")}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {adding ? (
        <PersonalItemForm
          tripId={tripId}
          myUserId={myUserId}
          categories={categories}
          currency={defaultCurrency}
          tripDates={tripDates}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <PersonalItemForm
          tripId={tripId}
          myUserId={myUserId}
          categories={categories}
          currency={defaultCurrency}
          tripDates={tripDates}
          item={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
