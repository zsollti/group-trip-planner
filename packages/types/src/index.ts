/**
 * @gtp/types — shared Zod schemas + inferred TypeScript types.
 *
 * The single source of truth for the FE/BE contract. Bumped when shared shapes
 * change so consumers can reason about compatibility.
 */

/** Version of the shared FE/BE contract. Bumped when the shared shapes change. */
export const CONTRACT_VERSION = "0.30.0";

export * from "./auth.js";
export * from "./trips.js";
export * from "./permissions.js";
export * from "./invites.js";
export * from "./policy.js";
export * from "./members.js";
export * from "./account.js";
export * from "./categories.js";
export * from "./options.js";
export * from "./votes.js";
export * from "./locking.js";
export * from "./lifecycle.js";
export * from "./cost.js";
export * from "./dashboard.js";
export * from "./chat.js";
export * from "./notifications.js";
export * from "./email-jobs.js";
export * from "./preferences.js";
export * from "./activity.js";
export * from "./uploads.js";
