/**
 * @gtp/types — shared Zod schemas + inferred TypeScript types.
 *
 * The first real contract (RegisterInput / LoginInput / VerifyEmailInput) lands
 * in Phase 0.3. For now this package exists so the workspace wiring is provable
 * end-to-end from the walking skeleton.
 */

/** Version of the shared FE/BE contract. Bumped when the shared shapes change. */
export const CONTRACT_VERSION = "0.0.0";
