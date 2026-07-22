import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@gtp/api-client";

type VerifyState = "loading" | "success" | "error";

export function Verify() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { verifyEmail } = useAuth();
  const [state, setState] = useState<VerifyState>("loading");
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
    <div className="feed">
      <main className="feed__screen feed__center">
        {state === "loading" ? (
          <>
            <div className="feed__card-media">⏳</div>
            <h1 className="feed__title">Verifying…</h1>
          </>
        ) : state === "success" ? (
          <>
            <div className="feed__card-media">✅</div>
            <h1 className="feed__title">You&apos;re verified</h1>
            <p className="feed__alt">
              <Link to="/login">Continue to log in</Link>
            </p>
          </>
        ) : (
          <>
            <div className="feed__card-media">⚠️</div>
            <h1 className="feed__title">Link expired</h1>
            <p className="feed__muted">
              This link is invalid or has expired. Log in to request a new one.
            </p>
            <p className="feed__alt">
              <Link to="/login">Back to log in</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
