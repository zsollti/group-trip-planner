import { useState } from "react";
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
import { Dialog } from "./Dialog";

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
 * Board-paradigm invite surface: a floating card summoned from the on-canvas
 * "Invite" affordance. Explains the global-vs-personal distinction (FR-13) at
 * creation, then lists existing links with copy/disable. Roles are limited to
 * those below the caller's own, matching the API rule.
 */
export function InviteDialog({
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

  async function onCopy(link: InviteLinkView) {
    try {
      await navigator.clipboard.writeText(joinUrl(link.token));
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setFormError("Couldn't copy — copy the link manually.");
    }
  }

  return (
    <Dialog
      eyebrow="Invite"
      title="Invite people to this board"
      onClose={onClose}
    >
      <>
        <form onSubmit={onCreate} noValidate>
          <fieldset className="board__radio-group">
            <legend className="board__field-label">Link type</legend>
            <label className="board__radio">
              <input
                type="radio"
                name="type"
                checked={type === "GLOBAL"}
                onChange={() => setType("GLOBAL")}
              />
              <span>
                <strong>Global</strong> — one reusable link anyone can use to
                join. One per role; disable it anytime (members who joined
                stay).
              </span>
            </label>
            <label className="board__radio">
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
              className="board__select"
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
            <p className="board__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="board__dialog-actions">
            <Button
              type="submit"
              variant="primary"
              disabled={createInvite.isPending}
            >
              {createInvite.isPending ? "Creating…" : "Create link"}
            </Button>
          </div>
        </form>

        <div className="board__invite-list">
          <p className="board__eyebrow">Existing links</p>
          {invites.isPending ? (
            <p className="board__muted" role="status">
              Loading links…
            </p>
          ) : invites.isError ? (
            <>
              <p className="board__form-error" role="alert">
                Couldn't load invite links.
              </p>
              <button
                type="button"
                className="board__cta"
                onClick={() => void invites.refetch()}
              >
                Try again
              </button>
            </>
          ) : invites.data.length === 0 ? (
            <p className="board__muted">No links yet. Create one above.</p>
          ) : (
            <ul className="board__invite-items">
              {invites.data.map((link) => {
                const active = linkStatus(link) === "Active";
                return (
                  <li key={link.id} className="board__invite-item">
                    <div>
                      <strong>{ROLE_LABEL[link.role]}</strong>{" "}
                      <span className="board__muted">
                        {link.type === "GLOBAL" ? "Global" : "Personal"} ·{" "}
                        {linkStatus(link)}
                        {link.sentToEmail ? ` · ${link.sentToEmail}` : ""}
                      </span>
                    </div>
                    <div className="board__invite-item-actions">
                      {active ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onCopy(link)}
                          >
                            {copiedId === link.id ? "Copied!" : "Copy link"}
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
      </>
    </Dialog>
  );
}
