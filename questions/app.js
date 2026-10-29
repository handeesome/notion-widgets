(() => {
  "use strict";
  const KEY = "notion-question-cards-v1";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cloudMode = params.has("id");
  const cloud = cloudMode ? window.QuestionCloud?.create(location.search) : null;
  const theme = params.get("theme");
  if (["light", "dark"].includes(theme)) document.documentElement.dataset.theme = theme;
  const manageParams = new URLSearchParams();
  if (cloudMode) manageParams.set("id", params.get("id"));
  if (["light", "dark"].includes(theme)) manageParams.set("theme", theme);
  $("manage-questions").href = `./dashboard.html${manageParams.size ? `?${manageParams}` : ""}`;
  const defaults = [...new Set((window.QUESTION_CARDS || []).filter((q) => typeof q === "string").map((q) => q.trim()).filter(Boolean))];
  let questions = cloudMode ? [] : defaults;
  let customQuestions = null;
  let questionMeta = [];
  let remaining = questions.map((_, i) => i);
  let current = null;
  let revealed = false;
  let mode = params.get("mode") || "box";
  let revision = -1;
  let ready = !cloudMode;
  let writing = false;
  let syncing = false;
  let queued = false;
  let flipping = false;
  let flipTimer;

  function warning() {
    $("storage-note").hidden = false;
    $("storage-note").textContent = "当前浏览器无法保存进度，刷新后会重置。";
  }
  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      const custom = Array.isArray(saved?.questions) ? saved.questions.filter((q) => typeof q === "string" && q.trim()) : [];
      questions = custom.length ? [...new Set(custom)] : defaults;
      customQuestions = custom.length ? questions : null;
      questionMeta = Array.isArray(saved?.questionMeta) ? saved.questionMeta : [];
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
    try { localStorage.setItem(KEY, JSON.stringify({ questions: customQuestions, questionMeta, source: questions, mode, remaining, current, revealed })); }
    catch { warning(); }
  }
  function message(text) { $("sync-status").textContent = text; $("sync-status").hidden = !text; }
  function connected() { message(""); }
  function render(animate = false) {
    document.documentElement.dataset.mode = mode;
    document.querySelectorAll('[name="mode"]').forEach((input) => { input.checked = input.value === mode; });
    const open = current !== null && revealed;
    const card = $("card");
    const changed = card.classList.contains("is-revealed") !== open;
    const newQuestion = open && $("question-text").textContent !== questions[current];
    const motion = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    clearTimeout(flipTimer);
    flipping = false;
    card.classList.remove("box-opening", "cycle");
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
    } else {
      show(open, motion && mode === "card");
      if (motion && mode === "card" && (changed || newQuestion)) {
        if (!changed && newQuestion) { void card.offsetWidth; card.classList.add("cycle"); }
        flipping = true;
        flipTimer = setTimeout(() => { card.classList.remove("cycle"); flipping = false; updateDisabled(); }, 650);
      }
    }
    $("card-note").textContent = "听听彼此的答案";
    $("invitation-title").textContent = ready ? "留一点好奇，打开聊聊。" : "连接你的问题盲盒。";
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
    questions = deck.questions; remaining = deck.remaining; current = deck.current;
    revealed = deck.revealed; revision = deck.revision;
    render(animate && wasLoaded && !document.hidden);
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
  $("card-action").addEventListener("click", () => {
    if (!ready || writing || flipping || !questions.length) return;
    if (cloudMode) return current === null ? change("draw", true) : revealed ? change("draw", false) : change("reveal");
    if (current === null) drawLocal(true);
    else if (revealed) drawLocal(false);
    else revealed = true;
    render(true); persist();
  });
  document.querySelectorAll('[name="mode"]').forEach((input) => input.addEventListener("change", () => {
    mode = input.value; render(false); persist();
  }));
  if (cloudMode) {
    void refresh(false);
    const unsubscribe = cloud?.subscribe(() => { void refresh(true); }, () => {});
    const poll = setInterval(() => { if (!document.hidden) void refresh(true); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(false); });
    window.addEventListener("focus", () => { void refresh(false); });
    window.addEventListener("beforeunload", () => { unsubscribe?.(); clearInterval(poll); });
  } else {
    loadLocal();
    window.addEventListener("storage", (event) => { if (event.key === KEY) { loadLocal(); render(false); } });
  }
  if (!["card", "box"].includes(mode)) mode = "box";
  render(false);
})();
