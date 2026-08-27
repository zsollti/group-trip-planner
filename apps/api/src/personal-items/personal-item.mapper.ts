import type { PersonalItem } from "@prisma/client";
import type { PersonalItemView } from "@gtp/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * A stored personal item → the shared view. The Decimal amount is normalised to
 * a number, exactly as an option's is, so the cost engine never has to know
 * which table a figure came from.
 *
 * **`ownerId` is not carried across.** It is the one column on the row that
 * could describe somebody other than the reader, and every item that reaches a
 * client is that client's own — so the view has no shape in which it can name
 * a different person. Dropping it here rather than "remembering not to select
 * it" is what makes that true of every caller at once.
 */
export function toPersonalItemView(item: PersonalItem): PersonalItemView {
  return {
    id: item.id,
    tripId: item.tripId,
    categoryId: item.categoryId,
    title: item.title,
    description: item.description,
    url: item.url,
    amount: item.amount === null ? null : Number(item.amount),
    currency: item.currency,
    startsAt: iso(item.startsAt),
    endsAt: iso(item.endsAt),
    position: item.position,
    createdAt: item.createdAt.toISOString(),
  };
}
