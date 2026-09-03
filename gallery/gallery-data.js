(function exposeGalleryData() {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const connection = window.GallerySupabaseConfig;

  function getGalleryId() {
    const value = new URLSearchParams(window.location.search).get("id")?.trim();
    return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
  }

  function hasGalleryIdParameter() {
    return new URLSearchParams(window.location.search).has("id");
  }

  function createClient(galleryId) {
    if (!window.supabase?.createClient) {
      throw new Error("The gallery service could not start.");
    }
    if (!connection?.url || !connection?.publishableKey) {
      throw new Error("Supabase is not configured.");
    }

    return window.supabase.createClient(connection.url, connection.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-gallery-id": galleryId } },
    });
  }

  function publicUrl(client, path) {
    return client.storage.from(connection.bucket).getPublicUrl(path).data.publicUrl;
  }

  function hydrateConfig(client, value) {
    const config = window.GalleryConfig.sanitizeConfig(value);
    config.images = config.images.map((image) => ({
      ...image,
      src: image.path ? publicUrl(client, image.path) : image.src,
    }));
    return config;
  }

  async function loadConfig(client, galleryId) {
    const { data, error } = await client.rpc("get_gallery", { p_id: galleryId });
    if (error) throw error;
    if (!data) return null;
    return hydrateConfig(client, data);
  }

  async function saveConfig(client, galleryId, config) {
    const payload = window.GalleryConfig.serializeConfig(config);
    const { data, error } = await client.rpc("update_gallery", {
      p_id: galleryId,
      p_config: payload,
    });
    if (error) throw error;
    return hydrateConfig(client, data);
  }

  async function uploadImage(client, galleryId, blob, name, alt) {
    const imageId = crypto.randomUUID();
    const path = `${galleryId}/${imageId}.webp`;
    const { error } = await client.storage.from(connection.bucket).upload(path, blob, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    });
    if (error) throw error;

    return {
      id: imageId,
      path,
      src: publicUrl(client, path),
      name,
      alt,
    };
  }

  async function removeImage(client, path) {
    if (!path) return;
    const { error } = await client.storage.from(connection.bucket).remove([path]);
    if (error) throw error;
  }

  window.GalleryData = {
    createClient,
    getGalleryId,
    hasGalleryIdParameter,
    loadConfig,
    removeImage,
    saveConfig,
    uploadImage,
  };
})();
