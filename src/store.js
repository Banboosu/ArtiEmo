/**
 * ArtiEmo 存储层 (Phase 3)
 * ------------------------
 * 全部存浏览器 localStorage，纯静态、零后端。三块数据：
 *   1. 角色卡库      —— 默认卡(只读) + 用户自定义卡(可增删改)
 *   2. 当前会话      —— 自动保存，刷新不丢(history + emotion_state + transcript)
 *   3. 命名存档      —— 用户手动存/读的多份会话快照
 *
 * transcript 是「可重建的对话记录」：
 *   { role:'user', text }
 *   { role:'char', beats:[...], emotion_state }
 * 读档时按它瞬间重建 DOM（不走打字动画），所以刷新/读档能恢复整段对话。
 */
(function () {
  const K_CARDS = "artiemo.cards.v1";       // 用户自定义卡 [card,...]
  const K_SESSION = "artiemo.session.v1";   // 当前会话
  const K_SAVES = "artiemo.saves.v1";       // [{id,name,ts,session},...]
  const K_ACTIVE = "artiemo.activeCard.v1"; // 当前选中的 cardId

  const readJSON = (k, fallback) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  /* ── 角色卡库 ── */
  function listCards() {
    const custom = readJSON(K_CARDS, []);
    // 默认卡在前，自定义卡在后；自定义同 id 覆盖默认（允许用户改默认卡）
    const map = new Map();
    for (const c of window.DEFAULT_CARDS || []) map.set(c.id, { ...c, builtin: true });
    for (const c of custom) map.set(c.id, { ...c, builtin: false });
    return [...map.values()];
  }
  function getCard(id) {
    return listCards().find((c) => c.id === id) || listCards()[0];
  }
  function upsertCard(card) {
    const custom = readJSON(K_CARDS, []);
    const id = card.id || "c_" + Date.now();
    const next = { ...card, id };
    const i = custom.findIndex((c) => c.id === id);
    if (i >= 0) custom[i] = next;
    else custom.push(next);
    writeJSON(K_CARDS, custom);
    return next;
  }
  function deleteCard(id) {
    // 只能删自定义卡；删默认卡的自定义覆盖会回退到内置默认
    const custom = readJSON(K_CARDS, []).filter((c) => c.id !== id);
    writeJSON(K_CARDS, custom);
  }

  function getActiveCardId() {
    return localStorage.getItem(K_ACTIVE) || (listCards()[0] && listCards()[0].id);
  }
  function setActiveCardId(id) {
    localStorage.setItem(K_ACTIVE, id);
  }

  /* ── 当前会话 ── */
  function loadSession() {
    return readJSON(K_SESSION, null);
  }
  function saveSession(session) {
    writeJSON(K_SESSION, session);
  }
  function clearSession() {
    localStorage.removeItem(K_SESSION);
  }

  /* ── 命名存档 ── */
  function listSaves() {
    return readJSON(K_SAVES, []);
  }
  function createSave(name, session) {
    const saves = listSaves();
    const entry = {
      id: "s_" + Date.now(),
      name: name || "存档 " + new Date().toLocaleString("zh-CN"),
      ts: Date.now(),
      session: JSON.parse(JSON.stringify(session)),
    };
    saves.unshift(entry);
    writeJSON(K_SAVES, saves);
    return entry;
  }
  function getSave(id) {
    return listSaves().find((s) => s.id === id);
  }
  function deleteSave(id) {
    writeJSON(K_SAVES, listSaves().filter((s) => s.id !== id));
  }

  window.ArtiEmoStore = {
    listCards, getCard, upsertCard, deleteCard,
    getActiveCardId, setActiveCardId,
    loadSession, saveSession, clearSession,
    listSaves, createSave, getSave, deleteSave,
  };
})();
