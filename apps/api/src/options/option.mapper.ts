import type { Option } from "@prisma/client";
import type {
  CostType,
  OptionMaterialSnapshot,
  OptionStatus,
  OptionView,
} from "@gtp/types";

type OptionWithProposer = Option & { proposer: { displayName: string } };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A stored option row → the shared view (Decimal amount normalised to number). */
export function toOptionView(o: OptionWithProposer): OptionView {
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
    materialChangedAt: iso(o.materialChangedAt),
    createdAt: o.createdAt.toISOString(),
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
