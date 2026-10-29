(() => {
  "use strict";
  const defaults = Object.freeze({
    name: "留一个问题", frontTop: "一段对话的开始", invitation: "留一点好奇，打开聊聊。",
    frontBottom: "给彼此一点思考的时间", backTop: "留给此刻的问题", backBottom: "听听彼此的答案",
    mode: "box", theme: "auto",
  });
  function normalize(value = {}) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const text = value && typeof value[key] === "string" ? value[key] : fallback;
      return [key, key === "mode" ? (["box", "card"].includes(text) ? text : fallback)
        : key === "theme" ? (["auto", "light", "dark"].includes(text) ? text : fallback) : text.slice(0, 100)];
    }));
  }
  window.QuestionPresentation = { defaults, normalize };
})();
