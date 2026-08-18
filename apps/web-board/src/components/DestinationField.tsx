import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@gtp/ui-primitives";
import { placeLabel, usePlaceSearch } from "@gtp/api-client";
import { PLACE_QUERY_MIN_LENGTH, type PlaceView } from "@gtp/types";
import { t } from "../lib/i18n";

/**
 * Where the trip is going: a field that suggests, and still accepts anything.
 *
 * **The free text is the point, not the fallback.** A group going to "Dad's
 * cabin", to "the Dolomites", or to a village of four hundred people that the
 * gazetteer stops short of must be able to say so — so this is a text input with
 * a list attached, never a select. What choosing a suggestion adds is the
 * *other* half: an id, from which the server reads the place's clock, its
 * coordinates and its country's currency. Type instead of choosing and the trip
 * simply has a destination and no place behind it, which is what every trip made
 * before this existed has.
 *
 * ## Why it is hand-rolled
 *
 * `<datalist>` is the platform's answer and it is not usable here: its rendering
 * is entirely the browser's, it cannot show a second line, its behaviour differs
 * on every engine, and — fatally — it gives no event for "the reader picked the
 * one from the list" as distinct from "the reader typed those exact letters",
 * which is the only distinction this component exists to make.
 *
 * So it is the ARIA combobox pattern: a text input owning a listbox, `aria-
 * expanded` and `aria-activedescendant` on the input, arrow keys moving a
 * highlight that is *not* focus, Enter committing it, Escape closing the list
 * without touching what was typed.
 *
 * ## The debounce
 *
 * 250ms, and it lives here rather than in the hook. What wants delaying is a
 * keystroke turning into a request — a hook that debounced internally would
 * still re-render on every letter and would hold a stale key while it waited.
 * Answers are cached per query string for the session, so typing backwards over
 * a correction costs nothing.
 */
export function DestinationField({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string;
  /** What the field shows, which is also what the trip stores. */
  value: string;
  /**
   * The text, and the place it came from when it came from the list.
   *
   * `place` is null whenever the reader typed — including when they type the
   * exact name of somewhere real, because a string that happens to match is not
   * a choice and we would be guessing at which of four Springfields they meant.
   */
  onChange: (next: { destination: string; place: PlaceView | null }) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  /*
   * Whether the reader has typed since the field was last given a value from
   * outside. Without it the list opens on mount for a trip that already has a
   * destination — the edit dialog would greet you with eight suggestions for the
   * place you already chose.
   */
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setQuery(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Close on a click anywhere else. A list left standing over the next field is
  // worse than no list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const results = usePlaceSearch(debounced, open && typed.current);
  const places = results.data?.places ?? [];
  const showList = open && typed.current && places.length > 0;

  function type(next: string) {
    typed.current = true;
    setQuery(next);
    setOpen(true);
    setHighlighted(-1);
    // Reported on every keystroke, so a half-typed destination is still saved if
    // the reader submits without opening the list. The place goes with it: the
    // moment the text stops being the suggestion, it is no longer that place.
    onChange({ destination: next, place: null });
  }

  function choose(place: PlaceView) {
    const label = placeLabel(place);
    typed.current = false;
    setQuery(label);
    setOpen(false);
    setHighlighted(-1);
    onChange({ destination: label, place });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && showList) {
      // Closes the list and leaves the text alone — the reader is dismissing a
      // suggestion, not undoing their typing.
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (!showList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = highlighted + delta;
      setHighlighted(
        next < 0 ? places.length - 1 : next >= places.length ? 0 : next,
      );
      return;
    }
    if (e.key === "Enter" && highlighted >= 0) {
      // Only with something highlighted. Enter on a typed string has to submit
      // the form, or a reader who ignored the list cannot get past this field.
      e.preventDefault();
      choose(places[highlighted]!);
    }
  }

  return (
    <div className="destfield" ref={rootRef}>
      <Input
        id={id}
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          highlighted >= 0 ? `${listId}-${highlighted}` : undefined
        }
        onChange={(e) => type(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {/*
       * The status line, and the only place this field explains itself.
       *
       * It says what to do while there is nothing to show, and gets out of the
       * way once the list is up — where the list itself is the instruction.
       */}
      {showList ? null : (
        <p className="destfield__hint" id={`${id}-hint`}>
          {query.trim().length >= PLACE_QUERY_MIN_LENGTH &&
          typed.current &&
          !results.isFetching &&
          places.length === 0
            ? t("Nothing found — you can write it in yourself.")
            : t("Start typing to search, or write anywhere you like.")}
        </p>
      )}
      {showList ? (
        <ul className="destfield__list" id={listId} role="listbox">
          {places.map((place, i) => (
            <li key={place.id} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlighted}
                className={
                  "destfield__option" +
                  (i === highlighted ? " destfield__option--on" : "")
                }
                // `onMouseDown`, not `onClick`: the input's blur fires first on a
                // click, and a handler that closed the list on blur would remove
                // the button before its click landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(place);
                }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="destfield__name">{place.name}</span>
                <span className="destfield__where">
                  {[place.region, place.countryName]
                    .filter(
                      (part, idx, all) =>
                        Boolean(part) &&
                        (idx === 0 || part !== all[0]) &&
                        part !== place.name,
                    )
                    .join(", ")}
                </span>
                {/* What the choice will do, said once per row rather than in a
                    sentence under the field: a country's currency is about to
                    become the trip's, and a reader should see that coming. */}
                {place.currencyCode ? (
                  <span className="destfield__currency">
                    {place.currencyCode}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
