import { Inject, Injectable, Logger } from "@nestjs/common";
import type { UploadedImageView } from "@gtp/types";
import { STORAGE_DRIVER, type StorageDriver } from "./storage.driver.js";
import { UploadsService, type UploadedImageFile } from "./uploads.service.js";

/**
 * Attaching an uploaded image to something that already had one (Phase 6.2).
 *
 * Trip covers and user avatars want identical behaviour — store the new image,
 * then drop the object the old URL pointed at so nothing accumulates — so the
 * rule lives once here rather than being written twice and drifting.
 *
 * Ordering is deliberate: **store first, delete second**. If the delete fails
 * the worst outcome is one orphaned file; if it ran first, a failed upload
 * would leave a record pointing at an object that no longer exists. Cleanup is
 * also best-effort for the same reason — a storage hiccup must not fail a
 * request whose visible work already succeeded.
 */
@Injectable()
export class ImageAttachmentService {
  private readonly logger = new Logger(ImageAttachmentService.name);

  constructor(
    private readonly uploads: UploadsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Run the upload pipeline, then clean up whatever `previousUrl` referenced. */
  async replace(
    file: UploadedImageFile,
    userId: string,
    previousUrl: string | null,
  ): Promise<UploadedImageView> {
    const stored = await this.uploads.storeImage(file, userId);
    await this.discard(previousUrl);
    return stored;
  }

  /**
   * Delete the object a URL points at, if it is one of ours. Foreign URLs and
   * nulls are no-ops — {@link StorageDriver.nameFromUrl} is what makes that
   * safe. Never throws.
   */
  async discard(url: string | null): Promise<void> {
    if (!url) return;
    const name = this.storage.nameFromUrl(url);
    if (!name) return;
    try {
      await this.storage.remove(name);
    } catch (err) {
      // An orphan is untidy; a failed request over it would be worse.
      this.logger.warn(
        `Could not remove replaced image ${name}: ${(err as Error).message}`,
      );
    }
  }
}
