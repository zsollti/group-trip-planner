/**
 * Minimal typed fetch wrapper shared by every front-end.
 *
 * Sends/parses JSON, always includes credentials (the refresh-token cookie is
 * httpOnly + SameSite), and throws a structured {@link ApiError} on non-2xx so
 * callers get the status and any server message.
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

// Default targets the local API (Phase 0.5). Apps override via setApiBaseUrl.
let baseUrl = "http://localhost:3000";

export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, "");
}

export interface ApiFetchInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

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
