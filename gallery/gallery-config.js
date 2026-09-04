(function exposeGalleryConfig() {
  const CACHE_PREFIX = "notion-gallery-cache-v2:";

  const DEFAULT_CONFIG = {
    images: [],
    layout: "carousel",
    imageSizing: "cover",
    autoplayMs: 3000,
    transitionMs: 500,
    showDots: true,
    showCounter: true,
    verticalCardRadius: 24,
    overlayArrows: false,
    dropShadow: false,
    transparentBackground: false,
    slideBackground: "#f8cc82",
    widgetBackground: "#f8cc82",
    arrowColor: "#191919",
    dotsColor: "#191919",
  };

  function createDefaultConfig() {
    return {
      ...DEFAULT_CONFIG,
      images: [],
    };
  }

  function validColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  }

  function sanitizeConfig(value) {
    const defaults = createDefaultConfig();
    if (!value || typeof value !== "object") return defaults;

    const images = Array.isArray(value.images)
      ? value.images
          .filter(
            (image) =>
              image &&
              (typeof image.path === "string" || typeof image.src === "string"),
          )
          .slice(0, 20)
          .map((image, index) => ({
            id: String(image.id || `image-${index}`),
            path: typeof image.path === "string" ? image.path : "",
            src: typeof image.src === "string" ? image.src : "",
            name: String(image.name || `Image ${index + 1}`),
            alt: String(image.alt || image.name || `Image ${index + 1}`),
          }))
      : defaults.images;

    return {
      images,
      layout: ["carousel", "visual-board", "fan-stack", "vertical-board"].includes(
        value.layout,
      )
        ? value.layout
        : defaults.layout,
      imageSizing: ["cover", "contain"].includes(value.imageSizing)
        ? value.imageSizing
        : defaults.imageSizing,
      autoplayMs: [0, 10000, 5000, 3000, 2000, 1000].includes(
        Number(value.autoplayMs),
      )
        ? Number(value.autoplayMs)
        : defaults.autoplayMs,
      transitionMs: [3000, 2000, 1000, 500, 300, 200, 100].includes(
        Number(value.transitionMs),
      )
        ? Number(value.transitionMs)
        : defaults.transitionMs,
      showDots:
        typeof value.showDots === "boolean" ? value.showDots : defaults.showDots,
      showCounter:
        typeof value.showCounter === "boolean"
          ? value.showCounter
          : defaults.showCounter,
      verticalCardRadius: Number.isFinite(Number(value.verticalCardRadius))
        ? Math.min(48, Math.max(0, Math.round(Number(value.verticalCardRadius))))
        : defaults.verticalCardRadius,
      overlayArrows:
        typeof value.overlayArrows === "boolean"
          ? value.overlayArrows
          : defaults.overlayArrows,
      dropShadow:
        typeof value.dropShadow === "boolean"
          ? value.dropShadow
          : defaults.dropShadow,
      transparentBackground:
        typeof value.transparentBackground === "boolean"
          ? value.transparentBackground
          : defaults.transparentBackground,
      slideBackground: validColor(value.slideBackground, defaults.slideBackground),
      widgetBackground: validColor(value.widgetBackground, defaults.widgetBackground),
      arrowColor: validColor(value.arrowColor, defaults.arrowColor),
      dotsColor: validColor(value.dotsColor, defaults.dotsColor),
    };
  }

  function serializeConfig(value) {
    const config = sanitizeConfig(value);
    return {
      version: 4,
      ...config,
      images: config.images.map(({ id, path, name, alt }) => ({
        id,
        path,
        name,
        alt,
      })),
    };
  }

  function getCacheKey(galleryId) {
    return `${CACHE_PREFIX}${galleryId}`;
  }

  function loadCachedConfig(galleryId) {
    if (!galleryId) return null;
    try {
      const value = localStorage.getItem(getCacheKey(galleryId));
      return value ? sanitizeConfig(JSON.parse(value)) : null;
    } catch {
      return null;
    }
  }

  function saveCachedConfig(galleryId, value) {
    if (!galleryId) return;
    try {
      localStorage.setItem(
        getCacheKey(galleryId),
        JSON.stringify(sanitizeConfig(value)),
      );
    } catch {
      // The remote copy remains authoritative when browser storage is unavailable.
    }
  }

  window.GalleryConfig = {
    createDefaultConfig,
    loadCachedConfig,
    sanitizeConfig,
    saveCachedConfig,
    serializeConfig,
  };
})();
