import { Prisma } from "@prisma/client";
import type { MessageView, ReactionGroup } from "@gtp/types";

/** The relations a MessageView needs: author name, reaction rows, and the
 * resolved mention targets with their display names. */
export const messageInclude = Prisma.validator<Prisma.MessageInclude>()({
  author: { select: { displayName: true, avatarUrl: true } },
  reactions: { select: { emoji: true, userId: true } },
  mentions: {
    select: { userId: true, user: { select: { displayName: true } } },
  },
});

type MessageWithRelations = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

/** Collapse the flat reaction rows into public per-emoji groups (Phase 4.3). */
export function groupReactions(
  rows: { emoji: string; userId: string }[],
): ReactionGroup[] {
  const byEmoji = new Map<string, string[]>();
  for (const r of rows) {
    const list = byEmoji.get(r.emoji) ?? [];
    list.push(r.userId);
    byEmoji.set(r.emoji, list);
  }
  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

/**
 * Prisma Message row → the shared client-facing {@link MessageView}. A
 * soft-deleted message is a **tombstone**: `deleted` is true and `body` is
 * null, so the content never crosses the wire once deleted. Reactions and
 * mentions ride along for the reaction chips and @mention highlighting.
 */
export function toMessageView(message: MessageWithRelations): MessageView {
  const deleted = message.deletedAt !== null;
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: message.author.displayName,
    authorAvatarUrl: message.author.avatarUrl,
    body: deleted ? null : message.body,
    deleted,
    createdAt: message.createdAt.toISOString(),
    reactions: groupReactions(message.reactions),
    mentions: message.mentions.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
    })),
  };
}
