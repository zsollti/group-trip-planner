import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from "@nestjs/common";
import sharp, { type OutputInfo } from "sharp";
import type { UploadedImageView } from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import {
  checkImageUpload,
  STORED_IMAGE_EXTENSION,
  STORED_IMAGE_TYPE,
  type ImageRejection,
} from "./image-validation.js";
import { STORAGE_DRIVER, type StorageDriver } from "./storage.driver.js";
import { localizedException } from "../i18n/localized-message.js";

/**
 * The part of multer's file object the pipeline actually uses. Declared here
 * rather than reaching for the `Express.Multer.File` global, which only exists
 * where `@types/multer` happens to be in scope — that resolves differently
 * between the build and test tsconfigs, which is a fragile thing to hinge a
 * compile on.
 */
export interface UploadedImageFile {
  readonly buffer: Buffer;
  readonly mimetype?: string;
  readonly size?: number;
}

/** Client-facing message per rejection reason — deliberately specific, since
 *  none of it tells the caller anything they didn't already send us. */
const REJECTION_MESSAGE: Record<ImageRejection, string> = {
  EMPTY: "The uploaded file is empty.",
  UNSUPPORTED_CONTENT:
    "That file isn't a JPEG, PNG or WebP image. Only real images are accepted.",
  DECLARED_TYPE_NOT_ACCEPTED:
    "Unsupported image type. Upload a JPEG, PNG or WebP.",
  DECLARED_TYPE_MISMATCH:
    "The file's contents don't match the type it claims to be.",
};

/**
 * The one hardened image path (Phase 6.1, security-critical). Every image in
 * the product goes through here; Phase 6.2 wires covers and avatars onto it
 * rather than adding a second route.
 *
 * Order matters, and each step exists to make the next one safe:
 *  1. **Size** is capped while the request is read (see the controller), so a
 *     huge body is refused mid-stream and never fully buffered.
 *  2. **Magic bytes** decide what the file is; the declared type only gets to
 *     agree. A disguised script never reaches step 3.
 *  3. **Re-encode** through sharp rasterises the image into bytes we produced.
 *     This is what strips EXIF (GPS included) and neutralises anything smuggled
 *     in a metadata segment — sharp emits no metadata unless asked, so the
 *     output carries none. `limitInputPixels` (on by default) covers
 *     decompression bombs, where a small file expands to gigabytes of raster.
 *  4. **Random name**, server-chosen, with the single extension we ever write.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async storeImage(
    file: UploadedImageFile,
    userId: string,
  ): Promise<UploadedImageView> {
    // Belt-and-braces: the controller's multer limit already rejects oversize
    // mid-stream, but the service must hold its own invariant.
    if ((file.size ?? file.buffer.length) > this.env.UPLOAD_MAX_BYTES) {
      throw localizedException(
        (message) => new PayloadTooLargeException(message),
        "Images must be {mb}MB or smaller.",
        { mb: Math.floor(this.env.UPLOAD_MAX_BYTES / 1024 / 1024) },
      );
    }

    const check = checkImageUpload(file.buffer, file.mimetype);
    if (!check.ok) {
      this.logger.warn(
        `Rejected upload from user ${userId}: ${check.reason} (declared ${file.mimetype ?? "none"})`,
      );
      throw new BadRequestException(REJECTION_MESSAGE[check.reason]);
    }

    let output: { data: Buffer; info: OutputInfo };
    try {
      output = await sharp(file.buffer, { failOn: "error" })
        // Applies the EXIF orientation, then drops it with the rest of the
        // metadata — otherwise stripping EXIF would silently rotate photos.
        .rotate()
        .resize({
          width: this.env.UPLOAD_MAX_DIMENSION,
          height: this.env.UPLOAD_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch (err) {
      // Sniffing passed but decoding didn't: a truncated or malformed file with
      // a valid header. Still the client's problem, not a 500.
      this.logger.warn(
        `Re-encode failed for user ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        "That image couldn't be processed. It may be corrupt.",
      );
    }

    const name = `${randomUUID()}.${STORED_IMAGE_EXTENSION}`;
    const url = await this.storage.put(name, output.data, STORED_IMAGE_TYPE);

    return {
      url,
      width: output.info.width,
      height: output.info.height,
      bytes: output.info.size,
    };
  }
}
