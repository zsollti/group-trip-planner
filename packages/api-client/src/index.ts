/**
 * @gtp/api-client — shared, typed TanStack Query hooks over the REST API.
 *
 * The first real auth hooks land in Phase 0.3 alongside the @gtp/types contract.
 * This placeholder proves the package graph resolves (it already depends on
 * @gtp/types) before any feature rides it.
 */
import { CONTRACT_VERSION } from "@gtp/types";

/** Version of the shared API client, pinned to the contract it targets. */
export const API_CLIENT_VERSION = CONTRACT_VERSION;
