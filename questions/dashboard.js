(() => {
  "use strict";
  const KEY = "notion-question-cards-v1";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cloudMode = params.has("id");
  const cloud = cloudMode ? window.QuestionCloud?.create(location.search) : null;
  if (["light", "dark"].includes(params.get("theme"))) document.documentElement.dataset.theme = params.get("theme");
  const widgetParams = new URLSearchParams({ mode: "box" });
  if (cloudMode) widgetParams.set("id", params.get("id"));
  if (params.has("theme")) widgetParams.set("theme", params.get("theme"));
  $("widget-link").href = `./?${widgetParams}`;
  const defaults = window.QUESTION_CARDS || [];
  const eye = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  let items = [];
  let revision = -1;
  let ready = false;
  let loading = false;
  let waiting = 0;
  let tail = Promise.resolve();
  let notice = "";
  let failed = null;
  let refreshQueued = false;
  const drafts = new Map();
  const shown = new Set();
  const rows = new Map();
  const queuedUpdates = new Set();
  const stamp = (value) => value ? `添加于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}` : "添加时间未记录";
  function status() {
    $("status").textContent = waiting ? "正在保存…" : notice;
    $("retry").hidden = !failed;
    $("retry").disabled = !!waiting;
    $("add").disabled = !ready || !!waiting;
    $("import-local").disabled = !ready || !!waiting;
    $("question-count").textContent = `${items.length} 个问题`;
  }
  function localData() {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const texts = Array.isArray(saved?.questions) && saved.questions.length ? saved.questions : defaults;
    const meta = Array.isArray(saved?.questionMeta) ? saved.questionMeta : [];
    return { saved, items: texts.map((text, i) => ({ id: meta[i]?.id || `legacy-${i}`, text, created_at: meta[i]?.created_at || null })) };
  }
  function renderRows() {
    const ids = new Set(items.map((item) => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.element.remove(); rows.delete(id); shown.delete(id); }
    items.forEach((item, index) => {
      let row = rows.get(item.id);
      if (!row) {
        const element = document.createElement("article"); element.className = "question-row";
        const heading = document.createElement("div"); heading.className = "row-heading";
        const number = document.createElement("span"); number.className = "row-number";
        const controls = document.createElement("div"); controls.className = "row-controls";
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "eye-button"; toggle.innerHTML = eye;
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "移除";
        const mask = document.createElement("p"); mask.className = "masked-text"; mask.setAttribute("aria-label", "问题已隐藏");
        const input = document.createElement("textarea"); input.className = "row-input"; input.maxLength = 500; input.rows = 2;
        const time = document.createElement("time"); time.className = "row-time";
        controls.append(toggle, remove); heading.append(number, controls); element.append(heading, mask, input, time);
        row = { element, number, toggle, remove, mask, input, time };
        rows.set(item.id, row); $("question-rows").append(element);
        toggle.addEventListener("click", () => { if (shown.has(item.id)) shown.delete(item.id); else shown.add(item.id); renderRows(); });
        input.addEventListener("input", () => {
          let draft = drafts.get(item.id);
          if (!draft) { draft = { text: item.text, baseText: items.find((q) => q.id === item.id)?.text }; drafts.set(item.id, draft); }
          draft.text = input.value; clearTimeout(draft.timer);
          draft.timer = setTimeout(() => { void saveDraft(item.id); }, 700);
          notice = ""; status();
        });
        input.addEventListener("blur", () => { if (drafts.has(item.id)) void saveDraft(item.id); });
        remove.addEventListener("click", () => {
          if (waiting || !ready) return;
          const latest = items.find((q) => q.id === item.id);
          void enqueue({ kind: "remove", id: item.id, baseText: drafts.get(item.id)?.text.trim() ?? latest?.text });
        });
      }
      const text = drafts.get(item.id)?.text ?? item.text;
      const visible = shown.has(item.id);
      row.number.textContent = `问题 ${String(index + 1).padStart(2, "0")}`;
      row.toggle.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}第 ${index + 1} 条问题`);
      row.toggle.setAttribute("aria-pressed", String(visible));
      row.remove.setAttribute("aria-label", `移除第 ${index + 1} 条问题`); row.remove.disabled = !!waiting;
      row.input.setAttribute("aria-label", `编辑第 ${index + 1} 条问题`);
      row.mask.hidden = visible; row.mask.textContent = visible ? "" : "*".repeat(Array.from(text).length);
      row.input.hidden = !visible; row.input.disabled = !visible;
      if (!visible) row.input.value = "";
      else if (document.activeElement !== row.input) row.input.value = text;
      if (item.created_at) row.time.dateTime = item.created_at;
      row.time.textContent = stamp(item.created_at);
    });
    status();
  }
  function accept(deck) {
    if (deck.revision !== undefined && deck.revision < revision) return;
    items = deck.items.map((item) => ({ ...item }));
    revision = deck.revision ?? revision; ready = true; renderRows();
  }
  async function refresh() {
    if (loading || waiting) { refreshQueued = true; return; }
    loading = true;
    try {
      if (cloudMode && !cloud) throw new Error("云端服务未能启动，请刷新重试。");
      accept(cloudMode ? await cloud.load() : localData());
      $("connection").textContent = cloudMode ? "云端题库" : "本地题库";
      if (!failed) notice = "";
    } catch (error) { ready = false; notice = error.message; failed = { kind: "load" }; }
    finally { loading = false; status(); }
  }
  function nextItems(latest, op, force) {
    let next = latest.map((item) => ({ ...item }));
    if (op.kind === "add") {
      const existing = new Set(next.map((item) => item.text));
      next.push(...op.texts.filter((text) => !existing.has(text)).map((text) => ({ id: null, text, created_at: null })));
    }
    else {
      const item = next.find((q) => q.id === op.id);
      if (!item) {
        if (op.kind === "remove") return next;
        throw new Error("这条问题已被移除，你的内容仍保留在输入框中。");
      }
      if (!force && item.text !== op.baseText && !(op.kind === "update" && item.text === op.text)) throw new Error("这条问题已在别处修改。你的内容已保留，可点重试保存。");
      if (op.kind === "update") item.text = op.text.trim();
      else next = next.filter((q) => q.id !== op.id);
    }
    if (!next.length || next.length > 500 || next.some((q) => !q.text.trim() || q.text.length > 500)) throw new Error("题库需保留 1–500 个问题，每题 1–500 字。");
    if (new Set(next.map((q) => q.text.trim())).size !== next.length) throw new Error("有重复的问题，请修改后重试。");
    return next;
  }
  async function persistOperation(op, force) {
    if (cloudMode) {
      let deck = await cloud.load();
      for (let attempt = 0; attempt < 3; attempt++) {
        const next = nextItems(deck.items, op, force);
        if (JSON.stringify(next) === JSON.stringify(deck.items)) { accept(deck); return; }
        const result = await cloud.change("edit", deck.revision, { questions: next.map(({ id, text }) => ({ id, text })) });
        if (result.status === "ok") { accept(result.deck); return; }
        deck = result.deck;
      }
      throw new Error("其他设备正在更新题库，请稍后重试。");
    }
    const local = localData();
    const now = new Date().toISOString();
    const next = nextItems(local.items, op, force).map((item) => item.id ? item : { ...item, id: crypto.randomUUID(), created_at: now });
    localStorage.setItem(KEY, JSON.stringify({ questions: next.map((q) => q.text), questionMeta: next.map(({ id, created_at }) => ({ id, created_at })), source: next.map((q) => q.text), mode: local.saved?.mode || "box", current: null, revealed: false, remaining: next.map((_, i) => i) }));
    accept({ items: next });
  }
  function enqueue(op, force = false) {
    waiting++; status();
    const task = tail.then(async () => {
      try {
        await persistOperation(op, force);
        if (!failed || (failed.kind === op.kind && failed.id === op.id)) { failed = null; notice = "已保存"; }
        if (op.kind === "add" && $("new-questions").value === op.input) $("new-questions").value = "";
        if (op.kind === "remove") drafts.delete(op.id);
        return true;
      } catch (error) { notice = error.message; failed = op; return false; }
      finally { waiting--; renderRows(); if (!waiting && refreshQueued) { refreshQueued = false; void refresh(); } }
    });
    tail = task.then(() => {});
    return task;
  }
  function saveDraft(id, force = false) {
    const draft = drafts.get(id);
    if (!draft || queuedUpdates.has(id)) return Promise.resolve(false);
    clearTimeout(draft.timer); queuedUpdates.add(id);
    // Read the latest text when its turn starts, rather than overwriting typing
    // that happened while another row was being saved.
    const prepare = tail.then(async () => {
      const current = drafts.get(id);
      if (!current) return false;
      const op = { kind: "update", id, text: current.text, baseText: current.baseText };
      waiting++; status();
      try {
        await persistOperation(op, force);
        const latest = drafts.get(id);
        if (latest?.text === op.text) drafts.delete(id);
        else if (latest) latest.baseText = op.text.trim();
        if (!failed || (failed.kind === op.kind && failed.id === op.id)) { failed = null; notice = "已保存"; }
        return true;
      } catch (error) { notice = error.message; failed = op; return false; }
      finally { waiting--; renderRows(); }
    });
    tail = prepare.then(() => {});
    return prepare.then((ok) => {
      queuedUpdates.delete(id);
      if (ok && drafts.has(id)) return saveDraft(id);
      if (!waiting && refreshQueued) { refreshQueued = false; void refresh(); }
      return ok;
    });
  }
  $("add").addEventListener("click", () => {
    if (!ready || waiting) return;
    const input = $("new-questions").value;
    const texts = input.split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
    if (!texts.length) { notice = "请填写问题。"; status(); return; }
    if (new Set(texts).size !== texts.length || texts.some((text) => items.some((item) => item.text === text))) { notice = "有重复的问题。"; status(); return; }
    return enqueue({ kind: "add", texts, input });
  });
  $("retry").addEventListener("click", () => {
    if (!failed || waiting) return;
    const op = failed;
    if (op.kind === "load") { failed = null; return refresh(); }
    if (op.kind === "update") return saveDraft(op.id, true);
    return enqueue(op, true);
  });
  if (cloudMode) {
    $("connection").textContent = "云端题库";
    try { if (localData().saved?.questions?.length) $("import-local").hidden = false; } catch { /* No local storage is required for cloud use. */ }
    $("import-local").addEventListener("click", () => {
      try {
        const existing = new Set(items.map((q) => q.text));
        const texts = localData().items.map((q) => q.text).filter((text) => !existing.has(text));
        if (!texts.length) { notice = "没有新的问题可导入。"; status(); return; }
        return enqueue({ kind: "add", texts });
      } catch { notice = "无法读取本地题库。"; status(); }
    });
    const unsubscribe = cloud?.subscribe(() => { void refresh(); }, () => {});
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    window.addEventListener("beforeunload", () => { unsubscribe?.(); clearInterval(poll); });
  } else window.addEventListener("storage", (event) => { if (event.key === KEY) void refresh(); });
  window.addEventListener("beforeunload", (event) => { if (drafts.size || waiting) { event.preventDefault(); event.returnValue = ""; } });
  void refresh();
})();
