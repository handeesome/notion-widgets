(function exposeGalleryImages() {
  const MAX_BYTES = 8 * 1024 * 1024;
  const IMAGE_EXTENSION = /\.(avif|bmp|gif|heic|heif|jpe?g|jfif|png|svg|webp)$/i;

  function isImageFile(file) {
    return file.type.startsWith("image/") ||
      ((!file.type || file.type === "application/octet-stream") && IMAGE_EXTENSION.test(file.name));
  }

  function preparationError(message) {
    const error = new Error(message);
    error.code = "IMAGE_PREPARATION_FAILED";
    return error;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      const cleanup = () => {
        URL.revokeObjectURL(url);
        image.onload = null;
        image.onerror = null;
      };
      image.onload = () => {
        cleanup();
        resolve(image);
      };
      image.onerror = () => {
        cleanup();
        const isHeic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
        reject(preparationError(isHeic
          ? "This browser can’t read this HEIC photo. Export it as JPEG or PNG, then try again."
          : "This photo couldn’t be read. Try a JPEG or PNG copy."));
      };
      image.src = url;
    });
  }

  function encode(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        // Browsers without a WebP encoder return PNG. Keep its real MIME type.
        if (blob && ["image/webp", "image/png"].includes(blob.type)) resolve(blob);
        else reject(preparationError("This photo couldn’t be converted. Try a JPEG or PNG copy."));
      }, "image/webp", 0.86);
    });
  }

  async function prepareImage(file) {
    const source = await loadImage(file);
    const canvas = document.createElement("canvas");
    try {
      const context = canvas.getContext("2d");
      if (!context || !source.naturalWidth || !source.naturalHeight) {
        throw preparationError("This photo couldn’t be processed. Try a smaller JPEG or PNG copy.");
      }
      let scale = Math.min(1, 1800 / Math.max(source.naturalWidth, source.naturalHeight));
      while (true) {
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const blob = await encode(canvas);
        if (blob.size <= MAX_BYTES) return { blob };
        if (canvas.width === 1 && canvas.height === 1) {
          throw preparationError("This photo is too large to upload. Try a smaller copy.");
        }
        scale *= 0.75;
      }
    } catch (error) {
      if (error.code === "IMAGE_PREPARATION_FAILED") throw error;
      throw preparationError("This photo couldn’t be processed. Try a smaller JPEG or PNG copy.");
    } finally {
      // Release mobile canvas and decoded-image memory between selected photos.
      canvas.width = 0;
      canvas.height = 0;
      source.src = "";
    }
  }

  window.GalleryImages = { isImageFile, prepareImage };
})();
