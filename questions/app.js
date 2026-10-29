(() => {
  "use strict";
  const KEY = "notion-question-cards-v1";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cloudMode = params.has("id");
  const preview = params.get("preview") === "1";
  const cloud = cloudMode && !preview ? window.QuestionCloud?.create(location.search) : null;
  const PREVIEW_QUESTION = "这里会显示抽到的问题。";
  const copyFields = { name: ["widget-name", "名称"], frontTop: ["front-top", "封面上方"], invitation: ["invitation-title", "封面标题"], frontBottom: ["front-bottom", "封面下方"], backTop: ["back-top", "问题上方"], backBottom: ["card-note", "问题下方"] };
  let previewReady = false;
  let presentation = window.QuestionPresentation.normalize();
  let previewPresentation = null;
  let modeChosen = false;
  const theme = params.get("theme");
  if (["light", "dark"].includes(theme)) document.documentElement.dataset.theme = theme;
  const manageParams = new URLSearchParams();
  if (cloudMode) manageParams.set("id", params.get("id"));
  if (["light", "dark"].includes(theme)) manageParams.set("theme", theme);
  $("manage-questions").href = `./dashboard.html${manageParams.size ? `?${manageParams}` : ""}`;
  const defaults = [...new Set((window.QUESTION_CARDS || []).filter((q) => typeof q === "string").map((q) => q.trim()).filter(Boolean))];
  let questions = preview ? [PREVIEW_QUESTION] : cloudMode ? [] : defaults;
  let customQuestions = null;
  let questionMeta = [];
  let remaining = questions.map((_, i) => i);
  let current = null;
  let revealed = false;
  let mode = params.get("mode") || "box";
  let revision = -1;
  let ready = preview || !cloudMode;
  let writing = false;
  let syncing = false;
  let queued = false;
  let flipping = false;
  let flipTimer;
  let faceTimer;

  function warning() {
    $("storage-note").hidden = false;
    $("storage-note").textContent = "当前浏览器无法保存进度，刷新后会重置。";
  }
  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (preview) {
        presentation = window.QuestionPresentation.normalize(previewPresentation || saved?.settings);
        return;
      }
      const custom = Array.isArray(saved?.questions) ? saved.questions.filter((q) => typeof q === "string" && q.trim()) : [];
      questions = custom.length ? [...new Set(custom)] : defaults;
      customQuestions = custom.length ? questions : null;
      questionMeta = Array.isArray(saved?.questionMeta) ? saved.questionMeta : [];
      presentation = window.QuestionPresentation.normalize(previewPresentation || saved?.settings);
      if (!saved?.settings?.mode && ["card", "box"].includes(saved?.mode)) presentation.mode = saved.mode;
      remaining = questions.map((_, i) => i); current = null; revealed = false;
      if (!params.has("mode") && ["card", "box"].includes(saved?.mode)) mode = saved.mode;
      const valid = (i) => Number.isInteger(i) && i >= 0 && i < questions.length;
      if (JSON.stringify(saved?.source) === JSON.stringify(questions) && Array.isArray(saved.remaining)
        && saved.remaining.every(valid) && new Set(saved.remaining).size === saved.remaining.length
        && (saved.current === null || (valid(saved.current) && !saved.remaining.includes(saved.current)))) {
        remaining = saved.remaining; current = saved.current; revealed = current !== null && saved.revealed !== false;
      }
      if (current === null) remaining = questions.map((_, i) => i);
    } catch { warning(); }
  }
  function persist() {
    if (cloudMode) return;
    if (preview) return;
    try { localStorage.setItem(KEY, JSON.stringify({ questions: customQuestions, questionMeta, settings: { ...presentation, mode }, source: questions, mode, remaining, current, revealed })); }
    catch { warning(); }
  }
  function message(text) { $("sync-status").textContent = text; $("sync-status").hidden = !text; }
  function connected() { message(""); }
  function copy(key, value = presentation[key]) {
    const element = $(copyFields[key][0]);
    if (!preview || document.activeElement !== element) element.textContent = value;
  }
  function render(animate = false, preserveMotion = false) {
    const previousMode = document.documentElement.dataset.mode;
    if (!params.has("mode") && !modeChosen) mode = presentation.mode;
    document.documentElement.dataset.theme = ["light", "dark"].includes(theme) ? theme : "auto";
    for (const key of Object.keys(copyFields)) copy(key);
    document.documentElement.dataset.mode = mode;
    $("mode-toggle").setAttribute("aria-checked", String(mode === "box"));
    $("mode-toggle").disabled = preview && !previewReady;
    const open = current !== null && revealed;
    if (preview) for (const [key, [id]] of Object.entries(copyFields)) {
      const visible = key === "name" || (["backTop", "backBottom"].includes(key) ? open : !open);
      const editable = previewReady && visible ? "plaintext-only" : "false";
      if ($(id).contentEditable !== editable) $(id).contentEditable = editable;
      $(id).tabIndex = previewReady && visible ? 0 : -1;
    }
    const card = $("card");
    const changed = card.classList.contains("is-revealed") !== open;
    const newQuestion = open && $("question-text").textContent !== questions[current];
    const motion = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (preserveMotion && flipping && previousMode === mode) { updateDisabled(); return; }
    clearTimeout(flipTimer);
    clearTimeout(faceTimer);
    flipping = false;
    card.classList.remove("box-opening", "box-resetting", "cycle");
    function show(openFace, transition) {
      if (!transition) card.classList.add("no-motion");
      card.classList.toggle("is-revealed", openFace);
      $("card-front").setAttribute("aria-hidden", String(openFace));
      $("card-back").setAttribute("aria-hidden", String(!openFace));
      $("question-text").textContent = openFace ? questions[current] : "";
      if (!transition) { void card.offsetWidth; card.classList.remove("no-motion"); }
    }
    if (motion && changed && open && mode === "box") {
      show(false, false);
      flipping = true;
      card.classList.add("box-opening");
      flipTimer = setTimeout(() => {
        card.classList.remove("box-opening");
        show(true, false);
        flipping = false;
        updateDisabled();
      }, 600);
    } else if (motion && changed && !open && mode === "box") {
      // Let the old question leave before bringing in the next sealed box.
      flipping = true;
      card.classList.add("box-resetting");
      faceTimer = setTimeout(() => { show(false, false); }, 240);
      flipTimer = setTimeout(() => {
        card.classList.remove("box-resetting"); flipping = false; updateDisabled();
      }, 600);
    } else {
      show(open, motion && mode === "card");
      if (motion && mode === "card" && (changed || newQuestion)) {
        if (!changed && newQuestion) { void card.offsetWidth; card.classList.add("cycle"); }
        flipping = true;
        flipTimer = setTimeout(() => { card.classList.remove("cycle"); flipping = false; updateDisabled(); }, 650);
      }
    }
    copy("invitation", ready ? presentation.invitation : "连接你的问题盲盒。");
    $("card-action").setAttribute("aria-label", open ? mode === "box" ? "抽取下一个盲盒" : "抽取下一个问题" : "打开这个盲盒");
    updateDisabled();
  }
  function updateDisabled() {
    $("card-action").disabled = !ready || writing || flipping || !questions.length;
    document.querySelector(".card-scene").setAttribute("aria-busy", String(writing));
  }
  function applyDeck(deck, animate) {
    if (deck.revision <= revision) return;
    const wasLoaded = revision >= 0;
    questions = deck.questions;
    remaining = deck.remaining; current = deck.current; revealed = deck.revealed;
    revision = deck.revision;
    presentation = window.QuestionPresentation.normalize(deck.settings);
    render(animate && wasLoaded && !document.hidden, deck.last_action === "settings");
  }
  async function refresh(animate = false) {
    if (writing || syncing) { queued = true; return; }
    syncing = true;
    try {
      if (!cloud) throw new Error("云端服务未能启动，请刷新重试。");
      const deck = await cloud.load(); ready = true; applyDeck(deck, animate); connected();
    } catch (error) { ready = false; message(error.message); }
    finally {
      syncing = false; updateDisabled();
      if (queued) { queued = false; void refresh(true); }
    }
  }
  async function change(action, openImmediately = false) {
    if (!ready || writing || flipping) return;
    writing = true; updateDisabled(); message("");
    try {
      const result = await cloud.change(action, revision, { reveal: openImmediately });
      applyDeck(result.deck, true);
      if (result.status === "conflict") message("另一台设备刚刚更新了进度。已显示最新状态，请再点击卡片。");
      else connected();
    } catch (error) { ready = false; message(`${error.message} 请刷新页面确认结果。`); }
    finally { writing = false; updateDisabled(); if (queued) { queued = false; void refresh(true); } }
  }
  function drawLocal(openImmediately) {
    const previous = current;
    const newRound = !remaining.length;
    if (newRound) remaining = questions.map((_, i) => i);
    const candidates = newRound && questions.length > 1 ? remaining.filter((i) => i !== previous) : remaining;
    current = candidates[Math.floor(Math.random() * candidates.length)];
    remaining = remaining.filter((i) => i !== current); revealed = openImmediately;
  }
  function activateCard() {
    if (!ready || writing || flipping || !questions.length) return;
    if (cloudMode && !preview) return current === null ? change("draw", true) : revealed ? change("draw", false) : change("reveal");
    if (current === null) drawLocal(true);
    else if (revealed) drawLocal(false);
    else revealed = true;
    render(true); persist();
  }
  $("card-action").addEventListener("click", activateCard);
  $("mode-toggle").addEventListener("click", () => {
    if (preview && !previewReady) return;
    modeChosen = true; mode = mode === "box" ? "card" : "box";
    if (preview) {
      presentation.mode = mode;
      window.parent.postMessage({ type: "question-preview-edit", key: "mode", value: mode, commit: true }, location.origin);
    }
    render(false); persist();
  });
  if (preview) {
    document.documentElement.classList.add("preview-mode");
    $("manage-questions").hidden = true;
    $("preview-label").hidden = false;
    $("preview-heading").hidden = false;
    for (const id of ["invitation-content", "question-content"]) $(id).addEventListener("click", (event) => {
      if (event.target.closest(".preview-copy")) return;
      activateCard();
    });
    for (const [key, [id, label]] of Object.entries(copyFields)) {
      const element = $(id);
      element.classList.add("preview-copy");
      element.setAttribute("role", "textbox"); element.setAttribute("aria-label", `编辑${label}`);
      element.dataset.placeholder = label;
      element.contentEditable = "false";
      function publish(commit = false) {
        if (!previewReady) return;
        const value = element.textContent.replace(/[\r\n]+/g, " ").slice(0, 100);
        if (value !== element.textContent) element.textContent = value;
        presentation[key] = value;
        window.parent.postMessage({ type: "question-preview-edit", key, value, commit }, location.origin);
      }
      element.addEventListener("input", (event) => { if (!event.isComposing) publish(); });
      element.addEventListener("compositionend", () => publish());
      element.addEventListener("blur", () => publish(true));
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); element.blur(); }
      });
    }
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "question-preview") return;
      previewPresentation = window.QuestionPresentation.normalize(event.data.settings);
      presentation = previewPresentation;
      previewReady = event.data.ready === true;
      modeChosen = false; render(false, true);
    });
    if (window.ResizeObserver) {
      const widget = document.querySelector(".widget");
      new window.ResizeObserver(() => {
        const cardTop = document.querySelector(".card-scene").getBoundingClientRect().top + window.scrollY;
        window.parent.postMessage({ type: "question-preview-size", height: Math.max(320, Math.min(1200, Math.ceil(widget.getBoundingClientRect().height))), cardTop }, location.origin);
      }).observe(widget);
    }
  }
  if (cloudMode && !preview) {
    void refresh(false);
    const unsubscribe = cloud?.subscribe(() => { void refresh(true); }, () => {});
    const poll = setInterval(() => { if (!document.hidden) void refresh(true); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(false); });
    window.addEventListener("focus", () => { void refresh(false); });
    window.addEventListener("beforeunload", () => { unsubscribe?.(); clearInterval(poll); });
  } else {
    loadLocal();
    window.addEventListener("storage", (event) => { if (event.key === KEY) { loadLocal(); render(false, preview); } });
  }
  if (!["card", "box"].includes(mode)) mode = "box";
  render(false);
})();
