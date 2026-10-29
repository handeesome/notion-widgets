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
  let base = "";
  let dirty = false;
  let saving = false;
  let loading = false;
  let ready = !cloudMode;
  const shown = new Set();
  const signature = (list) => JSON.stringify(list.map(({ id, text, created_at }) => ({ id, text, created_at })));
  const stamp = (value) => value ? `添加于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}` : "添加时间未记录";
  function status(text) { $("status").textContent = text; }
  function buttons() {
    $("save").disabled = !ready || saving || !dirty;
    $("add").disabled = !ready || saving;
    $("reload").disabled = loading || saving;
    $("reload").textContent = dirty ? "放弃修改并重载" : "重新载入";
    $("import-local").disabled = !ready || saving;
    $("question-rows").inert = saving;
    $("new-questions").disabled = saving;
    $("question-count").textContent = `${items.length} 个问题${dirty ? " · 有未保存修改" : ""}`;
  }
  function changed() { dirty = true; status("修改尚未保存。保存后所有设备重新开始一轮。"); buttons(); }
  function renderRows() {
    $("question-rows").replaceChildren();
    items.forEach((item, index) => {
      const key = item.id || item._key;
      const row = document.createElement("article"); row.className = "question-row";
      const heading = document.createElement("div"); heading.className = "row-heading";
      const number = document.createElement("span"); number.className = "row-number"; number.textContent = `问题 ${String(index + 1).padStart(2, "0")}`;
      const controls = document.createElement("div"); controls.className = "row-controls";
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "eye-button"; toggle.innerHTML = eye;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "移除"; remove.setAttribute("aria-label", `移除第 ${index + 1} 条问题`);
      const mask = document.createElement("p"); mask.className = "masked-text"; mask.setAttribute("aria-label", "问题已隐藏");
      const input = document.createElement("textarea"); input.className = "row-input"; input.maxLength = 500; input.rows = 2; input.setAttribute("aria-label", `编辑第 ${index + 1} 条问题`);
      function visibility() {
        const visible = shown.has(key);
        mask.hidden = visible; mask.textContent = visible ? "" : "*".repeat(Array.from(item.text).length);
        input.hidden = !visible; input.disabled = !visible; input.value = visible ? item.text : "";
        toggle.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}第 ${index + 1} 条问题`);
        toggle.setAttribute("aria-pressed", String(visible));
      }
      toggle.addEventListener("click", () => { if (shown.has(key)) shown.delete(key); else shown.add(key); visibility(); });
      input.addEventListener("input", () => { item.text = input.value; changed(); });
      remove.addEventListener("click", () => { if (saving) return; items = items.filter((candidate) => candidate !== item); shown.delete(key); changed(); renderRows(); });
      const time = document.createElement("time"); time.className = "row-time";
      if (item.created_at) time.dateTime = item.created_at;
      time.textContent = item.id ? stamp(item.created_at) : "保存后记录添加时间";
      controls.append(toggle, remove); heading.append(number, controls); row.append(heading, mask, input, time);
      visibility(); $("question-rows").append(row);
    });
    buttons();
  }
  function localData() {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const texts = Array.isArray(saved?.questions) && saved.questions.length ? saved.questions : defaults;
    const meta = Array.isArray(saved?.questionMeta) ? saved.questionMeta : [];
    return { saved, items: texts.map((text, i) => ({ id: meta[i]?.id || `legacy-${i}`, text, created_at: meta[i]?.created_at || null })) };
  }
  function accept(deck, force = false) {
    if (deck.revision < revision) return;
    const nextBase = signature(deck.items);
    ready = true;
    if (dirty && !force) {
      if (nextBase === base) revision = deck.revision;
      else status("另一台设备修改了题库。你的草稿已保留，请先重新载入再编辑。");
      return;
    }
    const changedItems = nextBase !== base || force;
    revision = deck.revision; ready = true;
    if (changedItems) { items = deck.items.map((item) => ({ ...item })); base = nextBase; dirty = false; shown.clear(); renderRows(); }
    buttons();
  }
  async function reload(force = false) {
    if (loading || saving) return;
    loading = true; buttons();
    try {
      if (cloudMode) {
        if (!cloud) throw new Error("云端服务未能启动，请刷新重试。");
        const deck = await cloud.load(); accept(deck, force);
        $("connection").textContent = "云端题库";
        if (!dirty) status("题库已同步。每条问题默认隐藏。");
      } else {
        const data = localData(); items = data.items; base = signature(items); dirty = false; ready = true; shown.clear(); renderRows();
        status("每条问题默认隐藏，修改后点击「保存修改」。");
      }
    } catch (error) { ready = false; status(error.message); }
    finally { loading = false; buttons(); }
  }
  $("add").addEventListener("click", () => {
    const next = $("new-questions").value.split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
    if (!next.length || next.some((q) => q.length > 500) || items.length + next.length > 500) { status("请填写问题，每题不超过 500 字，列表最多 500 题。"); return; }
    if (new Set([...items.map((item) => item.text.trim()), ...next]).size !== items.length + next.length) { status("有重复的问题，请修改后再添加。"); return; }
    items.push(...next.map((text) => ({ id: null, _key: crypto.randomUUID(), text, created_at: null })));
    $("new-questions").value = ""; changed(); renderRows();
  });
  $("save").addEventListener("click", async () => {
    if (!ready || saving || !dirty) return;
    const payload = items.map(({ id, text }) => ({ id, text: text.trim() }));
    if (!payload.length || payload.length > 500 || payload.some((item) => !item.text || item.text.length > 500)
      || new Set(payload.map((item) => item.text)).size !== payload.length) { status("请保留 1–500 个不同的问题，每题 1–500 字。"); return; }
    saving = true; buttons(); status("正在保存…");
    try {
      if (cloudMode) {
        let result = await cloud.change("edit", revision, { questions: payload });
        // A draw on another device must not require discarding an unchanged question list.
        if (result.status === "conflict" && signature(result.deck.items) === base) result = await cloud.change("edit", result.deck.revision, { questions: payload });
        if (result.status === "conflict") { status("另一台设备修改了题库。草稿已保留，请重新载入后再编辑。"); return; }
        accept(result.deck, true);
      } else {
        const previous = localData();
        if (signature(previous.items) !== base) { status("另一个页面修改了题库。草稿已保留，请重新载入后再编辑。"); return; }
        const now = new Date().toISOString();
        const nextItems = items.map((item) => ({ id: item.id || crypto.randomUUID(), text: item.text.trim(), created_at: item.id ? item.created_at : now }));
        localStorage.setItem(KEY, JSON.stringify({ questions: nextItems.map((item) => item.text), questionMeta: nextItems.map(({ id, created_at }) => ({ id, created_at })), source: nextItems.map((item) => item.text), mode: previous.saved?.mode || "box", current: null, revealed: false, remaining: nextItems.map((_, i) => i) }));
        items = nextItems; base = signature(items); dirty = false; shown.clear(); renderRows();
      }
      status(cloudMode ? "已保存到云端，所有设备开始新一轮。" : "已保存到当前浏览器，开始新一轮。");
    } catch (error) { status(`${error.message} 草稿已保留，请重新载入确认是否保存成功。`); }
    finally { saving = false; buttons(); }
  });
  $("reload").addEventListener("click", () => { void reload(true); });
  if (cloudMode) {
    $("connection").textContent = "正在连接云端";
    $("help").textContent = "保存后会同步到使用同一专属链接的所有设备，并重新开始一轮。请只把完整链接分享给一起使用的人。";
    try { if (localData().saved?.questions?.length) $("import-local").hidden = false; } catch { /* Cloud access does not require local storage. */ }
    $("import-local").addEventListener("click", () => {
      try { items = localData().items.map((item) => ({ id: null, _key: crypto.randomUUID(), text: item.text, created_at: null })); shown.clear(); changed(); renderRows(); status("已填入此设备的本地题库，点击「保存修改」后同步到云端。"); }
      catch { status("无法读取本地题库。"); }
    });
    const unsubscribe = cloud?.subscribe(() => { void reload(false); }, () => {});
    const poll = setInterval(() => { if (!document.hidden) void reload(false); }, 5000);
    window.addEventListener("beforeunload", () => { unsubscribe?.(); clearInterval(poll); });
  }
  window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  void reload(true);
})();
