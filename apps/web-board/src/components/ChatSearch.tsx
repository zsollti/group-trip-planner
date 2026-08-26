import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMessageSearch } from "@gtp/api-client";
import { MESSAGE_SEARCH_MIN_LENGTH, type ChannelView } from "@gtp/types";
import { Avatar } from "./Avatar";
import { intlTag } from "../lib/locale";
import { t } from "../lib/i18n";

/** How long the typing has to stop before a keystroke becomes a request. */
const DEBOUNCE_MS = 250;

/**
 * When a hit was said, in words a reader can place.
 *
 * A search crosses the whole transcript, so a bare "14:32" is useless here in a
 * way it is not in the log: the log is one continuous afternoon, and a hit may
 * be from March. Date and time together, and the date follows the app's own
 * language ({@link intlTag}) the way every other date in the board does.
 */
function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(intlTag(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The body with the reader's term marked inside it.
 *
 * Found with `indexOf` over lowercased copies rather than with a `RegExp`.
 * Building a pattern out of the term would mean escaping it first, which is the
 * same class of bug the server's `ESCAPE` clause exists to avoid, and there is
 * nothing here a regular expression would buy: the server matched a literal
 * substring, so a literal substring is exactly what should be marked.
 *
 * Every occurrence, not just the first. A line is often a hit precisely because
 * the term is its subject, and marking one of four reads as a mistake.
 *
 * The offsets come from the lowercased copy while the slices are taken from the
 * original, so marked text keeps the case it was written in.
 */
function markMatch(body: string, term: string) {
  if (!term) return body;
  const hay = body.toLowerCase();
  const needle = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let last = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (at > last) out.push(body.slice(last, at));
    out.push(
      <mark key={at} className="board__chat-hit">
        {body.slice(at, at + needle.length)}
      </mark>,
    );
    last = at + needle.length;
    at = hay.indexOf(needle, last);
  }
  if (last === 0) return body;
  if (last < body.length) out.push(body.slice(last));
  return out.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/**
 * Searching a board's whole transcript, in place of its log.
 *
 * **It replaces the log rather than floating over it.** The panel is narrow and
 * a reader who is searching is not reading: a popover would cover the very
 * thing it is meant to help with, and would have to be dismissed before the
 * answer could be used.
 *
 * **A hit is read where it is found.** Clicking one switches to its channel and
 * that is all. There is no jump to the message's place in history, which was
 * the owner's call and is the right shape here, because a hit is often older
 * than any page the log has loaded, so "jump" would mean paging backwards
 * through weeks to land on a line the reader has already read in this list.
 * Each row therefore carries everything needed to read it without going
 * anywhere: who said it, in which channel, when, and the body entire.
 */
export function ChatSearch({
  tripId,
  channels,
  channelName,
  onPick,
}: {
  tripId: string;
  channels: ChannelView[];
  /** The panel's own naming, so a hit's channel reads as its chip does. */
  channelName: (channel: ChannelView) => string;
  onPick: (channelId: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);

  // Opening the search means the reader is about to type into it.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  const search = useMessageSearch(tripId, debounced);
  const byId = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );

  const typed = term.trim();
  const asked = debounced.trim();
  const short = typed.length > 0 && typed.length < MESSAGE_SEARCH_MIN_LENGTH;
  /*
   * Hits with something to show, which is all of them.
   *
   * `MessageView.body` is nullable because a tombstone has no body, and the
   * search deliberately never matches one. So a null here would mean the server
   * broke that promise rather than that somebody sent an empty line, and the
   * row is dropped instead of rendered as a blank. Written as a `flatMap` that
   * rebuilds the object rather than as a `filter` and a cast, so the narrowing
   * is something the compiler checked instead of something it was told.
   */
  const hits = (search.data?.messages ?? []).flatMap((m) =>
    m.body === null ? [] : [{ ...m, body: m.body }],
  );

  return (
    <div className="board__chat-search">
      <div className="board__chat-searchbar">
        <input
          ref={fieldRef}
          type="search"
          className="board__chat-searchfield"
          value={term}
          placeholder={t("Search this board's chat")}
          aria-label={t("Search this board's chat")}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      <div className="board__chat-results">
        {typed.length === 0 ? (
          <p className="board__muted">
            {t("Type to search every conversation on this board.")}
          </p>
        ) : short ? (
          <p className="board__muted">
            {t("Keep typing. A search needs at least {n} characters.", {
              n: MESSAGE_SEARCH_MIN_LENGTH,
            })}
          </p>
        ) : search.isError ? (
          <p className="board__form-error" role="alert">
            {t("Couldn't run that search.")}
          </p>
        ) : (
          <>
            {/*
             * The count is announced; the list is not.
             *
             * Results arrive while the reader is still typing, so a live region
             * around the rows would read every hit out again on every
             * keystroke. One line saying how many there are is the part that
             * actually changed.
             */}
            <p className="board__chat-count" role="status">
              {search.isFetching && hits.length === 0
                ? t("Searching…")
                : hits.length === 0
                  ? t("No messages match that.")
                  : search.data?.truncated
                    ? t(
                        "The first {n} matches. Narrow the search to see fewer.",
                        {
                          n: hits.length,
                        },
                      )
                    : t("{n} matching", { n: hits.length })}
            </p>
            <ul className="board__chat-hits">
              {hits.map((m) => {
                const channel = byId.get(m.channelId);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="board__chat-hitrow"
                      /* The channel is in the accessible name because opening
                         it is the one thing pressing this row does. */
                      aria-label={t("{author} in {channel}: {body}", {
                        author: m.authorName,
                        channel: channel
                          ? channelName(channel)
                          : t("Discussion"),
                        body: m.body,
                      })}
                      onClick={() => onPick(m.channelId)}
                    >
                      <span className="board__chat-hithead">
                        <Avatar
                          name={m.authorName}
                          userId={m.authorId}
                          url={m.authorAvatarUrl}
                          size={20}
                        />
                        <span className="board__msg-author">
                          {m.authorName}
                        </span>
                        {channel ? (
                          <span className="board__chat-hitchannel">
                            {channelName(channel)}
                          </span>
                        ) : null}
                        <span className="board__msg-time">
                          {whenLabel(m.createdAt)}
                        </span>
                      </span>
                      <span className="board__chat-hitbody">
                        {markMatch(m.body, asked)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
