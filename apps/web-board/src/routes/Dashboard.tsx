import { useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useHomeDashboard, useReorderTrips } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { CreateBoardDialog } from "../components/CreateBoardDialog";
import { UserMenu } from "../components/UserMenu";
import { plural, t, tNode } from "../lib/i18n";
import { roleLabel } from "../lib/roles";

/** Format a raw amount as its currency, tolerating unknown codes (FR-27). */
function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

/** A trip's committed cost as a compact per-currency string. */
function costLabel(cost: HomeTripSummary["cost"]): string {
  if (cost.length === 0) return t("No committed cost");
  return cost.map((c) => money(c.committed, c.currency)).join(" · ");
}

/**
 * One trip-board tile, draggable into the order this member wants.
 *
 * The grip is a button rather than the tile itself, for the same reason the
 * option cards use one: the tile is a **link**, and a link that is also a drag
 * handle either swallows the click that opens it or opens a trip every time
 * someone tries to move it. It also gives the keyboard a real way in — dnd-kit
 * drives a sortable list from the handle's own key events, so the arrangement
 * is not a mouse-only feature.
 */
function SortableBoardTile({ trip }: { trip: HomeTripSummary }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: trip.id });
  return (
    <div
      ref={setNodeRef}
      className="board__tile-wrap"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
      }}
    >
      <button
        type="button"
        className="board__tile-grip"
        aria-label={t("Reorder {trip}", { trip: trip.name })}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <BoardTile trip={trip} />
    </div>
  );
}

/** One trip-board tile in the overview (Phase 3.4) — with cost + pending. */
function BoardTile({ trip }: { trip: HomeTripSummary }) {
  return (
    <Link className="board__tile" to={`/trips/${trip.id}`}>
      <span className="board__tile-badge">{roleLabel(trip.role)}</span>
      <span className="board__tile-name">{trip.name}</span>
      <span className="board__tile-meta">
        {trip.destination ?? t("No destination yet")}
      </span>
      {/* Both forms are whole phrases rather than a stem plus an "s": Hungarian
          takes no plural after a numeral (`2 tag`, not `2 tagok`), so its
          "plural" wording is the singular one. `plural` picks per language. */}
      <span className="board__tile-meta">
        {plural(trip.memberCount, "{n} member", "{n} members")}
      </span>
      <span className="board__tile-cost">{costLabel(trip.cost)}</span>
      {trip.pendingDecisionCount > 0 ? (
        <span className="board__tile-pending">
          {plural(
            trip.pendingDecisionCount,
            "{n} decision pending",
            "{n} decisions pending",
          )}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * What a brand-new user sees instead of a wall of tiles (Phase 6.4).
 *
 * A short explanation of what a board *is* and one obvious next action — no
 * guided tour and no seeded demo trip, both of which leave a new account with
 * something to clean up before it feels like theirs.
 *
 * The verified/unverified split matters: creating a trip is gated on a verified
 * email (FR-7, `VerifiedEmailGuard`), but signing in is not. So an account that
 * has registered and not yet clicked the emailed link lands right here — and
 * before 6.4 it got the full-strength "Create your first trip" CTA, filled in
 * the form, and ate a 403 from the server. An unverified visitor now gets the
 * step that actually unblocks them, plus the honest news that the rest of the
 * app already works for them: joining an invite, proposing, voting and chatting
 * all deliberately skip the verified-email gate.
 */
function Onboarding({
  verified,
  email,
  onCreate,
}: {
  verified: boolean;
  email?: string;
  onCreate: () => void;
}) {
  return (
    <section className="board__onboard" aria-labelledby="onboard-heading">
      <h2 className="board__onboard-title" id="onboard-heading">
        {verified ? t("Let's plan something") : t("Almost there")}
      </h2>
      <p className="board__onboard-lead">
        {t(
          "No boards yet — so here's the idea. A board is one place for one trip, with a lane for each thing you have to agree on: when to go, how to get there, where to sleep, what to do. Anyone can add an option to a lane, everyone votes, and when the group has made its mind up an organiser locks the winner in. It stays at the top of its lane, the cost adds itself up as you go, and nobody has to scroll back through a group chat to remember what was decided.",
        )}
      </p>

      {verified ? (
        <>
          <button type="button" className="board__cta" onClick={onCreate}>
            {t("Plan your first trip")}
          </button>
          <p className="board__onboard-note">
            {t(
              "Takes about a minute. You'll be the owner, and you can bring everyone else in with a single link — no accounts to set up for them, no app to install.",
            )}
          </p>
        </>
      ) : (
        <div className="board__onboard-gate">
          <p className="board__onboard-note">
            {tNode(
              "One thing first: starting a board needs a confirmed email address. We've sent a link to {email} — open it and you're set. (Check the spam folder if it's taking its time.)",
              {
                email: <strong>{email ?? t("your address")}</strong>,
              },
            )}
          </p>
          <p className="board__onboard-note">
            {t(
              "No need to wait around, though. If someone has already invited you to their board you can join it right now, and propose, vote and chat like everyone else.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The authenticated boards overview. Expresses the Board paradigm: a spatial
 * canvas — now a wall of trip-board tiles the caller can open (Phase 1.1).
 */
export function Dashboard() {
  const { user } = useAuth();
  const dash = useHomeDashboard();
  const reorder = useReorderTrips();
  const [createOpen, setCreateOpen] = useState(false);
  const sensors = useSensors(
    // The same 6px threshold the board uses: a tile is a link, and without a
    // distance a click that trembles becomes a drag that never opens anything.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const list = dash.data?.trips ?? [];
  const active = list.filter((t) => t.status === "ACTIVE");
  const history = list.filter((t) => t.status === "HISTORY");

  /**
   * Commit a drop.
   *
   * Only the **active** tiles are sortable — History is what a trip becomes
   * rather than somewhere you put it — so the ids sent are the reordered active
   * list followed by history in the order it already had. The server stores
   * positions for the whole page, so leaving history out would let it drift
   * above the arrangement the next time anything was dragged.
   */
  function onDragEnd(e: DragEndEvent) {
    const { active: dragged, over } = e;
    if (!over || dragged.id === over.id) return;
    const ids = active.map((t) => t.id);
    const from = ids.indexOf(String(dragged.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorder.mutate([...arrayMove(ids, from, to), ...history.map((t) => t.id)]);
  }

  return (
    <main className="board">
      <header className="board__bar">
        <span className="board__brand">{t("GTP · Trip Board")}</span>
        <div className="board__bar-actions">
          <Button
            type="button"
            variant="primary"
            onClick={() => setCreateOpen(true)}
          >
            {t("＋ New board")}
          </Button>
          {/* No notification surface of its own here: the list is in the
              account menu, which fetches the count on every page. Live pushes
              need an open trip screen, so there is no socket to toast from. */}
          <UserMenu />
        </div>
      </header>

      {/* Everything except the bar. The measure lives here rather than
          on the <main> so the page bar can span the window like the trip
          board's does — see `.board__measure`. */}
      <div className="board__measure">
        <p className="board__eyebrow">{t("Boards")}</p>
        <h1 className="board__title">
          {t("Welcome, {name}", { name: user?.displayName ?? "" })}
        </h1>

        {dash.isPending ? (
          <div
            className="board__tiles"
            aria-busy="true"
            aria-label={t("Loading your boards")}
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="board__skel-tile" />
            ))}
          </div>
        ) : dash.isError ? (
          <p className="board__form-error" role="alert">
            {t("Couldn't load your boards.")}{" "}
            <button
              type="button"
              className="board__link-btn"
              onClick={() => void dash.refetch()}
            >
              {t("Retry")}
            </button>
          </p>
        ) : list.length === 0 ? (
          <Onboarding
            verified={user?.emailVerified ?? false}
            email={user?.email}
            onCreate={() => setCreateOpen(true)}
          />
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={active.map((t) => t.id)}
                strategy={rectSortingStrategy}
              >
                <div
                  className="board__tiles"
                  aria-label={t("Your trip boards")}
                >
                  {active.map((trip) => (
                    <SortableBoardTile key={trip.id} trip={trip} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {/* History is not arrangeable: it is what a trip becomes when it ends,
              not a place you put one, so these keep their own order. */}
            {history.length > 0 ? (
              <>
                <p className="board__eyebrow board__history-head">
                  {t("History")}
                </p>
                <div
                  className="board__tiles"
                  aria-label={t("Ended trip boards")}
                >
                  {history.map((trip) => (
                    <BoardTile key={trip.id} trip={trip} />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}

        {createOpen ? (
          <CreateBoardDialog onClose={() => setCreateOpen(false)} />
        ) : null}
      </div>
    </main>
  );
}
