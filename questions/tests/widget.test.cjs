const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Run from the repository root. The harness checks persisted state and visible
// editor content without a browser, network connection, or external dependencies.
const source = fs.readFileSync(path.join(process.cwd(), "questions/app.js"), "utf8");
function setup({ questions = ["问题甲？", "问题乙？", "问题丙？"], stored = null, search = "", reduced = false, blocked = false } = {}) {
  const nodes = new Map();
  function el(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        hidden: false, disabled: false, value: "", textContent: "", dataset: {}, handlers: {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
        setAttribute(name, value) { this[name] = value; },
        showModal() { this.open = true; },
        close() { this.open = false; this.handlers.close?.(); },
        classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)) },
        offsetWidth: 100,
      });
    }
    return nodes.get(id);
  }
  const radios = [el("mode-card"), el("mode-box")];
  radios[0].value = "card";
  radios[1].value = "box";
  let persisted = stored;
  let timer;
  vm.runInNewContext(source, {
    window: { QUESTION_CARDS: questions },
    document: { getElementById: el, documentElement: el("root"), querySelectorAll: () => radios, querySelector: () => el("card") },
    location: { search }, URLSearchParams,
    localStorage: {
      getItem() { if (blocked) throw Error("storage blocked"); return persisted; },
      setItem(key, value) { if (blocked) throw Error("storage blocked"); persisted = value; },
    },
    matchMedia: () => ({ matches: reduced }),
    setTimeout(callback) { timer = callback; return 1; },
    clearTimeout() { timer = null; },
  });
  return {
    el,
    fire(id, type = "click") { el(id).handlers[type]({ preventDefault() {} }); },
    flush() { const callback = timer; timer = null; callback?.(); },
    snapshot: () => persisted,
    saved: () => JSON.parse(persisted),
  };
}

test("a drawn box stays sealed until clicked, including after reload", () => {
  const page = setup();
  assert.equal(page.el("root").dataset.mode, "box");
  page.fire("draw");
  page.flush();
  assert.equal(page.el("question").hidden, true);
  assert.equal(page.el("question-text").textContent, "");
  assert.equal(page.el("draw").disabled, true);
  assert.equal(page.el("open-box").disabled, false);
  const restored = setup({ stored: page.snapshot() });
  assert.equal(restored.el("question").hidden, true);
  restored.fire("open-box");
  assert.equal(restored.el("question").hidden, true);
  restored.flush();
  assert.equal(restored.el("question").hidden, false);
  assert.equal(restored.saved().current, page.saved().current);
});

test("rounds never repeat questions and avoid a duplicate across the boundary", () => {
  const page = setup({ reduced: true });
  const seen = [];
  for (let i = 0; i < 3; i++) {
    page.fire("draw"); page.fire("open-box");
    seen.push(page.el("question-text").textContent);
  }
  assert.equal(new Set(seen).size, 3);
  assert.equal(page.el("draw-label").textContent, "开始新一轮");
  page.fire("draw"); page.fire("open-box");
  assert.notEqual(page.el("question-text").textContent, seen[2]);
});

test("switching modes cancels opening without revealing or changing the question", () => {
  const page = setup();
  page.fire("draw");
  const index = page.saved().current;
  page.fire("open-box");
  page.fire("mode-card", "change");
  page.flush();
  assert.equal(page.el("question").hidden, true);
  assert.equal(page.saved().current, index);
  assert.equal(page.el("draw-label").textContent, "展开这张卡片");
  page.fire("draw");
  assert.equal(page.el("question").hidden, false);
  assert.equal(page.saved().current, index);
});

test("editor starts masked, preserves hidden edits, and hides again on reopening", () => {
  const page = setup();
  page.fire("edit");
  assert.match(page.el("masked-questions").textContent, /^\*+\n\*+\n\*+$/);
  assert.equal(page.el("question-list").value, "");
  assert.equal(page.el("question-list").disabled, true);
  page.fire("toggle-visibility");
  assert.match(page.el("question-list").value, /问题甲/);
  page.el("question-list").value = "新问题？\n另一个问题？\n新问题？";
  page.fire("toggle-visibility");
  assert.equal(page.el("question-list").value, "");
  page.fire("editor-form", "submit");
  assert.deepEqual(page.saved().source, ["新问题？", "另一个问题？"]);
  assert.equal(page.saved().current, null);
  page.fire("edit");
  assert.equal(page.el("question-list").hidden, true);
  assert.equal(page.el("toggle-visibility")["aria-pressed"], "false");
});

test("saving while masked preserves real questions and restoring examples stays masked", () => {
  const page = setup();
  page.fire("edit"); page.fire("editor-form", "submit");
  assert.deepEqual(page.saved().source, ["问题甲？", "问题乙？", "问题丙？"]);
  page.fire("edit"); page.fire("toggle-visibility");
  page.el("question-list").value = "不要保存这段草稿";
  page.fire("restore");
  assert.equal(page.el("question-list").hidden, true);
  page.fire("editor-form", "submit");
  assert.equal(page.saved().source.length, 3);
});

test("invalid input does not replace the deck", () => {
  const page = setup();
  page.fire("edit"); page.fire("toggle-visibility");
  for (const input of ["  ", "字".repeat(501), Array.from({ length: 501 }, (_, i) => String(i)).join("\n")]) {
    page.el("question-list").value = input;
    page.fire("editor-form", "submit");
    assert.match(page.el("editor-error").textContent, /500/);
    assert.equal(page.el("editor").open, true);
  }
});

test("one-question decks, reduced motion, no questions, and blocked storage remain usable", () => {
  const page = setup({ questions: ["唯一问题？"], reduced: true, blocked: true });
  page.fire("draw"); assert.equal(page.el("question").hidden, true);
  page.fire("open-box"); assert.equal(page.el("question-text").textContent, "唯一问题？");
  assert.equal(page.el("storage-note").hidden, false);
  page.fire("draw"); page.fire("open-box");
  assert.equal(page.el("question-text").textContent, "唯一问题？");
  assert.equal(setup({ questions: [] }).el("draw").disabled, true);
});

test("invalid stored JSON and changed default decks reset safely", () => {
  const page = setup({ stored: "{bad JSON", search: "?theme=dark&mode=card" });
  page.fire("draw"); assert.equal(page.el("question").hidden, false);
  assert.equal(page.el("root").dataset.theme, "dark");
  const changed = setup({ stored: page.snapshot(), questions: ["更新的默认问题？"] });
  assert.equal(changed.el("question").hidden, true);
  assert.equal(changed.el("progress").textContent, "1 个问题 · 随机相遇");
});
