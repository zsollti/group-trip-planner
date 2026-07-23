import type { InviteLink } from "@prisma/client";
import type { InviteLinkView } from "@gtp/types";

/**
 * Maps an InviteLink row to the shared {@link InviteLinkView} contract. Dates
 * become ISO strings; the `token` is included so a global link can be
 * re-displayed and copied by the management UI (SRS FR-13). The `createdById`
 * is intentionally not exposed — the client never needs it.
 */
export function toInviteLinkView(link: InviteLink): InviteLinkView {
  return {
    id: link.id,
    type: link.type,
    role: link.role,
    token: link.token,
    sentToEmail: link.sentToEmail,
    disabledAt: link.disabledAt ? link.disabledAt.toISOString() : null,
    consumedAt: link.consumedAt ? link.consumedAt.toISOString() : null,
    createdAt: link.createdAt.toISOString(),
  };
}
