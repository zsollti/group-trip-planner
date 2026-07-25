import { Prisma } from "@prisma/client";
import type { MessageView } from "@gtp/types";

/** The relations a MessageView needs (the author's display name). */
export const messageInclude = Prisma.validator<Prisma.MessageInclude>()({
  author: { select: { displayName: true } },
});

type MessageWithAuthor = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

/**
 * Prisma Message row → the shared client-facing {@link MessageView}. A
 * soft-deleted message is a **tombstone**: `deleted` is true and `body` is
 * null, so the content never crosses the wire once deleted.
 */
export function toMessageView(message: MessageWithAuthor): MessageView {
  const deleted = message.deletedAt !== null;
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: message.author.displayName,
    body: deleted ? null : message.body,
    deleted,
    createdAt: message.createdAt.toISOString(),
  };
}
