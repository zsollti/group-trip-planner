import type { Option, Vote } from "@prisma/client";
import {
  isVoteStale,
  type CostType,
  type OptionMaterialSnapshot,
  type OptionStatus,
  type OptionView,
} from "@gtp/types";

type VoteWithUser = Vote & {
  user: { displayName: string; avatarUrl: string | null };
};
type OptionWithRelations = Option & {
  proposer: { displayName: string };
  lockedBy: { displayName: string } | null;
  votes: VoteWithUser[];
};

/** The Prisma include that hydrates everything {@link toOptionView} needs. */
export const optionInclude = {
  proposer: { select: { displayName: true } },
  lockedBy: { select: { displayName: true } },
  // `avatarUrl` rides along with the name because the board draws a voter as a
  // face rather than a dot: a second round trip per voter to fetch a picture the
  // list is going to render anyway would be an N+1 for one nullable column.
  votes: {
    include: { user: { select: { displayName: true, avatarUrl: true } } },
  },
} as const;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * A stored option row (with proposer + votes) → the shared view. The Decimal
 * amount is normalised to a number, and the **public** approval tally (FR-22) is
 * built from the vote rows: each voter carries its own `stale` flag (a vote is
 * stale iff it predates `materialChangedAt`, FR-23), and `viewerHasVoted` is the
 * caller's own toggle state.
 */
export function toOptionView(
  o: OptionWithRelations,
  viewerId: string,
): OptionView {
  const materialChangedAt = iso(o.materialChangedAt);
  const voters = o.votes.map((v) => {
    const votedAt = v.createdAt.toISOString();
    return {
      userId: v.userId,
      displayName: v.user.displayName,
      avatarUrl: v.user.avatarUrl,
      votedAt,
      stale: isVoteStale(votedAt, materialChangedAt),
    };
  });
  return {
    id: o.id,
    categoryId: o.categoryId,
    title: o.title,
    description: o.description,
    url: o.url,
    amount: o.amount === null ? null : Number(o.amount),
    currency: o.currency,
    costType: o.costType as CostType,
    headcount: o.headcount,
    headcountIsFixed: o.headcountIsFixed,
    startsAt: iso(o.startsAt),
    endsAt: iso(o.endsAt),
    externalRef: o.externalRef,
    status: o.status as OptionStatus,
    version: o.version,
    proposerId: o.proposerId,
    proposerName: o.proposer.displayName,
    materialChangedAt,
    createdAt: o.createdAt.toISOString(),
    lockedByName: o.lockedBy?.displayName ?? null,
    lockedAt: iso(o.lockedAt),
    voteCount: voters.length,
    voters,
    viewerHasVoted: voters.some((v) => v.userId === viewerId),
  };
}

/** The cost/date fields that determine vote staleness (FR-23), from a row. */
export function toMaterialSnapshot(o: Option): OptionMaterialSnapshot {
  return {
    amount: o.amount === null ? null : Number(o.amount),
    currency: o.currency,
    costType: o.costType as CostType,
    headcount: o.headcount,
    headcountIsFixed: o.headcountIsFixed,
    startsAt: iso(o.startsAt),
    endsAt: iso(o.endsAt),
  };
}
