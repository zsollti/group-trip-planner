import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  useAuth,
  useInvitePreview,
  useJoinTrip,
} from "@gtp/api-client";
import { Button } from "@gtp/ui-primitives";
import { plural, t } from "../lib/i18n";
import { intlTag } from "../lib/locale";
import { tripDateForDisplay } from "../lib/tripDate";
import { BrandLockup } from "../components/Brand";
import { InvitePreviewBoard } from "../components/InvitePreviewBoard";

/**
 * Invite redemption landing (Phase 1.3). A signed-in arrival redeems the token
 * once and the board opens.
 *
 * **A logged-out arrival is shown the trip** rather than bounced to a login
 * form. It used to bounce: the token rode the `/login?next=…` redirect and was
 * redeemed after authenticating, which works and asks the wrong thing first —
 * the only way to find out what you had been invited to was to make an account
 * for it. The board is the answer to "what is this", and the link already
 * carries the right to see it (see `InvitesService.preview` for what a visitor
 * is and is not shown).
 *
 * The redirect it replaces still happens, from the button: signing in from here
 * carries the same `next`, so the link is redeemed the moment there is somebody
 * to redeem it for.
 */
export function Join() {
  const { token } = useParams<{ token: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();
  const joinTrip = useJoinTrip();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !token || started.current) return;
    started.current = true;
    joinTrip
      .mutateAsync(token)
      .then((result) => navigate(`/trips/${result.tripId}`, { replace: true }))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : t("Couldn't join this board."),
        ),
      );
  }, [status, token, joinTrip, navigate]);

  if (status === "loading") {
    return (
      <main className="board board--center">
        <p className="board__muted">{t("Loading…")}</p>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return <Visitor token={token ?? ""} />;
  }

  return (
    <main className="board board--center">
      <div className="board__auth">
        <BrandLockup />
        {error ? (
          <>
            <h1 className="board__title">{t("Couldn't join")}</h1>
            <p className="board__muted">{error}</p>
            <p className="board__alt">
              <Link to="/">{t("Back to boards")}</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="board__title">{t("Joining board…")}</h1>
            <p className="board__muted">{t("Redeeming your invite.")}</p>
          </>
        )}
      </div>
    </main>
  );
}

/**
 * The trip, to somebody holding a link and no account.
 *
 * Three states and no fourth: the link is dead, the trip is loading, or here it
 * is. A dead link says so in the words the server used — "disabled", "already
 * used" and "invalid" are different things to be told, and flattening them into
 * one message would leave somebody re-clicking a link that will never work.
 *
 * The way in sits **above** the board as well as below it. Above, because it is
 * what the page is for; below, because a reader who has just scrolled a trip's
 * worth of lanes should not have to scroll back to act on it.
 */
function Visitor({ token }: { token: string }) {
  const preview = useInvitePreview(token);
  const next = `/login?next=/join/${encodeURIComponent(token)}`;

  if (preview.isPending) {
    return (
      <main className="board board--center">
        <p className="board__muted">{t("Loading…")}</p>
      </main>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <main className="board board--center">
        <div className="board__auth">
          <BrandLockup />
          <h1 className="board__title">{t("Couldn't open this invite")}</h1>
          <p className="board__muted">
            {preview.error instanceof ApiError
              ? preview.error.message
              : t("This invite link is invalid.")}
          </p>
          <p className="board__alt">
            <Link to="/login">{t("Sign in")}</Link>
          </p>
        </div>
      </main>
    );
  }

  const trip = preview.data;
  const cta = (
    <div className="preview__cta">
      {trip.acceptingMembers ? (
        <>
          <Button onClick={() => (window.location.href = next)}>
            {t("Sign in to join")}
          </Button>
          {/* Named separately, because most people arriving on an invite have
              no account and "Sign in" is a door they think is locked to them.
              Both land on the same page, which offers both. */}
          <p className="board__alt">
            <Link to={next}>{t("or create an account")}</Link>
          </p>
        </>
      ) : (
        <p className="board__muted">
          {t("This trip has ended and is no longer taking new members.")}
        </p>
      )}
    </div>
  );

  return (
    <main className="board preview">
      <div className="preview__inner">
        <header className="preview__head">
          <BrandLockup />
          <p className="preview__lead">{t("You've been invited to")}</p>
          <h1 className="board__title">{trip.name}</h1>
          <p className="board__muted">
            {trip.destination ?? t("No destination yet")} ·{" "}
            {fmtDate(trip.startDate)} – {fmtDate(trip.endDate)} ·{" "}
            {plural(trip.memberCount, "{n} member", "{n} members")}
          </p>
          {trip.description ? (
            <p className="preview__blurb">{trip.description}</p>
          ) : null}
          {cta}
        </header>

        <InvitePreviewBoard preview={trip} />

        {/* Said once more at the bottom, where a reader who has read the whole
            board is. */}
        {cta}

        <p className="preview__note">
          {t("Signing in is the only way to vote, comment or add anything.")}
        </p>
      </div>
    </main>
  );
}

/**
 * A trip's own dates are `date` columns, so they are days rather than instants
 * — the same care the board's header takes, and for the same reason:
 * `new Date(iso).toLocaleDateString()` renders the day before across the
 * Americas.
 */
function fmtDate(iso: string | null): string {
  const d = tripDateForDisplay(iso);
  return d ? d.toLocaleDateString(intlTag()) : "—";
}
