const widget = document.querySelector(".gallery-widget");
const viewport = document.querySelector(".viewport");
const track = document.querySelector(".track");
const dotsContainer = document.querySelector(".dots");
const previousButton = document.querySelector(".arrow--previous");
const nextButton = document.querySelector(".arrow--next");
const configureLink = document.querySelector(".configure-link");
const status = document.querySelector("[data-status]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const galleryId = window.GalleryData.getGalleryId();
const cachedConfig = window.GalleryConfig.loadCachedConfig(galleryId);

let client = null;
let config = cachedConfig || window.GalleryConfig.createDefaultConfig();
let galleryState = cachedConfig ? "ready" : "loading";
let slides = [];
let dots = [];
let currentIndex = 0;
let pointerStartX = null;
let pointerStartY = null;
let autoplayTimer = null;
let wrapTimer = null;
let wrapping = false;
let refreshInFlight = false;
let hasUsableConfig = Boolean(cachedConfig);
const pauseReasons = new Set();

widget.dataset.preview = String(
  new URLSearchParams(window.location.search).get("preview") === "1",
);

if (galleryId) {
  const configureUrl = new URL("./configure.html", window.location.href);
  configureUrl.search = "";
  configureUrl.searchParams.set("id", galleryId);
  configureLink.href = configureUrl.href;
} else {
  configureLink.hidden = true;
  galleryState = window.GalleryData.hasGalleryIdParameter() ? "invalid" : "missing";
}

previousButton.addEventListener("click", () => showSlide(currentIndex - 1));
nextButton.addEventListener("click", () => showSlide(currentIndex + 1));

widget.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showSlide(currentIndex - 1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    showSlide(currentIndex + 1);
  }

  if (event.key === "Home") {
    event.preventDefault();
    showSlide(0);
  }

  if (event.key === "End") {
    event.preventDefault();
    showSlide(slides.length - 1);
  }
});

widget.addEventListener("mouseenter", () => pauseAutoplay("hover"));
widget.addEventListener("mouseleave", () => resumeAutoplay("hover"));
widget.addEventListener("focusin", () => pauseAutoplay("focus"));
widget.addEventListener("focusout", () => {
  window.requestAnimationFrame(() => {
    if (!widget.contains(document.activeElement)) resumeAutoplay("focus");
  });
});

viewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pauseAutoplay("pointer");
  viewport.setPointerCapture?.(event.pointerId);
});

viewport.addEventListener("pointerup", (event) => {
  if (pointerStartX === null || pointerStartY === null) return;

  const distanceX = event.clientX - pointerStartX;
  const distanceY = event.clientY - pointerStartY;
  pointerStartX = null;
  pointerStartY = null;
  resumeAutoplay("pointer");

  if (Math.abs(distanceX) < 40 || Math.abs(distanceX) <= Math.abs(distanceY)) {
    return;
  }

  showSlide(currentIndex + (distanceX < 0 ? 1 : -1));
});

viewport.addEventListener("pointercancel", resetPointer);
viewport.addEventListener("lostpointercapture", resetPointer);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseAutoplay("visibility");
  } else {
    resumeAutoplay("visibility");
    refreshRemoteConfig();
  }
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== "gallery-config") return;
  if (event.data.galleryId && event.data.galleryId !== galleryId) return;
  galleryState = "ready";
  hasUsableConfig = true;
  applyConfig(window.GalleryConfig.sanitizeConfig(event.data.config));
  window.GalleryConfig.saveCachedConfig(galleryId, config);
});

reducedMotion.addEventListener?.("change", restartAutoplay);

function applyConfig(nextConfig) {
  config = nextConfig;
  currentIndex = Math.min(currentIndex, Math.max(config.images.length - 1, 0));
  cancelWrap();

  const root = document.documentElement;
  root.style.setProperty(
    "--background",
    config.transparentBackground ? "transparent" : config.widgetBackground,
  );
  root.style.setProperty("--slide-background", config.slideBackground);
  root.style.setProperty("--arrow-color", config.arrowColor);
  root.style.setProperty("--dots-color", config.dotsColor);
  root.style.setProperty("--transition-duration", `${config.transitionMs}ms`);
  widget.dataset.showDots = String(config.showDots);
  widget.dataset.overlayArrows = String(config.overlayArrows);
  widget.dataset.dropShadow = String(config.dropShadow);

  renderSlides();
  showSlide(currentIndex, { animate: false });
}

function renderSlides() {
  track.replaceChildren();
  dotsContainer.replaceChildren();

  if (config.images.length === 0) {
    const messages = {
      loading: "Loading gallery…",
      missing: "Gallery link is missing",
      invalid: "Gallery link is invalid",
      notFound: "Gallery not found",
      error: "Couldn’t load this gallery",
      ready: "Add images in Configure",
    };
    const emptyState = document.createElement("div");
    emptyState.className = "empty-gallery";
    emptyState.textContent = messages[galleryState] || messages.ready;
    track.append(emptyState);
  }

  const hasMultipleImages = config.images.length > 1;
  if (hasMultipleImages) {
    track.append(createSlide(config.images.at(-1), true));
  }

  for (const [index, image] of config.images.entries()) {
    track.append(createSlide(image));

    const dot = document.createElement("button");
    dot.className = "dot";
    dot.type = "button";
    dot.role = "tab";
    dot.setAttribute("aria-label", `第 ${index + 1} 张图片`);
    dot.addEventListener("click", () => showSlide(index));
    dotsContainer.append(dot);
  }

  if (hasMultipleImages) {
    track.append(createSlide(config.images[0], true));
  }

  slides = [...track.querySelectorAll(".slide:not(.slide--clone)")];
  dots = [...dotsContainer.querySelectorAll(".dot")];
  previousButton.hidden = !hasMultipleImages;
  nextButton.hidden = !hasMultipleImages;
}

function createSlide(image, clone = false) {
  const slide = document.createElement("figure");
  slide.className = `slide${clone ? " slide--clone" : ""}`;
  if (clone) slide.setAttribute("aria-hidden", "true");

  const element = document.createElement("img");
  element.src = image.src;
  element.alt = clone ? "" : image.alt;
  element.draggable = false;
  element.style.objectFit = config.imageSizing;
  slide.append(element);
  return slide;
}

function resetPointer() {
  pointerStartX = null;
  pointerStartY = null;
  resumeAutoplay("pointer");
}

function showSlide(nextIndex, { animate = true } = {}) {
  if (slides.length === 0) {
    track.style.transform = "translate3d(0, 0, 0)";
    status.textContent = track.textContent;
    restartAutoplay();
    return;
  }

  if (wrapping) return;

  const previousIndex = currentIndex;
  const wrapsForward =
    slides.length > 1 && previousIndex === slides.length - 1 && nextIndex >= slides.length;
  const wrapsBackward = slides.length > 1 && previousIndex === 0 && nextIndex < 0;
  currentIndex = (nextIndex + slides.length) % slides.length;
  let physicalIndex = slides.length > 1 ? currentIndex + 1 : currentIndex;
  if (wrapsForward) physicalIndex = slides.length + 1;
  if (wrapsBackward) physicalIndex = 0;
  setTrackPosition(physicalIndex, animate);

  slides.forEach((slide, index) => {
    slide.setAttribute("aria-hidden", String(index !== currentIndex));
  });

  dots.forEach((dot, index) => {
    dot.setAttribute("aria-selected", String(index === currentIndex));
    dot.tabIndex = index === currentIndex ? 0 : -1;
  });

  status.textContent = `正在显示第 ${currentIndex + 1} 张图片，共 ${slides.length} 张。`;
  restartAutoplay();

  if (wrapsForward || wrapsBackward) {
    if (!animate || reducedMotion.matches) {
      setTrackPosition(currentIndex + 1, false);
      return;
    }

    wrapping = true;
    wrapTimer = window.setTimeout(finishWrap, config.transitionMs + 40);
  }
}

function setTrackPosition(physicalIndex, animate) {
  if (!animate) track.classList.add("is-jumping");
  else track.classList.remove("is-jumping");
  track.style.transform = `translate3d(-${physicalIndex * 100}%, 0, 0)`;

  if (!animate) {
    track.getBoundingClientRect();
    window.requestAnimationFrame(() => track.classList.remove("is-jumping"));
  }
}

function finishWrap() {
  window.clearTimeout(wrapTimer);
  wrapTimer = null;
  wrapping = false;
  setTrackPosition(currentIndex + 1, false);
  restartAutoplay();
}

function cancelWrap() {
  window.clearTimeout(wrapTimer);
  wrapTimer = null;
  wrapping = false;
}

function pauseAutoplay(reason) {
  pauseReasons.add(reason);
  window.clearTimeout(autoplayTimer);
}

function resumeAutoplay(reason) {
  pauseReasons.delete(reason);
  restartAutoplay();
}

function restartAutoplay() {
  window.clearTimeout(autoplayTimer);

  if (
    pauseReasons.size > 0 ||
    document.hidden ||
    reducedMotion.matches ||
    config.autoplayMs === 0 ||
    slides.length < 2
  ) {
    return;
  }

  autoplayTimer = window.setTimeout(() => {
    showSlide(currentIndex + 1);
  }, config.autoplayMs);
}

async function refreshRemoteConfig() {
  if (!galleryId || !client || refreshInFlight || document.hidden) return;
  refreshInFlight = true;
  try {
    const remoteConfig = await window.GalleryData.loadConfig(client, galleryId);
    if (!remoteConfig) {
      galleryState = "notFound";
      if (!hasUsableConfig) applyConfig(window.GalleryConfig.createDefaultConfig());
      return;
    }
    galleryState = "ready";
    hasUsableConfig = true;
    applyConfig(remoteConfig);
    window.GalleryConfig.saveCachedConfig(galleryId, remoteConfig);
  } catch (error) {
    console.error("Gallery load failed", error);
    galleryState = "error";
    if (!hasUsableConfig) applyConfig(window.GalleryConfig.createDefaultConfig());
  } finally {
    refreshInFlight = false;
  }
}

applyConfig(config);

if (galleryId) {
  try {
    client = window.GalleryData.createClient(galleryId);
    refreshRemoteConfig();
    window.setInterval(refreshRemoteConfig, 60_000);
  } catch (error) {
    console.error("Gallery service failed to start", error);
    galleryState = "error";
    applyConfig(config);
  }
}
