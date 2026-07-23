/**
 * @gtp/api-client — shared, typed TanStack Query hooks over the REST API,
 * plus the fetch layer and QueryClient factory the three front-ends share.
 */
import { CONTRACT_VERSION } from "@gtp/types";

/** Version of the shared API client, pinned to the contract it targets. */
export const API_CLIENT_VERSION = CONTRACT_VERSION;

export {
  ApiError,
  apiFetch,
  setApiBaseUrl,
  setAccessToken,
  getAccessToken,
  refreshAccessToken,
} from "./http.js";
export type { ApiFetchInit } from "./http.js";
export { createQueryClient } from "./query.js";
export { useRegister, useLogin, useVerifyEmail } from "./auth.js";
export {
  tripKeys,
  useMyTrips,
  useTrip,
  useTripPreview,
  useCreateTrip,
} from "./trips.js";
export { AuthProvider, useAuth } from "./session.js";
export type { AuthContextValue, AuthStatus } from "./session.js";
