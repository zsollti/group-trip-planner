import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { User } from "@prisma/client";
import type { UploadedImageView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { UploadsService } from "./uploads.service.js";
import { UserThrottlerGuard } from "./user-throttler.guard.js";

/**
 * The single image-upload entry point (Phase 6.1).
 *
 * **Proxied through the API, not presigned direct-to-bucket.** A presigned URL
 * would put the client in direct contact with storage, which is exactly where
 * the magic-byte check and the re-encode cannot run — whatever the client PUT
 * is what would be stored. Routing the bytes through here costs a hop and buys
 * the guarantee that nothing lands in storage unvalidated.
 *
 * Guard order is deliberate: authenticate, then require a verified email, then
 * rate-limit — so the per-user throttle counts a known user (see
 * {@link UserThrottlerGuard}) rather than an IP, and unverified accounts can't
 * spend upload budget at all.
 */
/** Per-user upload ceiling. Re-encoding is CPU-bound, so this caps cost as much
 *  as abuse; generous enough that ordinary use never meets it. Static like the
 *  auth-route throttles — Phase 7.1 revisits all of them together. */
const UPLOAD_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * The part of multer's file object this route actually uses. Declared here
 * rather than reaching for the `Express.Multer.File` global, which only exists
 * where `@types/multer` happens to be in scope — that resolves differently
 * between the build and test tsconfigs, which is a fragile thing to hinge a
 * compile on.
 */
interface UploadedImageFile {
  readonly buffer: Buffer;
  readonly mimetype?: string;
  readonly size?: number;
}

@Controller("uploads")
@UseGuards(JwtAuthGuard, VerifiedEmailGuard, UserThrottlerGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Accept one image and return where it was stored.
   *
   * The size cap lives in `MulterModule.registerAsync` (so it reads the
   * validated env, which a decorator can't): multer stops reading once the cap
   * is passed and errors, so an oversized upload is refused mid-stream and
   * never sits in memory whole. Memory storage (rather than multer's disk
   * storage) is the safer of the two here precisely because the cap is small —
   * unvalidated bytes never touch the filesystem at all.
   */
  @Post("image")
  @Throttle(UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor("file"))
  async uploadImage(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentUser() user: User,
  ): Promise<UploadedImageView> {
    if (!file) {
      throw new BadRequestException("No file was uploaded (field name: file).");
    }
    return this.uploads.storeImage(file, user.id);
  }
}
