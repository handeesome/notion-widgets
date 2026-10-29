(() => {
  "use strict";

  const STORAGE_KEY = "notion-question-cards-v1";
  const MAX_QUESTIONS = 500;
  const MAX_LENGTH = 500;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  if (["light", "dark"].includes(theme)) document.documentElement.dataset.theme = theme;

  function cleanQuestions(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter((q) => typeof q === "string").map((q) => q.trim()).filter(Boolean))]
      : [];
  }

  const defaults = cleanQuestions(window.QUESTION_CARDS);
  let saved = null;
  let storageAvailable = true;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    storageAvailable = false;
  }
  const custom = cleanQuestions(saved?.questions);
  let questions = custom.length ? custom : defaults;
  let mode = params.get("mode") || saved?.mode;
  if (!["card", "box"].includes(mode)) mode = "box";
  let remaining = [];
  let current = null;
  let revealed = false;
  let busy = false;
  let revealTimer;
  // Only restore a deck when its source list still matches, including changed deployment defaults.
  if (saved && JSON.stringify(saved.source) === JSON.stringify(questions)) {
    const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < questions.length;
    if (Array.isArray(saved.remaining) && saved.remaining.every(validIndex)
      && new Set(saved.remaining).size === saved.remaining.length
      && (saved.current === null || (validIndex(saved.current) && !saved.remaining.includes(saved.current)))) {
      remaining = saved.remaining;
      current = saved.current;
      revealed = current !== null && saved.revealed !== false;
    }
  }
  if (current === null) remaining = questions.map((_, i) => i);

  function storageWarning() {
    $("storage-note").hidden = false;
    $("storage-note").textContent = "当前浏览器无法保存进度，刷新后会重置。你仍然可以继续抽取。";
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        questions: customQuestions, source: questions, mode, remaining, current, revealed,
      }));
    } catch {
      storageAvailable = false;
      storageWarning();
    }
  }

  let customQuestions = custom.length ? questions : null;

  function render() {
    document.documentElement.dataset.mode = mode;
    document.querySelectorAll('[name="mode"]').forEach((input) => { input.checked = input.value === mode; });
    const hasQuestion = current !== null && revealed;
    const sealed = current !== null && !revealed;
    $("invitation").hidden = hasQuestion;
    $("question").hidden = !hasQuestion;
    $("question-text").textContent = hasQuestion ? questions[current] : "";
    $("invitation-title").textContent = sealed ? "问题已经在盒子里了。"
      : mode === "box" ? "抽一个盲盒，留一点好奇。" : "从一个问题，慢慢聊起。";
    $("invitation-note").textContent = sealed
      ? mode === "box" ? "准备好了，就点一下盒子。" : "点击下方按钮，展开这张问题卡。"
      : "不急着回答，也不必有标准答案。";
    $("card-label").textContent = hasQuestion ? "留给此刻的问题" : "一段对话的开始";
    $("card-note").textContent = hasQuestion ? "听听彼此的答案" : "给彼此一点思考的时间";
    $("draw-label").textContent = !questions.length ? "还没有问题"
      : sealed ? mode === "box" ? "点击盒子打开" : "展开这张卡片"
        : hasQuestion && !remaining.length ? "开始新一轮"
        : mode === "box" ? (hasQuestion ? "再抽一个盲盒" : "抽一个盲盒")
          : hasQuestion ? "再抽一张" : "抽一张问题卡";
    $("draw").disabled = busy || !questions.length || (sealed && mode === "box");
    $("open-box").disabled = busy || !sealed || mode !== "box";
    $("progress").textContent = !questions.length ? "点击「编辑问题」添加"
      : sealed ? `本轮已抽 ${questions.length - remaining.length} / ${questions.length} · 待打开`
        : !hasQuestion ? `${questions.length} 个问题 · 随机相遇`
        : remaining.length ? `本轮已抽 ${questions.length - remaining.length} / ${questions.length}`
          : `本轮 ${questions.length} 个问题已抽完`;
    if (!questions.length) {
      $("invitation-title").textContent = "放进几个想聊的问题吧。";
      $("invitation-note").textContent = "点击下方「编辑问题」，每行写一个。";
    }
  }

  function animateQuestion() {
    const card = document.querySelector(".card");
    card.classList.remove("revealing");
    void card.offsetWidth;
    card.classList.add("revealing");
  }

  function selectQuestion() {
    // Start a fresh round only after the user asks for it. Avoid an immediate repeat across rounds.
    const previous = current;
    const newRound = !remaining.length;
    if (newRound) remaining = questions.map((_, i) => i);
    let candidates = remaining;
    if (newRound && questions.length > 1) candidates = candidates.filter((i) => i !== previous);
    current = candidates[Math.floor(Math.random() * candidates.length)];
    remaining = remaining.filter((i) => i !== current);
    revealed = mode === "card";
    document.querySelector(".card").classList.remove("revealing");
    render();
    if (revealed) animateQuestion();
    persist();
  }

  function finishReveal() {
    busy = false;
    revealed = true;
    const card = document.querySelector(".card");
    card.classList.remove("opening");
    card.setAttribute("aria-busy", "false");
    render();
    animateQuestion();
    persist();
  }

  function openCurrent() {
    if (busy || current === null || revealed) return;
    const animateBox = mode === "box" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animateBox) { finishReveal(); return; }
    busy = true;
    $("draw").disabled = true;
    $("open-box").disabled = true;
    $("draw-label").textContent = "正在打开…";
    const card = document.querySelector(".card");
    card.classList.remove("revealing");
    card.classList.add("opening");
    card.setAttribute("aria-busy", "true");
    revealTimer = setTimeout(finishReveal, 600);
  }

  $("open-box").addEventListener("click", openCurrent);
  $("draw").addEventListener("click", () => {
    if (busy || !questions.length || (current !== null && !revealed && mode === "box")) return;
    if (current !== null && !revealed) openCurrent();
    else selectQuestion();
  });

  document.querySelectorAll('[name="mode"]').forEach((input) => input.addEventListener("change", () => {
    if (busy) {
      clearTimeout(revealTimer);
      busy = false;
      document.querySelector(".card").classList.remove("opening");
      document.querySelector(".card").setAttribute("aria-busy", "false");
    }
    mode = input.value;
    render();
    persist();
  }));

  let editorDraft = "";

  function renderEditor(visible) {
    $("question-list").hidden = !visible;
    $("question-list").disabled = !visible;
    $("question-list").value = visible ? editorDraft : "";
    $("masked-questions").hidden = visible;
    $("masked-questions").textContent = visible ? "" : Array.from(editorDraft, (char) => char === "\n" ? "\n" : "*").join("");
    $("toggle-visibility").setAttribute("aria-pressed", String(visible));
    $("toggle-visibility").setAttribute("aria-label", visible ? "隐藏问题" : "显示问题");
    $("visibility-label").textContent = visible ? "隐藏问题" : "显示问题";
    $("eye-slash").setAttribute("visibility", visible ? "visible" : "hidden");
  }

  $("toggle-visibility").addEventListener("click", () => {
    const visible = !$("question-list").hidden;
    if (visible) editorDraft = $("question-list").value;
    renderEditor(!visible);
  });
  $("edit").addEventListener("click", () => {
    editorDraft = questions.join("\n");
    renderEditor(false);
    $("editor-error").textContent = "";
    $("editor").showModal();
  });
  $("close-editor").addEventListener("click", () => $("editor").close());
  $("editor").addEventListener("close", () => {
    editorDraft = "";
    renderEditor(false);
  });
  $("restore").addEventListener("click", () => {
    editorDraft = defaults.join("\n");
    renderEditor(false);
    $("editor-error").textContent = "已填入示例，点击「保存问题」后生效。";
  });
  $("editor-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("question-list").hidden) editorDraft = $("question-list").value;
    const next = cleanQuestions(editorDraft.split(/\r?\n/));
    if (!next.length || next.length > MAX_QUESTIONS || next.some((q) => q.length > MAX_LENGTH)) {
      $("editor-error").textContent = `请填写 1–${MAX_QUESTIONS} 个问题，每个不超过 ${MAX_LENGTH} 字。`;
      return;
    }
    clearTimeout(revealTimer);
    busy = false;
    document.querySelector(".card").classList.remove("opening", "revealing");
    document.querySelector(".card").setAttribute("aria-busy", "false");
    questions = next;
    customQuestions = JSON.stringify(next) === JSON.stringify(defaults) ? null : next;
    remaining = questions.map((_, i) => i);
    current = null;
    revealed = false;
    render();
    persist();
    $("editor").close();
  });

  if (!storageAvailable) storageWarning();
  render();
})();
