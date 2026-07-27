import { z } from "zod";

/**
 * Uploads contract (Phase 6.1). One hardened endpoint accepts an image and
 * answers with where it ended up; Phase 6.2 attaches that URL to a trip cover
 * or a user avatar rather than uploading a second way.
 *
 * The dimensions are the **stored** ones, after the server's re-encode and
 * downscale — not what was sent — so a client can lay out against them without
 * measuring the file again.
 */
export const UploadedImageView = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});
export type UploadedImageView = z.infer<typeof UploadedImageView>;
