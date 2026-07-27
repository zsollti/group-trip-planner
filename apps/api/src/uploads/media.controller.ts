import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  isStoredImageName,
  STORED_IMAGE_TYPE,
} from "./image-validation.js";
import { LocalDiskStorage } from "./local-disk.storage.js";

/**
 * Serves stored images back (Phase 6.1, local-disk driver only — with R2 the
 * URL points at the bucket/CDN and this route stops being used).
 *
 * Deliberately **not** `express.static` over the upload directory. Static
 * middleware infers `Content-Type` from the filename and will happily serve
 * whatever is on disk; here the type is fixed to the one format we ever write,
 * because the file was produced by our own re-encode. Together with `nosniff`
 * and an attachment-safe disposition, that is what makes the served path
 * inert: a browser cannot be talked into treating it as script or HTML.
 *
 * Public on purpose — the URLs are unguessable UUIDs and are embedded in pages
 * (a trip cover, an avatar in chat) where an Authorization header can't be
 * attached to an `<img src>`.
 */
@Controller("media")
export class MediaController {
  constructor(private readonly storage: LocalDiskStorage) {}

  @Get(":name")
  async serve(@Param("name") name: string, @Res() res: Response): Promise<void> {
    // The name must be one we generated. This runs before any filesystem call,
    // so traversal attempts ("../../.env") are refused as simply not-found
    // rather than resolved and then denied.
    if (!isStoredImageName(name)) throw new NotFoundException();

    const data = await this.storage.read(name);
    if (!data) throw new NotFoundException();

    res.setHeader("Content-Type", STORED_IMAGE_TYPE);
    // Never let the browser second-guess the type we just declared.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Belt-and-braces against an HTML-ish payload surviving re-encode somehow.
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    // This is the one route meant to be embedded from another origin: the web
    // app runs on its own domain and loads covers/avatars with `<img src>`.
    // Helmet's global `same-origin` CORP would have the browser block exactly
    // that, so the public route opts out for itself alone (Phase 7.2).
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    // Content is immutable: the name is a fresh UUID on every upload.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(data);
  }
}
