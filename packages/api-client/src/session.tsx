import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthUser,
  LoginInput,
  LoginResult,
  RegisterInput,
  RegisterResult,
} from "@gtp/types";
import { apiFetch, setAccessToken } from "./http.js";

/** loading = still attempting the silent refresh on load. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** GDPR account deletion (FR-6): deletes the account, then clears the session
   * exactly like logout. Rejects (leaving the session intact) if the request
   * fails, so the caller can surface the error. */
  deleteAccount: () => Promise<void>;
  /** Replace the cached session user with a fresher server copy — used when a
   *  mutation returns an updated {@link AuthUser}, e.g. an avatar change
   *  (Phase 6.2), so every surface reading `user` follows immediately. */
  applyUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the client auth session shared by all three apps: keeps the access token
 * in memory, attempts a silent refresh on load (from the httpOnly cookie), and
 * exposes the auth actions. Each app renders its own login/register/dashboard on
 * top of this — the machinery is built once (§0b).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // On mount, try to restore a session from the refresh cookie.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await apiFetch<LoginResult>("/auth/refresh", {
          method: "POST",
        });
        if (!active) return;
        setAccessToken(result.accessToken);
        setUser(result.user);
        setStatus("authenticated");
      } catch {
        if (!active) return;
        setAccessToken(null);
        setUser(null);
        setStatus("unauthenticated");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const result = await apiFetch<LoginResult>("/auth/login", {
      method: "POST",
      body: input,
    });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  const register = useCallback(
    (input: RegisterInput) =>
      apiFetch<RegisterResult>("/auth/register", {
        method: "POST",
        body: input,
      }),
    [],
  );

  const verifyEmail = useCallback(
    (token: string) =>
      apiFetch<AuthUser>("/auth/verify", { method: "POST", body: { token } }),
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Logout is best-effort; clear local state regardless.
    }
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const deleteAccount = useCallback(async () => {
    // Unlike logout, this must succeed before we drop the session — if it throws
    // the account still exists, so keep the caller signed in to show the error.
    await apiFetch("/account", { method: "DELETE", body: { confirm: true } });
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const applyUser = useCallback((next: AuthUser) => {
    // Only refreshes the cached copy — never touches status or the token, so it
    // cannot accidentally sign anyone in or out.
    setUser(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login,
      register,
      verifyEmail,
      logout,
      deleteAccount,
      applyUser,
    }),
    [
      user,
      status,
      login,
      register,
      verifyEmail,
      logout,
      deleteAccount,
      applyUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}
