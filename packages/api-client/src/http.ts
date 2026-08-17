/**
 * Minimal typed fetch wrapper shared by every front-end.
 *
 * - Sends/parses JSON and always includes credentials (the refresh-token cookie
 *   is httpOnly + SameSite).
 * - Attaches the in-memory access token as a Bearer header.
 * - On a 401 from a protected route, transparently attempts a single silent
 *   refresh (via the cookie) and retries once.
 * - Throws a structured {@link ApiError} on non-2xx.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// Default targets the local API. Apps override via setApiBaseUrl at startup.
let baseUrl = "http://localhost:3000";

export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, "");
}

/** The API base URL, e.g. to build a full-page OAuth redirect link. */
export function getApiBaseUrl(): string {
  return baseUrl;
}

/**
 * The language the app is currently *displaying*, sent as `Accept-Language`.
 *
 * The browser already sends its own, so this is not about adding a header — it is
 * about overriding one. The two differ for anyone who has chosen a language in
 * the app: a Hungarian browser reading the English interface should get English
 * error messages, because the error appears on an English screen. The API reads
 * the header only when there is no account to ask, which is exactly the
 * pre-auth screens — sign-in, register, verify, invite-join — where an error in
 * the wrong language is least recoverable.
 *
 * Null until an app sets it, which leaves the browser's own header in place.
 */
let uiLanguage: string | null = null;

export function setApiLanguage(tag: string | null): void {
  uiLanguage = tag;
}

// Access token lives in memory only — never localStorage (XSS-safe). The
// refresh token is the httpOnly cookie the browser sends automatically.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export interface ApiFetchInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

// The auth endpoints must never trigger the 401 refresh-and-retry loop.
const AUTH_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/verify",
  "/auth/refresh",
  "/auth/logout",
]);

// Dedupe concurrent refreshes: many in-flight requests share one refresh call.
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken?: string };
    if (!data.accessToken) return false;
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

/** Refresh the access token using the cookie; returns whether it succeeded. */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performFetch(
  path: string,
  init: ApiFetchInit,
): Promise<Response> {
  const hasBody = init.body !== undefined;
  // File uploads (Phase 6.2) send FormData. It must go through untouched, and
  // crucially *without* a Content-Type header — the browser has to set that
  // itself so it can include the multipart boundary, which we cannot know.
  const isMultipart =
    typeof FormData !== "undefined" && init.body instanceof FormData;

  const headers: Record<string, string> = {};
  if (hasBody && !isMultipart) headers["Content-Type"] = "application/json";
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (uiLanguage) headers["Accept-Language"] = uiLanguage;

  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: isMultipart
      ? (init.body as FormData)
      : hasBody
        ? JSON.stringify(init.body)
        : undefined,
    signal: init.signal,
  });
}

export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  let res = await performFetch(path, init);

  // Access token likely expired — refresh once via the cookie and retry.
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await performFetch(path, init);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message: unknown }).message)
        : res.statusText || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }

  return payload as T;
}
