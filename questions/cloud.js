(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function validateDeck(deck) {
    if (!deck || !Array.isArray(deck.questions) || !deck.questions.length || deck.questions.length > 500
      || deck.questions.some((q) => typeof q !== "string" || !q.trim() || q.length > 500)
      || new Set(deck.questions).size !== deck.questions.length
      || !Number.isSafeInteger(deck.revision) || deck.revision < 0
      || !Array.isArray(deck.remaining) || typeof deck.revealed !== "boolean") {
      throw new Error("云端数据格式不正确，请检查数据库初始化脚本。");
    }
    const index = (i) => Number.isInteger(i) && i >= 0 && i < deck.questions.length;
    if (!deck.remaining.every(index) || new Set(deck.remaining).size !== deck.remaining.length
      || (deck.current !== null && (!index(deck.current) || deck.remaining.includes(deck.current)))
      || (deck.current === null && (deck.revealed || deck.remaining.length !== deck.questions.length))) {
      throw new Error("云端抽取进度不正确，请检查数据库。");
    }
    if (!Array.isArray(deck.items) || deck.items.length !== deck.questions.length
      || deck.items.some((item, i) => !item || !UUID.test(item.id) || item.text !== deck.questions[i] || !Number.isFinite(Date.parse(item.created_at)))
      || new Set(deck.items.map((item) => item.id)).size !== deck.items.length) {
      throw new Error("云端题目记录不正确，请检查数据库。");
    }
    return deck;
  }

  function create(search) {
    const params = new URLSearchParams(search);
    if (!params.has("id")) return null;
    const id = (params.get("id") || "").trim().toLowerCase();
    const connection = window.QuestionSupabaseConfig;
    async function rpc(name, payload) {
      if (!UUID.test(id)) throw new Error("共享链接中的题库 ID 不正确，请使用初始化后生成的完整链接。");
      if (!connection?.url || !connection?.publishableKey) throw new Error("云端连接尚未配置。");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${connection.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: { apikey: connection.publishableKey, "Content-Type": "application/json", "x-question-deck": id },
          body: JSON.stringify({ p_id: id, ...payload }),
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) {
          if (response.status === 404) throw new Error("云端尚未初始化，请先运行 questions/supabase-setup.sql。");
          throw new Error("无法访问云端，请检查网络和 Supabase 配置后重试。");
        }
        const result = await response.json();
        if (!result) throw new Error("没有找到这份题库，请确认共享链接中的 ID。");
        return result;
      } catch (error) {
        if (error.name === "AbortError" || error instanceof TypeError) throw new Error("云端连接中断，请检查网络后重试。");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    return {
      async load() { return validateDeck(await rpc("get_question_deck", {})); },
      async change(action, revision, { questions = null, reveal = false } = {}) {
        const result = await rpc("change_question_deck", { p_action: action, p_revision: revision, p_questions: questions, p_reveal: reveal });
        if (!["ok", "conflict"].includes(result.status)) throw new Error("云端返回了未知的保存结果，请重试。");
        return { status: result.status, deck: validateDeck(result.deck) };
      },
      async updateSettings(revision, settings) {
        const result = await rpc("update_question_settings", { p_revision: revision, p_settings: settings });
        if (!["ok", "conflict"].includes(result.status)) throw new Error("云端返回了未知的保存结果，请重试。");
        return { status: result.status, deck: validateDeck(result.deck) };
      },
      subscribe(onUpdate, onStatus) {
        if (!UUID.test(id) || !window.supabase?.createClient || !connection?.url || !connection?.publishableKey) {
          onStatus(false);
          return () => {};
        }
        const client = window.supabase.createClient(connection.url, connection.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const channel = client.channel(`question-deck:${id}`, { config: { private: false } })
          .on("broadcast", { event: "deck_updated" }, onUpdate)
          .subscribe((status) => onStatus(status === "SUBSCRIBED"));
        return () => { void client.removeChannel(channel); };
      },
    };
  }
  window.QuestionCloud = { create, validateDeck };
})();
