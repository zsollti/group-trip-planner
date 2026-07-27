import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { isStoredImageName } from "./image-validation.js";
import type { StorageDriver } from "./storage.driver.js";

/**
 * Local-filesystem storage (Phase 6.1). Stands in for Cloudflare R2 until the
 * bucket exists — same interface, so swapping is a provider change.
 *
 * Two things it does *not* do, on purpose:
 *  - it never serves files itself. `UPLOAD_DIR` sits outside the app's source
 *    and outside anything a web server maps, and bytes only come back out
 *    through the media route, which sets its own `Content-Type` and
 *    `nosniff`. That is what "the served path can't execute" means here: there
 *    is no path from a stored file to an interpreter.
 *  - it never accepts a caller-supplied name. Every name is checked against
 *    the generated-UUID shape before it touches the filesystem, so `..` and
 *    absolute paths cannot escape the directory even if a bug upstream let one
 *    through.
 */
@Injectable()
export class LocalDiskStorage implements StorageDriver {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.root = resolve(env.UPLOAD_DIR);
  }

  /** Reject anything that isn't a name we generated, then join under the root. */
  private pathFor(name: string): string {
    if (!isStoredImageName(name)) {
      throw new Error(`Refusing to touch a non-generated object name: ${name}`);
    }
    return join(this.root, name);
  }

  async put(name: string, data: Buffer): Promise<string> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathFor(name), data);
    return this.urlFor(name);
  }

  async remove(name: string): Promise<void> {
    await rm(this.pathFor(name), { force: true });
  }

  urlFor(name: string): string {
    return `${this.env.API_PUBLIC_URL}/media/${name}`;
  }

  /**
   * Read an object back for the media route. Returns null when it isn't there,
   * so the caller can 404 rather than leak a filesystem error.
   */
  async read(name: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(name));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.warn(`Failed reading stored image ${name}: ${code}`);
      }
      return null;
    }
  }
}
