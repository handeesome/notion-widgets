const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const gallery = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(gallery, file), "utf8");
const galleryId = "12345678-1234-4123-8123-123456789abc";
const imageId = "87654321-1234-4123-8123-123456789abc";

// Simulate codec outcomes, including Safari's PNG fallback, without a network service.
function environment(options = {}) {
  const revoked = [];
  const draws = [];
  const uploads = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => options.noContext ? null : {
      drawImage: (_source, _x, _y, width, height) => draws.push([width, height]),
    },
    toBlob(callback) {
      if (options.encodeThrows) throw new Error("Canvas allocation failed");
      const size = options.oversize && draws.length === 1 ? 9 * 1024 * 1024 : 1024;
      callback(options.nullBlob ? null : { type: options.type || "image/webp", size });
    },
  };
  const images = [];
  class Image {
    naturalWidth = options.width || 4000;
    naturalHeight = options.height || 3000;
    constructor() { images.push(this); }
    set src(value) {
      this.source = value;
      if (value) queueMicrotask(() => options.decodeFails ? this.onerror() : this.onload());
    }
  }
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "gallery-images");
        return {
          upload: async (name, blob, settings) => {
            uploads.push({ name, blob, settings });
            return { error: options.uploadError || null };
          },
          getPublicUrl: (name) => ({ data: { publicUrl: `https://example.test/${name}` } }),
        };
      },
    },
  };
  const window = { GallerySupabaseConfig: { bucket: "gallery-images" } };
  const context = vm.createContext({
    window, Image,
    URL: { createObjectURL: () => "blob:test-photo", revokeObjectURL: (url) => revoked.push(url) },
    document: { createElement: () => canvas },
    crypto: { randomUUID: () => imageId },
  });
  vm.runInContext(read("gallery-images.js"), context);
  vm.runInContext(read("gallery-data.js"), context);
  return { ...window.GalleryImages, ...window.GalleryData, client, revoked, draws, uploads, canvas, images };
}

for (const [type, extension] of [["image/webp", "webp"], ["image/png", "png"]]) {
  test(`prepared ${type} uploads with matching bytes metadata, path and public URL`, async () => {
    const env = environment({ type });
    const { blob } = await env.prepareImage({ name: "IMG_1234.HEIC", type: "image/heic" });
    const result = await env.uploadImage(env.client, galleryId, blob, "IMG_1234.HEIC", "Photo");
    assert.equal(env.uploads[0].settings.contentType, type);
    assert.equal(env.uploads[0].blob, blob);
    assert.equal(result.path, `${galleryId}/${imageId}.${extension}`);
    assert.equal(result.src, `https://example.test/${result.path}`);
    assert.deepEqual(env.draws, [[1800, 1350]]);
    assert.deepEqual(env.revoked, ["blob:test-photo"]);
    assert.equal(env.canvas.width, 0);
    assert.equal(env.images[0].source, "");
  });
}

test("photo picker files without MIME types are accepted by known extension", () => {
  const env = environment();
  for (const name of ["IMG_1234.HEIC", "photo.heif", "screenshot.png", "photo.jpeg"]) {
    assert.equal(env.isImageFile({ name, type: "" }), true);
    assert.equal(env.isImageFile({ name, type: "application/octet-stream" }), true);
  }
  assert.equal(env.isImageFile({ name: "notes.txt", type: "" }), false);
  assert.equal(env.isImageFile({ name: "fake.png", type: "text/plain" }), false);
});

test("PNG fallback over the Storage limit is resized again before upload", async () => {
  const env = environment({ type: "image/png", oversize: true });
  const { blob } = await env.prepareImage({ name: "large.png", type: "image/png" });
  assert.deepEqual(env.draws, [[1800, 1350], [1350, 1013]]);
  assert.ok(blob.size <= 8 * 1024 * 1024);
});

test("small photos keep their original dimensions", async () => {
  const env = environment({ width: 800, height: 600 });
  await env.prepareImage({ name: "small.jpg", type: "image/jpeg" });
  assert.deepEqual(env.draws, [[800, 600]]);
});

test("unreadable HEIC has an actionable error and releases the object URL", async () => {
  const env = environment({ decodeFails: true });
  await assert.rejects(env.prepareImage({ name: "IMG_1234.HEIC", type: "" }), (error) => {
    assert.equal(error.code, "IMAGE_PREPARATION_FAILED");
    assert.match(error.message, /HEIC.*JPEG or PNG/);
    return true;
  });
  assert.deepEqual(env.revoked, ["blob:test-photo"]);
  assert.equal(env.uploads.length, 0);
});

for (const failure of ["nullBlob", "encodeThrows", "noContext"]) {
  test(`${failure} produces a processing error and releases canvas memory`, async () => {
    const env = environment({ [failure]: true });
    await assert.rejects(env.prepareImage({ name: "photo.jpg", type: "image/jpeg" }), (error) => {
      assert.equal(error.code, "IMAGE_PREPARATION_FAILED");
      assert.match(error.message, /JPEG or PNG/);
      return true;
    });
    assert.equal(env.canvas.width, 0);
    assert.equal(env.canvas.height, 0);
    assert.equal(env.images[0].source, "");
  });
}

test("unsupported output cannot be uploaded under a false WebP type", async () => {
  const env = environment();
  await assert.rejects(env.uploadImage(env.client, galleryId, { type: "image/heic" }, "photo.heic", "Photo"), /Unsupported/);
  assert.equal(env.uploads.length, 0);
});

test("Storage failures propagate instead of returning a photo that was never stored", async () => {
  const uploadError = new Error("Storage request failed");
  const env = environment({ uploadError });
  await assert.rejects(env.uploadImage(env.client, galleryId, { type: "image/png" }, "photo.png", "Photo"), (error) => error === uploadError);
});

test("existing-project migration installs the same save validation and upload policy as fresh setup", () => {
  const setup = read("supabase-setup.sql");
  const migration = read("supabase-image-formats-migration.sql");
  for (const expression of [
    /create or replace function public\.update_gallery[\s\S]*?\$\$;/,
    /create policy "gallery images insert by capability"[\s\S]*?\n\);/,
  ]) {
    const expected = setup.match(expression)?.[0];
    assert.ok(expected);
    assert.equal(migration.match(expression)?.[0], expected);
  }
  assert.doesNotMatch(migration, /insert into public\.galleries/i);
});
