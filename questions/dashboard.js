(() => {
  "use strict";
  const KEY = "notion-question-cards-v1";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cloudMode = params.has("id");
  const cloud = cloudMode ? window.QuestionCloud?.create(location.search) : null;
  if (["light", "dark"].includes(params.get("theme"))) document.documentElement.dataset.theme = params.get("theme");
  const widgetParams = new URLSearchParams();
  if (cloudMode) widgetParams.set("id", params.get("id"));
  if (params.has("theme")) widgetParams.set("theme", params.get("theme"));
  $("widget-link").href = `./?${widgetParams}`;
  widgetParams.delete("theme");
  widgetParams.set("preview", "1");
  // Preview uses the real renderer but never writes draw/open state.
  const previewUrl = `./?${widgetParams}`;
  let settings = window.QuestionPresentation.normalize();
  const settingDrafts = new Map();
  const settingQueued = new Set();
  const copyKeys = new Set(["name", "frontTop", "invitation", "frontBottom", "backTop", "backBottom"]);
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
  const editing = new Set();
  const rows = new Map();
  const queuedUpdates = new Set();
  let topicFilter = "", addTopic = "", topicTarget = null;
  let batchBase = [];
  let batchRows = [];
  const batchEdits = new Map();
  const parseQuestions = (input) => [...new Set(input.split(/\r?\n/).map(q => q.replace(/^\s*(?:[•●◦▪]\s*|[-*]\s+)/, "").trim()).filter(Boolean))];
  function syncBatchRows() {
    for (const row of batchRows) if (row.item) {
      if (row.node.textContent === row.item.text) batchEdits.delete(row.item.id);
      else batchEdits.set(row.item.id, row.node.textContent);
    }
    $("batch-input").value = batchRows.filter(row => !row.item).map(row => row.node.textContent).filter(text => text.trim()).join("\n");
    notice = ""; status();
  }
  function focusBatchRow(row) {
    row.node.focus();
    const selection = window.getSelection?.();
    if (selection && document.createRange) {const range=document.createRange();range.selectNodeContents(row.node);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
  }
  function trailingBatchRow() {
    if (!batchRows.length || batchRows.at(-1).item || batchRows.at(-1).node.textContent.trim()) createBatchRow();
  }
  function createBatchRow(item = null, text = "", after = null) {
    const li = document.createElement("li"); li.textContent = text; li.contentEditable = "plaintext-only";
    li.setAttribute("role", "textbox"); li.setAttribute("aria-label", item ? `修改问题：${item.text}` : "添加新问题");
    if (!item) li.setAttribute("data-placeholder", "继续添加问题…");
    const row = {item, node:li};
    if (after) {after.node.after(li);batchRows.splice(batchRows.indexOf(after)+1,0,row);}
    else {$("batch-existing").append(li);batchRows.push(row);}
    function edit() {
      const value=li.textContent.replace(/[\r\n]+/g," ");if(value!==li.textContent)li.textContent=value;
      trailingBatchRow();syncBatchRows();
    }
    li.addEventListener("input", event => {if(!event.isComposing)edit();});
    li.addEventListener("compositionend",edit);
    li.addEventListener("keydown", event => {
      if(event.key!=="Enter"||event.isComposing)return;
      event.preventDefault();
      if(!li.textContent.trim()&&!item)return;
      const next=batchRows[batchRows.indexOf(row)+1];
      focusBatchRow(next&&!next.item&&!next.node.textContent ? next : createBatchRow(null,"",row));
      trailingBatchRow();syncBatchRows();
    });
    li.addEventListener("paste", event => {
      const pasted=event.clipboardData?.getData("text/plain");if(!pasted)return;
      event.preventDefault();
      const lines=pasted.split(/\r?\n/).map(q=>q.replace(/^\s*(?:[•●◦▪]\s*|[-*]\s+)/,"")).filter(q=>q.trim());if(!lines.length)return;
      let head=li.textContent,tail="";
      const selection=window.getSelection?.();
      if(selection?.rangeCount){const range=selection.getRangeAt(0);if(li.contains(range.startContainer)&&li.contains(range.endContainer)){const before=range.cloneRange();before.selectNodeContents(li);before.setEnd(range.startContainer,range.startOffset);const ending=range.cloneRange();ending.selectNodeContents(li);ending.setStart(range.endContainer,range.endOffset);head=before.toString();tail=ending.toString();}}
      li.textContent=head+lines[0]+(lines.length===1?tail:"");
      let last=row;for(let i=1;i<lines.length;i++)last=createBatchRow(null,lines[i]+(i===lines.length-1?tail:""),last);
      trailingBatchRow();syncBatchRows();focusBatchRow(last);
    });
    return row;
  }
  function previewSettings() {
    const value = { ...settings };
    for (const [key, draft] of settingDrafts) value[key] = draft.value;
    $("widget-preview").contentWindow?.postMessage({ type: "question-preview", settings: value, ready }, location.origin);
  }
  function renderSettings() {
    previewSettings();
  }
  function settingChanged(key, value, immediate) {
    const draft = settingDrafts.get(key) || { baseValue: settings[key] };
    draft.value = value; clearTimeout(draft.timer);
    settingDrafts.set(key, draft);
    previewSettings();
    if (immediate) void saveSetting(key);
    else draft.timer = setTimeout(() => { void saveSetting(key); }, 700);
  }
  function saveSetting(key, force = false) {
    const draft = settingDrafts.get(key);
    if (!draft || settingQueued.has(key)) return Promise.resolve(false);
    clearTimeout(draft.timer); settingQueued.add(key);
    const op = { kind: "settings", key, value: draft.value, baseValue: draft.baseValue };
    return enqueue(op, force).then((ok) => {
      settingQueued.delete(key);
      const latest = settingDrafts.get(key);
      if (ok && latest?.value === op.value) settingDrafts.delete(key);
      else if (ok && latest) latest.baseValue = op.value;
      renderSettings();
      if (ok && settingDrafts.has(key)) return saveSetting(key);
      return ok;
    });
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== $("widget-preview").contentWindow) return;
    const data = event.data;
    if (data?.type === "question-preview-size" && Number.isFinite(data.height) && data.height >= 320 && data.height <= 1200) {
      $("widget-preview").style.height = `${Math.ceil(data.height)}px`;
      if (Number.isFinite(data.cardTop) && data.cardTop >= 0 && data.cardTop <= 600) $("preview-workspace").style.setProperty("--preview-card-top", `${Math.round(data.cardTop)}px`);
      return;
    }
    if (!ready || data?.type !== "question-preview-edit" || typeof data.value !== "string" || data.value.length > 100) return;
    if (!copyKeys.has(data.key)) return;
    if (data.commit && data.key !== "mode") {
      if (settingDrafts.get(data.key)?.value === data.value) void saveSetting(data.key);
      return;
    }
    if (data.value !== (settingDrafts.get(data.key)?.value ?? settings[data.key])) settingChanged(data.key, data.value, data.key === "mode");
    if (data.commit && settingDrafts.has(data.key)) void saveSetting(data.key);
  });
  $("widget-preview").addEventListener("load", previewSettings);
  $("widget-preview").src = previewUrl;
  function resizeNewQuestions() {
    const input = $("new-questions");
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + 2}px`;
  }
  const stamp = (value) => value ? `添加于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}` : "添加时间未记录";
  function status() {
    $("status").textContent = waiting ? "正在保存…" : notice;
    $("retry").hidden = !failed;
    $("retry").disabled = !!waiting;
    $("batch-retry").hidden = !failed;
    $("batch-retry").disabled = !!waiting;
    $("add").disabled = !ready || !!waiting;
    $("open-batch").disabled = !ready;
    $("submit-batch").disabled = !ready || !!waiting;
    $("batch-status").textContent = waiting ? "正在保存…" : notice;
    $("import-local").disabled = !ready || !!waiting;
    $("question-count").textContent = `${items.length} 个问题`;
  }
  function localData() {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const texts = Array.isArray(saved?.questions) && saved.questions.length ? saved.questions : defaults;
    const meta = Array.isArray(saved?.questionMeta) ? saved.questionMeta : [];
    return { saved, settings: saved?.settings, items: texts.map((text, i) => ({ id: meta[i]?.id || `legacy-${i}`, text, created_at: meta[i]?.created_at || null, topic: meta[i]?.topic || "" })) };
  }
  function renderRows() {
    const themes = [...new Set(items.map(q=>q.topic||"未分类"))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const customThemes=themes.filter(t=>t!=="未分类");
    const addChoices=["",...new Set([...customThemes,...(addTopic?[addTopic]:[])])];
    if(customThemes.length<6)addChoices.push("__new__");
    $("new-topic").replaceChildren(...addChoices.map(t=>{const o=document.createElement("option");o.value=t;o.textContent=t==="__new__"?"＋ 新建主题":t||"未分类";return o;}));$("new-topic").value=addTopic;
    if(topicFilter&&!themes.includes(topicFilter))topicFilter="";
    $("dashboard-topic").replaceChildren(...["",...themes].map(t=>{const o=document.createElement("option");o.value=t;o.textContent=(t||"全部主题")+"（"+(t?items.filter(q=>(q.topic||"未分类")===t).length:items.length)+"）";return o;}));$("dashboard-topic").value=topicFilter;
    const ids = new Set(items.map((item) => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.element.remove(); rows.delete(id); shown.delete(id); editing.delete(id); }
    items.forEach((item, index) => {
      let row = rows.get(item.id);
      if (!row) {
        const element = document.createElement("article"); element.className = "question-row";
        const heading = document.createElement("div"); heading.className = "row-heading";
        const number = document.createElement("span"); number.className = "row-number";
        const controls = document.createElement("div"); controls.className = "row-controls";
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "eye-button"; toggle.innerHTML = eye;
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "edit-button";
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "移除";
        const mask = document.createElement("p"); mask.className = "masked-text"; mask.setAttribute("aria-label", "问题已隐藏");
        const input = document.createElement("textarea"); input.className = "row-input"; input.maxLength = 500; input.rows = 2;
        const time = document.createElement("time"); time.className = "row-time";
        controls.append(toggle, edit, remove); heading.append(number, controls); element.append(heading, mask, input, time);
        const topic = document.createElement("select");topic.className="topic-input row-topic";topic.setAttribute("aria-label","问题主题");element.append(topic);
        topic.addEventListener("change",()=>{const latest=items.find(q=>q.id===item.id);
          if(topic.value==="__new__"){topic.value=latest?.topic||"";openTopicDialog({id:item.id,baseTopic:latest?.topic||""});return;}
          void enqueue({kind:"topic",id:item.id,topic:topic.value,baseTopic:latest?.topic||""});});
        row = { element, topic, number, toggle, edit, remove, mask, input, time };
        rows.set(item.id, row); $("question-rows").append(element);
        toggle.addEventListener("click", () => {
          if (shown.has(item.id)) {
            shown.delete(item.id); editing.delete(item.id);
            if (drafts.has(item.id)) void saveDraft(item.id);
          } else shown.add(item.id);
          renderRows();
        });
        edit.addEventListener("click", () => {
          if (editing.has(item.id)) {
            editing.delete(item.id);
            if (drafts.has(item.id)) void saveDraft(item.id);
            renderRows();
          } else {
            editing.add(item.id); renderRows(); input.focus();
          }
        });
        input.addEventListener("input", () => {
          if (!editing.has(item.id)) return;
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
      row.element.hidden=!!topicFilter&&(item.topic||"未分类")!==topicFilter;
      const choices=["",...customThemes,...(customThemes.length<6?["__new__"]:[])];
      const topicSignature=JSON.stringify(choices);
      if(row.topicSignature!==topicSignature){row.topic.replaceChildren(...choices.map(t=>{const o=document.createElement("option");o.value=t;o.textContent=t==="__new__"?"＋ 新建主题":t||"未分类";return o;}));row.topicSignature=topicSignature;}
      row.topic.disabled=!ready||!!waiting;
      if(document.activeElement!==row.topic)row.topic.value=item.topic||"";
      const text = drafts.get(item.id)?.text ?? item.text;
      const visible = shown.has(item.id);
      const isEditing = visible && editing.has(item.id);
      row.number.textContent = `问题 ${String(index + 1).padStart(2, "0")}`;
      row.toggle.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}第 ${index + 1} 条问题`);
      row.toggle.setAttribute("aria-pressed", String(visible));
      row.remove.setAttribute("aria-label", `移除第 ${index + 1} 条问题`); row.remove.disabled = !!waiting;
      row.edit.hidden = !visible;
      row.edit.textContent = isEditing ? "完成" : "修改";
      row.edit.setAttribute("aria-label", `${isEditing ? "完成编辑" : "修改"}第 ${index + 1} 条问题`);
      row.input.setAttribute("aria-label", `编辑第 ${index + 1} 条问题`);
      row.mask.className = visible ? "row-question" : "masked-text";
      row.mask.setAttribute("aria-label", visible ? text : "问题已隐藏");
      row.mask.hidden = isEditing;
      row.mask.textContent = isEditing ? "" : visible ? text : "*".repeat(Array.from(text).length);
      row.input.hidden = !isEditing; row.input.disabled = !isEditing;
      if (!isEditing) row.input.value = "";
      else if (document.activeElement !== row.input) row.input.value = text;
      if (item.created_at) row.time.dateTime = item.created_at;
      row.time.textContent = stamp(item.created_at);
    });
    status();
  }
  function accept(deck) {
    if (deck.revision !== undefined && deck.revision < revision) return;
    items = deck.items.map((item) => ({ ...item }));
    settings = window.QuestionPresentation.normalize(deck.settings);
    revision = deck.revision ?? revision; ready = true; renderRows(); renderSettings();
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
    finally { loading = false; status(); renderSettings(); }
  }
  function checkTopics(next, latest) {
    const count=list=>new Set(list.map(q=>q.topic||"").filter(t=>t&&t!=="未分类")).size;
    if(count(next)>Math.max(6,count(latest)))throw new Error("最多保留 6 个主题，请选择已有主题。");
  }
  function nextItems(latest, op, force) {
    let next = latest.map((item) => ({ ...item }));
    if (op.kind === "batch") {
      for (const edit of op.updates) {
        const item = next.find(q => q.id === edit.id);
        if (!item) throw new Error("有问题已被移除，你的修改仍保留在窗口中。");
        if (!force && item.text !== edit.baseText && item.text !== edit.text.trim()) throw new Error("有问题已在别处修改。你的内容已保留，可点重试保存。");
        item.text = edit.text.trim();
      }
      const existing = new Set(next.map(q => q.text));
      next.push(...op.texts.filter(text => !existing.has(text)).map(text => ({ id: null, text, created_at: null, topic: op.topic || "" })));
    }
    else if (op.kind === "add") {
      const existing = new Set(next.map((item) => item.text));
      next.push(...op.texts.filter((text) => !existing.has(text)).map((text) => ({ id: null, text, created_at: null, topic: op.topic || "" })));
    }
    else {
      const item = next.find((q) => q.id === op.id);
      if (!item) {
        if (op.kind === "remove") return next;
        throw new Error("这条问题已被移除，你的内容仍保留在输入框中。");
      }
      if(op.kind === "topic") {
        if(!force&&(item.topic||"")!==op.baseTopic&&(item.topic||"")!==op.topic)throw new Error("这条问题的主题已在别处修改，可点重试保存。");
        if(op.topic.length>30)throw new Error("主题最多 30 字。");
        item.topic=op.topic;checkTopics(next,latest);return next;
      }
      if (!force && item.text !== op.baseText && !(op.kind === "update" && item.text === op.text)) throw new Error("这条问题已在别处修改。你的内容已保留，可点重试保存。");
      if (op.kind === "update") item.text = op.text.trim();
      else next = next.filter((q) => q.id !== op.id);
    }
    checkTopics(next,latest);
    if (!next.length || next.length > 500 || next.some((q) => !q.text.trim() || q.text.length > 500)) throw new Error("题库需保留 1–500 个问题，每题 1–500 字。");
    if (new Set(next.map((q) => q.text.trim())).size !== next.length) throw new Error("有重复的问题，请修改后重试。");
    return next;
  }
  async function persistOperation(op, force) {
    if (cloudMode) {
      let deck = await cloud.load();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (op.kind === "settings") {
          const latest = window.QuestionPresentation.normalize(deck.settings);
          if (latest[op.key] === op.value) { accept(deck); return; }
          if (!force && latest[op.key] !== op.baseValue) throw new Error("这处文案或设置已在别处修改。你的内容已保留，可点重试保存。");
          const result = await cloud.updateSettings(deck.revision, { [op.key]: op.value });
          if (result.status === "ok") { accept(result.deck); return; }
          deck = result.deck; continue;
        }
        const next = nextItems(deck.items, op, force);
        if (JSON.stringify(next) === JSON.stringify(deck.items)) { accept(deck); return; }
        const result = await cloud.change("edit", deck.revision, { questions: next.map(({ id, text, topic }) => ({ id, text, ...(topic!==undefined?{topic}:{}) })) });
        if (result.status === "ok") { accept(result.deck); return; }
        deck = result.deck;
      }
      throw new Error("其他设备正在更新题库，请稍后重试。");
    }
    const local = localData();
    if (op.kind === "settings") {
      const latest = window.QuestionPresentation.normalize(local.settings);
      if (!force && latest[op.key] !== op.baseValue && latest[op.key] !== op.value) throw new Error("这处文案或设置已在别处修改。你的内容已保留，可点重试保存。");
      localStorage.setItem(KEY, JSON.stringify({ ...local.saved, settings: { ...latest, [op.key]: op.value } }));
      accept(localData()); return;
    }
    const now = new Date().toISOString();
    const next = nextItems(local.items, op, force).map((item) => item.id ? item : { ...item, id: crypto.randomUUID(), created_at: now });
    localStorage.setItem(KEY, JSON.stringify({ questions: next.map((q) => q.text), questionMeta: next.map(({ id, created_at, topic }) => ({ id, created_at, topic:topic||"" })), settings: local.settings, source: next.map((q) => q.text), mode: local.saved?.mode || "box", current: null, revealed: false, remaining: next.map((_, i) => i) }));
    accept({ items: next, settings: local.settings });
  }
  function enqueue(op, force = false) {
    waiting++; status();
    const task = tail.then(async () => {
      try {
        await persistOperation(op, force);
        if (!failed || (failed.kind === op.kind && failed.id === op.id && failed.key === op.key)) { failed = null; notice = "已保存"; }
        if (["add", "batch"].includes(op.kind) && $(op.field || "new-questions").value === op.input) {
          $(op.field || "new-questions").value = "";
          if (op.field === "batch-input") $("batch-dialog").close();
          else resizeNewQuestions();
        }
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
  function openTopicDialog(target=null) {
    topicTarget=target;$("topic-name").value="";$("topic-error").textContent="";document.documentElement.dataset.batchOpen="true";$("topic-dialog").showModal();$("topic-name").focus();
  }
  $("new-topic").addEventListener("change",()=>{
    if($("new-topic").value!=="__new__"){addTopic=$("new-topic").value;return;}
    $("new-topic").value=addTopic;openTopicDialog();
  });
  $("topic-dialog").addEventListener("close",()=>{topicTarget=null;delete document.documentElement.dataset.batchOpen;});
  $("cancel-topic").addEventListener("click",()=>$("topic-dialog").close());
  $("create-topic").addEventListener("click",()=>{
    const topic=$("topic-name").value.trim();
    if(!topic||topic.length>30){$("topic-error").textContent="请填写 1–30 字的主题。";return;}
    const themes=new Set(items.map(q=>q.topic||"").filter(t=>t&&t!=="未分类"));
    if(topic!=="未分类"&&!themes.has(topic)&&themes.size>=6){$("topic-error").textContent="最多保留 6 个主题。";return;}
    const value=topic==="未分类"?"":topic;
    if(topicTarget){const target=topicTarget;$("topic-dialog").close();void enqueue({kind:"topic",...target,topic:value});}
    else{addTopic=value;renderRows();$("topic-dialog").close();}
  });
  $("topic-name").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.isComposing){event.preventDefault();$("create-topic").click();}});
  $("dashboard-topic").addEventListener("change",()=>{topicFilter=$("dashboard-topic").value;renderRows();});
  $("new-questions").addEventListener("input", resizeNewQuestions);
  $("open-batch").addEventListener("click", () => {
    batchBase = items.map(item => ({...item})); batchEdits.clear();
    const pending=parseQuestions($("batch-input").value);batchRows=[];$("batch-existing").replaceChildren();
    batchBase.forEach(item=>createBatchRow(item,item.text));
    pending.forEach(text=>createBatchRow(null,text));trailingBatchRow();
    document.documentElement.dataset.batchOpen = "true";
    $("batch-dialog").showModal();
    $("batch-existing").scrollTop=$("batch-existing").scrollHeight;
  });
  $("batch-dialog").addEventListener("close", () => {delete document.documentElement.dataset.batchOpen; batchEdits.clear();});
  $("close-batch").addEventListener("click", () => $("batch-dialog").close());
  function submitBatch(force = false) {
    if (!ready || waiting) return;
    const input=$("batch-input").value;
    const texts = parseQuestions(input);
    const updates = batchBase.filter(item => batchEdits.has(item.id)).map(item => ({id:item.id,baseText:item.text,text:batchEdits.get(item.id)}));
    if (!texts.length && !updates.length) { notice="没有需要更新的内容。"; status(); return; }
    return enqueue({kind:"batch",texts,updates,input,field:"batch-input"}, force);
  }
  $("submit-batch").addEventListener("click", () => submitBatch());
  window.addEventListener("resize", resizeNewQuestions);
  resizeNewQuestions();
  $("add").addEventListener("click", () => {
    if (!ready || waiting) return;
    const input = $("new-questions").value;
    const texts = input.split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
    if (!texts.length) { notice = "请填写问题。"; status(); return; }
    if (new Set(texts).size !== texts.length || texts.some((text) => items.some((item) => item.text === text))) { notice = "有重复的问题。"; status(); return; }
    return enqueue({ kind: "add", texts, input, topic:$("new-topic").value.trim() });
  });
  function retryFailed() {
    if (!failed || waiting) return;
    const op = failed;
    if (op.kind === "load") { failed = null; return refresh(); }
    if (op.kind === "update") return saveDraft(op.id, true);
    if (op.kind === "settings") return saveSetting(op.key, true);
    if (op.kind === "batch" && $("batch-dialog").open) return submitBatch(true);
    return enqueue(op, true);
  }
  $("retry").addEventListener("click", retryFailed);
  $("batch-retry").addEventListener("click", retryFailed);
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
  window.addEventListener("beforeunload", (event) => { if (drafts.size || settingDrafts.size || batchEdits.size || ($("batch-dialog").open && $("batch-input").value.trim()) || waiting) { event.preventDefault(); event.returnValue = ""; } });
  void refresh();
})();
