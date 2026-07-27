import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkImageUpload,
  isStoredImageName,
  sniffImageType,
} from "../src/uploads/image-validation.js";

/**
 * Upload sniffing (Phase 6.1) — the gate that runs before anything is decoded
 * or written. Pure, so it needs neither sharp nor a filesystem.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // size field, skipped
  Buffer.from("WEBP"),
]);

describe("sniffImageType", () => {
  it("recognises the three accepted formats by their signatures", () => {
    assert.equal(sniffImageType(JPEG), "image/jpeg");
    assert.equal(sniffImageType(PNG), "image/png");
    assert.equal(sniffImageType(WEBP), "image/webp");
  });

  it("rejects a GIF — accepted formats only, no silent de-animation", () => {
    assert.equal(sniffImageType(Buffer.from("GIF89a...")), null);
  });

  it("rejects executables and scripts whatever they are named", () => {
    // The whole point: a PHP payload called avatar.jpg is still a PHP payload.
    assert.equal(sniffImageType(Buffer.from("<?php system($_GET[0]); ?>")), null);
    assert.equal(sniffImageType(Buffer.from("MZ\x90\x00")), null); // PE/EXE
    assert.equal(sniffImageType(Buffer.from("#!/bin/sh\nrm -rf /")), null);
    assert.equal(sniffImageType(Buffer.from("<svg onload=alert(1)>")), null);
  });

  it("rejects a RIFF container that isn't WebP (e.g. a WAV)", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE"),
    ]);
    assert.equal(sniffImageType(wav), null);
  });

  it("handles buffers shorter than the signatures without throwing", () => {
    assert.equal(sniffImageType(Buffer.from([0xff])), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
    assert.equal(sniffImageType(Buffer.from("RIFF")), null);
  });
});

describe("checkImageUpload", () => {
  it("accepts a real image whose declared type agrees", () => {
    const res = checkImageUpload(JPEG, "image/jpeg");
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.type, "image/jpeg");
  });

  it("tolerates parameters and casing on the declared type", () => {
    assert.equal(checkImageUpload(PNG, "IMAGE/PNG; charset=binary").ok, true);
  });

  it("rejects a disguised non-image even with a believable type", () => {
    // The DoD case: bad magic bytes, perfect-looking Content-Type.
    const res = checkImageUpload(Buffer.from("<?php ?>"), "image/jpeg");
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "UNSUPPORTED_CONTENT");
  });

  it("rejects a real image mislabelled as another type", () => {
    const res = checkImageUpload(PNG, "image/jpeg");
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "DECLARED_TYPE_MISMATCH");
  });

  it("rejects a type that isn't on the allowlist", () => {
    const res = checkImageUpload(JPEG, "image/svg+xml");
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "DECLARED_TYPE_NOT_ACCEPTED");
  });

  it("rejects a missing declared type and an empty body", () => {
    const undeclared = checkImageUpload(JPEG, undefined);
    assert.equal(undeclared.ok, false);
    assert.equal(
      undeclared.ok === false && undeclared.reason,
      "DECLARED_TYPE_NOT_ACCEPTED",
    );

    const empty = checkImageUpload(Buffer.alloc(0), "image/png");
    assert.equal(empty.ok, false);
    assert.equal(empty.ok === false && empty.reason, "EMPTY");
  });
});

describe("isStoredImageName", () => {
  it("accepts only the UUID.webp names the server generates", () => {
    assert.equal(
      isStoredImageName("f47ac10b-58cc-4372-a567-0e02b2c3d479.webp"),
      true,
    );
  });

  it("refuses traversal, absolute paths and other extensions", () => {
    for (const bad of [
      "../../.env",
      "..%2f..%2f.env",
      "/etc/passwd",
      "f47ac10b-58cc-4372-a567-0e02b2c3d479.php",
      "f47ac10b-58cc-4372-a567-0e02b2c3d479.webp.php",
      "../f47ac10b-58cc-4372-a567-0e02b2c3d479.webp",
      "not-a-uuid.webp",
      "",
    ]) {
      assert.equal(isStoredImageName(bad), false, `${bad} is refused`);
    }
  });
});
