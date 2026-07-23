import { useEffect, useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  ROLE_RANK,
  type InviteRole,
  type InviteType,
  type InviteLinkView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useCreateInvite,
  useDisableInvite,
  useTripInvites,
} from "@gtp/api-client";

const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

const INVITE_ROLES: InviteRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

function joinUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

function linkStatus(link: InviteLinkView): string {
  if (link.disabledAt) return "Disabled";
  if (link.type === "PERSONAL" && link.consumedAt) return "Used";
  return "Active";
}

/**
 * Feed-paradigm invite surface: a share-sheet that slides up. Step 1 chooses the
 * kind of link (the global-vs-personal difference explained inline, FR-13); the
 * created link — plus any existing ones — can be shared or disabled. Roles are
 * limited to those below the caller's own, matching the API rule.
 */
export function InviteSheet({
  tripId,
  myRole,
  onClose,
}: {
  tripId: string;
  myRole: TripRole;
  onClose: () => void;
}) {
  const invites = useTripInvites(tripId);
  const createInvite = useCreateInvite(tripId);
  const disableInvite = useDisableInvite(tripId);

  const allowedRoles = INVITE_ROLES.filter(
    (r) => ROLE_RANK[r] < ROLE_RANK[myRole],
  );
  const [type, setType] = useState<InviteType>("GLOBAL");
  const [role, setRole] = useState<InviteRole>(
    allowedRoles.includes("PARTICIPANT")
      ? "PARTICIPANT"
      : (allowedRoles[0] ?? "GUEST"),
  );
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createInvite.mutateAsync({
        type,
        role,
        email: type === "PERSONAL" && email.trim() ? email.trim() : undefined,
      });
      setEmail("");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not create the link",
      );
    }
  }

  async function onShare(link: InviteLinkView) {
    const url = joinUrl(link.token);
    // Prefer the native share sheet on mobile; fall back to clipboard.
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "Join my trip" });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  }

  return (
    <div className="feed__sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feed__sheet feed__sheet--tall"
        role="dialog"
        aria-modal="true"
        aria-label="Invite people"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feed__sheet-grip" aria-hidden="true" />
        <p className="feed__eyebrow">Invite</p>
        <h2 className="feed__title">Share this trip</h2>

        <form onSubmit={onCreate} noValidate>
          <fieldset className="feed__radio-group">
            <legend className="feed__field-label">Link type</legend>
            <label className="feed__radio">
              <input
                type="radio"
                name="type"
                checked={type === "GLOBAL"}
                onChange={() => setType("GLOBAL")}
              />
              <span>
                <strong>Global</strong> — one reusable link anyone can use. One
                per role; disable it anytime (people who joined stay).
              </span>
            </label>
            <label className="feed__radio">
              <input
                type="radio"
                name="type"
                checked={type === "PERSONAL"}
                onChange={() => setType("PERSONAL")}
              />
              <span>
                <strong>Personal</strong> — a single-use link for one person,
                optionally emailed. Used up after the first join.
              </span>
            </label>
          </fieldset>

          <Field htmlFor="invite-role" label="Role granted">
            <select
              id="invite-role"
              className="feed__select"
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>

          {type === "PERSONAL" ? (
            <Field
              htmlFor="invite-email"
              label="Email (optional)"
              hint="We'll email the link. It stays unbound — anyone who gets it can use it."
            >
              <Input
                id="invite-email"
                type="email"
                placeholder="friend@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          ) : null}

          {formError ? (
            <p className="feed__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="feed__wizard-nav">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={createInvite.isPending}
            >
              {createInvite.isPending ? "Creating…" : "Create link"}
            </Button>
          </div>
        </form>

        <div className="feed__invite-list">
          <p className="feed__eyebrow">Existing links</p>
          {invites.isPending ? (
            <p className="feed__muted">Loading links…</p>
          ) : invites.isError ? (
            <p className="feed__form-error" role="alert">
              Couldn't load invite links.
            </p>
          ) : invites.data.length === 0 ? (
            <p className="feed__muted">No links yet. Create one above.</p>
          ) : (
            <ul className="feed__invite-items">
              {invites.data.map((link) => {
                const active = linkStatus(link) === "Active";
                return (
                  <li key={link.id} className="feed__invite-item">
                    <div>
                      <strong>{ROLE_LABEL[link.role]}</strong>{" "}
                      <span className="feed__muted">
                        {link.type === "GLOBAL" ? "Global" : "Personal"} ·{" "}
                        {linkStatus(link)}
                        {link.sentToEmail ? ` · ${link.sentToEmail}` : ""}
                      </span>
                    </div>
                    <div className="feed__invite-item-actions">
                      {active ? (
                        <>
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => onShare(link)}
                          >
                            {copiedId === link.id ? "Copied!" : "Share"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={disableInvite.isPending}
                            onClick={() => disableInvite.mutate(link.id)}
                          >
                            Disable
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
