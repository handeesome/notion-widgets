const imageList = document.querySelector("[data-image-list]");
const uploadButton = document.querySelector("[data-upload-button]");
const uploadInput = document.querySelector("[data-upload-input]");
const replaceInput = document.querySelector("[data-replace-input]");
const preview = document.querySelector("[data-preview]");
const status = document.querySelector("[data-status]");
const connectionStatus = document.querySelector("[data-connection-status]");
const settings = document.querySelector(".settings");
const colorPopover = document.querySelector("[data-color-popover]");
const colorSpectrum = colorPopover.querySelector(".color-spectrum");
const spectrumMarker = colorPopover.querySelector(".spectrum-marker");
const currentColor = colorPopover.querySelector(".current-color");
const hueInput = colorPopover.querySelector("[data-hue]");
const popoverHexInput = colorPopover.querySelector("[data-popover-hex]");
const paletteGroups = colorPopover.querySelector("[data-palette-groups]");

const COLOR_PALETTES = [
  {
    name: "Notion dark",
    colors: ["#9b9a97", "#64473a", "#d9730d", "#dfab01", "#0f7b6c", "#0b6e99", "#6940a5", "#ad1a72", "#e03e3e"],
  },
  {
    name: "Notion light",
    colors: ["#f1f1ef", "#e3e2e0", "#faebdd", "#fbf3db", "#ddedea", "#ddebf1", "#eae4f2", "#f4dfeb", "#fbe4e4"],
  },
  {
    name: "Indify colors",
    colors: ["#f8cc82", "#a6c8d8", "#f5f5f5", "#d7e9f1", "#ace8b0", "#f793c1", "#f6a7a7", "#f7d6d0", "#fff2ad"],
  },
  { name: "Text defaults", colors: ["#37352f", "#191919", "#ffffff"] },
  { name: "Background defaults", colors: ["#2f3437", "#191919", "#ffffff"] },
];

const galleryId = window.GalleryData.getGalleryId();
const cachedConfig = window.GalleryConfig.loadCachedConfig(galleryId);
let client = null;
let config = cachedConfig || window.GalleryConfig.createDefaultConfig();
let replaceImageId = null;
let draggedImageId = null;
let activeColorKey = null;
let activeColorButton = null;
let activeHsv = { h: 38, s: 0.48, v: 0.97 };
let saveTimer = null;
let saveQueue = Promise.resolve();
let revision = 0;
let ready = false;
const colorFields = new Map();

settings.setAttribute("aria-disabled", "true");
settings.addEventListener("submit", (event) => event.preventDefault());

const previewUrl = new URL("./index.html", window.location.href);
previewUrl.searchParams.set("preview", "1");
if (galleryId) previewUrl.searchParams.set("id", galleryId);
else if (window.GalleryData.hasGalleryIdParameter()) previewUrl.searchParams.set("id", "invalid");
preview.src = previewUrl.href;

uploadButton.addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", async () => {
  await addFiles([...uploadInput.files]);
  uploadInput.value = "";
});

replaceInput.addEventListener("change", async () => {
  const [file] = replaceInput.files;
  if (file && replaceImageId) await replaceImage(replaceImageId, file);
  replaceImageId = null;
  replaceInput.value = "";
});

document.querySelectorAll("[data-config]").forEach((control) => {
  const key = control.dataset.config;
  const eventName = control.type === "range" ? "input" : "change";
  control.addEventListener(eventName, () => {
    if (!ready) return;
    config[key] = control.type === "checkbox" ? control.checked : control.value;
    if (["autoplayMs", "transitionMs", "verticalCardRadius"].includes(key)) {
      config[key] = Number(config[key]);
    }
    commitChange();
  });
});

document.querySelectorAll("[data-color-field]").forEach((field) => {
  const key = field.dataset.colorField;
  const textInput = field.querySelector('input[type="text"]');
  const colorButton = field.querySelector("[data-color-button]");
  const swatch = colorButton.querySelector("span");
  colorFields.set(key, { textInput, colorButton, swatch });

  colorButton.addEventListener("click", () => {
    if (!ready) return;
    if (!colorPopover.hidden && activeColorKey === key) {
      closeColorPopover();
      return;
    }
    openColorPopover(key, colorButton);
  });

  textInput.addEventListener("change", () => {
    if (!ready) return;
    const normalized = normalizeColor(textInput.value);
    if (!normalized) {
      textInput.value = config[key];
      announce("Enter a six-digit hex color, such as #f8cc82.");
      return;
    }
    applyColor(key, normalized);
  });
});

renderPaletteGroups();

hueInput.addEventListener("input", () => {
  activeHsv.h = Number(hueInput.value);
  applyColor(activeColorKey, hsvToHex(activeHsv));
});

popoverHexInput.addEventListener("change", () => {
  const normalized = normalizeColor(popoverHexInput.value);
  if (!normalized) {
    popoverHexInput.value = config[activeColorKey];
    announce("Enter a six-digit hex color, such as #f8cc82.");
    return;
  }
  applyColor(activeColorKey, normalized);
});

colorSpectrum.addEventListener("pointerdown", (event) => {
  colorSpectrum.setPointerCapture(event.pointerId);
  updateColorFromSpectrum(event);
});
colorSpectrum.addEventListener("pointermove", (event) => {
  if (colorSpectrum.hasPointerCapture(event.pointerId)) updateColorFromSpectrum(event);
});
colorSpectrum.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 0.1 : 0.02;
  if (event.key === "ArrowLeft") activeHsv.s = Math.max(0, activeHsv.s - step);
  else if (event.key === "ArrowRight") activeHsv.s = Math.min(1, activeHsv.s + step);
  else if (event.key === "ArrowUp") activeHsv.v = Math.min(1, activeHsv.v + step);
  else if (event.key === "ArrowDown") activeHsv.v = Math.max(0, activeHsv.v - step);
  else return;
  event.preventDefault();
  applyColor(activeColorKey, hsvToHex(activeHsv));
});

document.addEventListener("pointerdown", (event) => {
  if (colorPopover.hidden) return;
  if (colorPopover.contains(event.target) || activeColorButton?.contains(event.target)) return;
  closeColorPopover();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !colorPopover.hidden) {
    closeColorPopover();
    activeColorButton?.focus();
  }
});

window.addEventListener("resize", positionColorPopover);
document.querySelector(".config-pane").addEventListener("scroll", positionColorPopover);
preview.addEventListener("load", postConfigToPreview);

async function initialize() {
  renderImages();
  syncControls();

  if (!galleryId) {
    const message = window.GalleryData.hasGalleryIdParameter()
      ? "This gallery link is invalid."
      : "This gallery link is missing its ID.";
    setConnectionState("error", message);
    announce(message);
    return;
  }

  try {
    client = window.GalleryData.createClient(galleryId);
    const remoteConfig = await window.GalleryData.loadConfig(client, galleryId);
    if (!remoteConfig) {
      setConnectionState("error", "Gallery not found. Check the full link.");
      announce("Gallery not found.");
      return;
    }

    config = remoteConfig;
    window.GalleryConfig.saveCachedConfig(galleryId, config);
    ready = true;
    settings.setAttribute("aria-disabled", "false");
    renderImages();
    syncControls();
    postConfigToPreview();
    setConnectionState("ready", "Changes save automatically.");
  } catch (error) {
    console.error("Gallery setup failed", error);
    setConnectionState("error", "Couldn’t load this gallery. Check your connection and try again.");
    announce("Couldn’t load this gallery.");
  }
}

async function addFiles(files) {
  if (!ready) return;
  const availableSlots = 20 - config.images.length;
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));

  if (availableSlots <= 0) {
    announce("You can add up to 20 images.");
    return;
  }

  const acceptedFiles = imageFiles.slice(0, availableSlots);
  if (acceptedFiles.length === 0) {
    announce("Choose an image file to upload.");
    return;
  }

  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading images…";
  const uploaded = [];

  try {
    for (const file of acceptedFiles) {
      const prepared = await prepareImage(file);
      const image = await window.GalleryData.uploadImage(
        client,
        galleryId,
        prepared.blob,
        file.name,
        file.name.replace(/\.[^.]+$/, "") || "Gallery image",
      );
      uploaded.push(image);
    }

    config.images.push(...uploaded);
    renderImages();
    await commitChange({ immediate: true });
    announce(`${uploaded.length} ${uploaded.length === 1 ? "image" : "images"} added.`);
  } catch (error) {
    console.error("Image upload failed", error);
    const uploadedIds = new Set(uploaded.map((image) => image.id));
    config.images = config.images.filter((image) => !uploadedIds.has(image.id));
    revision += 1;
    reflectConfig();
    renderImages();
    await Promise.allSettled(uploaded.map((image) => window.GalleryData.removeImage(client, image.path)));
    setConnectionState("error", "Couldn’t add the image. Try again.");
    announce("Couldn’t add the image. Choose another file and try again.");
  } finally {
    uploadButton.disabled = false;
    uploadButton.innerHTML = '<span aria-hidden="true">＋</span> Upload images';
  }
}

async function replaceImage(id, file) {
  if (!ready) return;
  if (!file.type.startsWith("image/")) {
    announce("Choose an image file to upload.");
    return;
  }

  const index = config.images.findIndex((image) => image.id === id);
  if (index === -1) return;
  const previousImage = config.images[index];
  let nextImage = null;

  try {
    setConnectionState("saving", "Uploading replacement…");
    const prepared = await prepareImage(file);
    nextImage = await window.GalleryData.uploadImage(
      client,
      galleryId,
      prepared.blob,
      file.name,
      file.name.replace(/\.[^.]+$/, "") || "Gallery image",
    );
    config.images[index] = nextImage;
    renderImages();
    await commitChange({ immediate: true });
    await window.GalleryData.removeImage(client, previousImage.path).catch((error) => console.warn("Old image cleanup failed", error));
    announce("Image replaced.");
  } catch (error) {
    console.error("Image replacement failed", error);
    config.images[index] = previousImage;
    revision += 1;
    reflectConfig();
    renderImages();
    if (nextImage) await window.GalleryData.removeImage(client, nextImage.path).catch(() => {});
    setConnectionState("error", "Couldn’t replace the image. Try again.");
    announce("Couldn’t replace the image. Choose another file and try again.");
  }
}

function renderImages() {
  imageList.replaceChildren();

  if (config.images.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-images";
    empty.textContent = "No images yet";
    imageList.append(empty);
    return;
  }

  config.images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "image-card";
    card.dataset.imageId = image.id;
    card.draggable = ready;
    card.tabIndex = ready ? 0 : -1;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", `${image.name}, image ${index + 1} of ${config.images.length}`);

    const thumbnail = document.createElement("img");
    thumbnail.src = image.src;
    thumbnail.alt = "";

    const removeButton = createIconButton("×", `Remove ${image.name}`, () => removeImage(image.id));
    card.append(thumbnail, removeButton);

    card.addEventListener("click", (event) => {
      if (!ready || event.target.closest("button")) return;
      replaceImageId = image.id;
      replaceInput.click();
    });
    card.addEventListener("keydown", (event) => {
      if (!ready || event.target.closest("button")) return;
      if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        moveImage(image.id, event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        replaceImageId = image.id;
        replaceInput.click();
      }
    });
    card.addEventListener("dragstart", (event) => {
      draggedImageId = image.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", image.id);
      card.classList.add("is-dragging");
      imageList.classList.add("is-drag-active");
      event.dataTransfer.setDragImage(card, Math.round(card.offsetWidth / 2), Math.round(card.offsetHeight / 2));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("is-drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("is-drop-target");
      imageList.classList.remove("is-drag-active");
      const midpoint = card.getBoundingClientRect().top + card.offsetHeight / 2;
      reorderDroppedImage(draggedImageId, image.id, event.clientY > midpoint);
    });
    card.addEventListener("dragend", () => {
      draggedImageId = null;
      card.classList.remove("is-dragging");
      imageList.classList.remove("is-drag-active");
      document.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    });

    imageList.append(card);
  });
}

function createIconButton(text, label, action) {
  const button = document.createElement("button");
  button.className = "icon-button icon-button--remove";
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.disabled = !ready;
  button.addEventListener("click", () => void action());
  return button;
}

function moveImage(id, direction) {
  const index = config.images.findIndex((image) => image.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= config.images.length) return;
  const [image] = config.images.splice(index, 1);
  config.images.splice(nextIndex, 0, image);
  renderImages();
  commitChange();
  imageList.querySelector(`[data-image-id="${CSS.escape(id)}"]`)?.focus();
}

function reorderDroppedImage(sourceId, targetId, placeAfter) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = config.images.findIndex((image) => image.id === sourceId);
  if (sourceIndex === -1) return;
  const [movedImage] = config.images.splice(sourceIndex, 1);
  let targetIndex = config.images.findIndex((image) => image.id === targetId);
  if (placeAfter) targetIndex += 1;
  config.images.splice(targetIndex, 0, movedImage);
  renderImages();
  commitChange();
  announce("Images reordered.");
}

async function removeImage(id) {
  if (!ready) return;
  const index = config.images.findIndex((image) => image.id === id);
  if (index === -1) return;
  const previousImages = [...config.images];
  const [removedImage] = config.images.splice(index, 1);
  renderImages();

  try {
    await commitChange({ immediate: true });
    await window.GalleryData.removeImage(client, removedImage.path).catch((error) => console.warn("Image cleanup failed", error));
    announce("Image removed from the gallery.");
  } catch (error) {
    console.error("Image removal failed", error);
    config.images = previousImages;
    revision += 1;
    reflectConfig();
    renderImages();
    setConnectionState("error", "Couldn’t remove the image. Try again.");
    announce("Couldn’t remove the image. Try again.");
  }
}

async function prepareImage(file) {
  const source = await loadImage(file);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image could not be converted"))), "image/webp", 0.86);
  });
  return { blob };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be read"));
    };
    image.src = url;
  });
}

function renderPaletteGroups() {
  for (const palette of COLOR_PALETTES) {
    const group = document.createElement("section");
    group.className = "palette-group";
    const title = document.createElement("h3");
    title.textContent = palette.name;
    const row = document.createElement("div");
    row.className = "palette-row";

    for (const color of palette.colors) {
      const swatch = document.createElement("button");
      swatch.className = "palette-swatch";
      swatch.type = "button";
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.setAttribute("aria-label", `Use ${palette.name} color ${color}`);
      swatch.setAttribute("aria-pressed", "false");
      swatch.addEventListener("click", () => applyColor(activeColorKey, color));
      row.append(swatch);
    }

    group.append(title, row);
    paletteGroups.append(group);
  }
}

function syncControls() {
  document.querySelectorAll("[data-config]").forEach((control) => {
    const key = control.dataset.config;
    if (control.type === "checkbox") control.checked = Boolean(config[key]);
    else control.value = String(config[key]);
  });
  for (const [key, field] of colorFields) {
    field.textInput.value = config[key];
    field.swatch.style.backgroundColor = config[key];
  }
  syncConfigOutputs();
  syncLayoutControls();
}

function syncLayoutControls() {
  setConditionalControls("[data-carousel-only]", config.layout !== "carousel");
  setConditionalControls("[data-navigation-only]", config.layout === "visual-board");
  setConditionalControls("[data-vertical-only]", config.layout !== "vertical-board");
}

function setConditionalControls(selector, disabled) {
  document.querySelectorAll(selector).forEach((field) => {
    field.dataset.disabled = String(disabled);
    field.setAttribute("aria-disabled", String(disabled));
    field.querySelectorAll("input, button, select").forEach((control) => {
      control.disabled = disabled;
    });
  });
}

function syncConfigOutputs() {
  document.querySelectorAll("[data-config-output]").forEach((output) => {
    output.value = String(config[output.dataset.configOutput]);
  });
}

function openColorPopover(key, button) {
  activeColorKey = key;
  activeColorButton = button;
  colorPopover.hidden = false;
  updatePicker(config[key]);
  positionColorPopover();
}

function closeColorPopover() {
  colorPopover.hidden = true;
  activeColorKey = null;
  activeColorButton = null;
}

function positionColorPopover() {
  if (colorPopover.hidden || !activeColorButton) return;
  const anchor = activeColorButton.getBoundingClientRect();
  const width = colorPopover.offsetWidth;
  const height = colorPopover.offsetHeight;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, anchor.right - width));
  let top = anchor.bottom + 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 8);
  colorPopover.style.left = `${left}px`;
  colorPopover.style.top = `${top}px`;
}

function applyColor(key, color) {
  if (!ready || !key) return;
  config[key] = color.toLowerCase();
  const field = colorFields.get(key);
  field.textInput.value = config[key];
  field.swatch.style.backgroundColor = config[key];
  commitChange();
  if (activeColorKey === key) updatePicker(config[key]);
}

function updatePicker(color) {
  activeHsv = hexToHsv(color);
  hueInput.value = String(Math.round(activeHsv.h));
  popoverHexInput.value = color.toUpperCase();
  currentColor.style.backgroundColor = color;
  colorSpectrum.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${activeHsv.h}deg 100% 50%)`;
  spectrumMarker.style.left = `${activeHsv.s * 100}%`;
  spectrumMarker.style.top = `${(1 - activeHsv.v) * 100}%`;
  colorSpectrum.setAttribute("aria-valuenow", String(Math.round(activeHsv.v * 100)));
  document.querySelectorAll(".palette-swatch").forEach((swatch) => {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color.toLowerCase() === color.toLowerCase()));
  });
}

function updateColorFromSpectrum(event) {
  const rect = colorSpectrum.getBoundingClientRect();
  activeHsv.s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  activeHsv.v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  applyColor(activeColorKey, hsvToHex(activeHsv));
}

function hexToHsv(hex) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }) {
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = v - chroma;
  let channels;
  if (segment < 1) channels = [chroma, x, 0];
  else if (segment < 2) channels = [x, chroma, 0];
  else if (segment < 3) channels = [0, chroma, x];
  else if (segment < 4) channels = [0, x, chroma];
  else if (segment < 5) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];
  return `#${channels.map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function normalizeColor(value) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return null;
}

function commitChange({ immediate = false } = {}) {
  revision += 1;
  reflectConfig();
  if (immediate) {
    window.clearTimeout(saveTimer);
    return persistConfig(config, revision);
  }
  scheduleSave();
  return Promise.resolve();
}

function reflectConfig() {
  config = window.GalleryConfig.sanitizeConfig(config);
  syncConfigOutputs();
  syncLayoutControls();
  window.GalleryConfig.saveCachedConfig(galleryId, config);
  postConfigToPreview();
  window.opener?.postMessage({ type: "gallery-config", galleryId, config }, window.location.origin);
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setConnectionState("saving", "Saving changes…");
  const scheduledRevision = revision;
  const snapshot = window.GalleryConfig.sanitizeConfig(config);
  saveTimer = window.setTimeout(() => {
    persistConfig(snapshot, scheduledRevision).catch(() => {});
  }, 450);
}

function persistConfig(snapshot, snapshotRevision) {
  if (!ready || !client) return Promise.reject(new Error("Gallery is not ready"));
  setConnectionState("saving", "Saving changes…");
  const task = saveQueue.then(() => window.GalleryData.saveConfig(client, galleryId, snapshot));
  saveQueue = task.catch(() => {});
  return task
    .then(() => {
      if (snapshotRevision === revision) setConnectionState("ready", "Changes saved.");
    })
    .catch((error) => {
      if (snapshotRevision === revision) {
        setConnectionState("error", "Couldn’t save changes. Check your connection and try again.");
        announce("Couldn’t save changes.");
      }
      throw error;
    });
}

function postConfigToPreview() {
  preview.contentWindow?.postMessage({ type: "gallery-config", galleryId, config }, window.location.origin);
}

function setConnectionState(state, message) {
  connectionStatus.dataset.state = state;
  connectionStatus.textContent = message;
}

function announce(message) {
  status.textContent = "";
  window.requestAnimationFrame(() => {
    status.textContent = message;
  });
}

initialize();
