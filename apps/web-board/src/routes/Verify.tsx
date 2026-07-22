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
    <div className="board board--center">
      <div className="board__auth">
        <p className="board__eyebrow">Trip Board</p>
        {state === "loading" ? (
          <h1 className="board__title">Verifying…</h1>
        ) : state === "success" ? (
          <>
            <h1 className="board__title">Email verified</h1>
            <p className="board__alt">
              <Link to="/login">Continue to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="board__title">Verification failed</h1>
            <p className="board__muted">
              This link is invalid or has expired. Sign in to request a new one.
            </p>
            <p className="board__alt">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
