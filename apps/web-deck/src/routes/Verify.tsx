import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@gtp/api-client";

type VerifyState = "loading" | "success" | "error";

/** Verify-email landing: reads ?token= and confirms it against the API. */
export function Verify() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { verifyEmail } = useAuth();
  const [state, setState] = useState<VerifyState>("loading");
  // Guard against StrictMode's double-invoke consuming the single-use token twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState("error");
      return;
    }
    let active = true;
    verifyEmail(token)
      .then(() => active && setState("success"))
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [token, verifyEmail]);

  return (
    <main className="deck deck--auth">
      <div className="deck__auth-card">
        <p className="deck__eyebrow">Command Deck</p>
        {state === "loading" ? (
          <>
            <h1 className="deck__title">Verifying…</h1>
            <p className="deck__lede">Confirming your email.</p>
          </>
        ) : state === "success" ? (
          <>
            <h1 className="deck__title">Email verified</h1>
            <p className="deck__lede">You&apos;re all set.</p>
            <p className="deck__auth-alt">
              <Link to="/login">Continue to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="deck__title">Verification failed</h1>
            <p className="deck__lede">
              This link is invalid or has expired. Try signing in to request a
              new one.
            </p>
            <p className="deck__auth-alt">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
