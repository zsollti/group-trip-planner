import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import type { AuthUser, Locale } from "@gtp/types";
import { LocaleProvider } from "./LocaleProvider";
import { useLocale } from "../lib/useLocale";
import { LOCALE_STORAGE_KEY, intlTag, setActiveLocale } from "../lib/locale";

/**
 * The provider that decides what language the app is in.
 *
 * The case that matters is the ordering one. Roughly half the date formatting in
 * this app happens in pure functions that read the module-level active language
 * rather than this context — so if the provider set that language in an effect,
 * every child would render its dates in the *previous* language and correct
 * itself a frame later. These tests are what stop that regressing into an
 * `useEffect`, which is where it would naturally be written.
 */

let user: AuthUser | null = null;

const setApiLanguage = vi.fn();

vi.mock("@gtp/api-client", () => ({
  useAuth: () => ({ user }),
  setApiLanguage: (tag: string | null) => setApiLanguage(tag),
}));

const ada: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  emailVerified: true,
  avatarUrl: null,
  isAdmin: false,
  locale: "en",
};

/** Reads the language the way a pure formatter does: at render, from the module. */
function DuringRender({ seen }: { seen: string[] }) {
  seen.push(intlTag());
  const { locale } = useLocale();
  return <p>{locale}</p>;
}

afterEach(() => {
  user = null;
  setActiveLocale("en");
  setApiLanguage.mockClear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("LocaleProvider", () => {
  it("has the language set before its children render", () => {
    // A stale module value, cast because this build offers exactly one language
    // and the type therefore cannot express "the wrong one". The state it
    // fabricates is real: it is what the module holds after a reader switches
    // language and React re-renders the tree.
    setActiveLocale("hu" as Locale);
    user = ada;
    const seen: string[] = [];

    render(
      <LocaleProvider>
        <DuringRender seen={seen} />
      </LocaleProvider>,
    );

    // Not "eventually" — on the very first render. An effect would have left
    // `hu-HU` in this array.
    expect(seen[0]).toBe("en-GB");
    expect(screen.getByText("en")).toBeInTheDocument();
  });

  it("takes the account's language over this browser's memory", () => {
    // They can only disagree when the reader switched language elsewhere, and the
    // account is the one that followed them here.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    user = { ...ada, locale: "en" };
    const { result } = renderHook(() => useLocale(), {
      wrapper: LocaleProvider,
    });
    expect(result.current.locale).toBe("en");
    expect(result.current.intlTag).toBe("en-GB");
  });

  it("still has a language with nobody signed in", () => {
    // Sign-in, register, verify and the invite-join page all render outside a
    // session. Before this they were English for everybody regardless of the
    // reader; now they at least have somewhere to read a preference from.
    user = null;
    vi.stubGlobal("navigator", { language: "en-GB" });
    const { result } = renderHook(() => useLocale(), {
      wrapper: LocaleProvider,
    });
    expect(result.current.locale).toBe("en");
  });

  it("remembers the account's language, and never the browser's guess", () => {
    // A first visit must not turn the browser's guess into a stored preference
    // the reader never expressed — that guess would then outlive their account's
    // real answer.
    user = null;
    vi.stubGlobal("navigator", { language: "en-GB" });
    renderHook(() => useLocale(), { wrapper: LocaleProvider });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    user = ada;
    renderHook(() => useLocale(), { wrapper: LocaleProvider });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("tells the API which language the screen is in", () => {
    // Not the browser's preference — the language being *displayed*. The API reads
    // this header only when there is no account to ask, which is exactly the
    // pre-auth screens, where an error in the wrong language is least
    // recoverable. Sent as a formatting tag, the same string a date is written
    // with, because that is what `Accept-Language` is defined to carry.
    user = ada;
    renderHook(() => useLocale(), { wrapper: LocaleProvider });
    expect(setApiLanguage).toHaveBeenCalledWith("en-GB");
  });

  it("refuses to guess when it is used outside the provider", () => {
    // A silent default is how half a tree ends up in the wrong language with
    // nothing on screen to say so.
    expect(() => renderHook(() => useLocale())).toThrow(/LocaleProvider/);
  });
});
