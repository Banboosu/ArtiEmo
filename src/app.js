/**
 * ArtiEmo 应用层 (Phase 2) —— 把演出引擎接到 DOM + LLM。
 * 两种模式：
 *   演示模式：未配置 Key 时，「播放演示」播放 data/sample.js 样例脚本。
 *   实时模式：配置 Key 后，输入框对话 → LLM 生成 beat 序列 → 引擎演出。
 * renderer 接口与 Phase 1 完全一致，引擎不动。
 */

const $ = (id) => document.getElementById(id);

const portrait = $("portrait");
const emojiEl = $("emoji");
const labelEl = $("label");
const textflow = $("textflow");
const continueHint = $("continueHint");
const stateReadout = $("stateReadout");
const charNameEl = $("charName");
const modeBadge = $("modeBadge");

const playBtn = $("playBtn");
const skipBtn = $("skipBtn");
const speedRange = $("speedRange");
const speedVal = $("speedVal");

const chatForm = $("chatForm");
const userInput = $("userInput");
const sendBtn = $("sendBtn");

/* ── 调试 Console ──────────────────────────── */
const debugConsole = $("debugConsole");
const consoleBody = $("consoleBody");
const consoleToggle = $("consoleToggle");
const clearConsole = $("clearConsole");

function logConsole(kind, payload, ms) {
  if (!consoleBody) return;
  const entry = document.createElement("div");
  entry.className = "log-entry log-" + kind;
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const tag =
    kind === "request" ? "→ 请求"
    : kind === "raw" ? "← 原始输出"
    : kind === "parsed" ? "✓ 解析结果"
    : kind === "error" ? "✕ 错误"
    : kind;
  const msStr = ms != null ? `  (${Math.round(ms)}ms)` : "";
  const head = document.createElement("div");
  head.className = "log-head";
  head.textContent = `[${time}] ${tag}${msStr}`;
  const pre = document.createElement("pre");
  pre.className = "log-payload";
  pre.textContent =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  entry.appendChild(head);
  entry.appendChild(pre);
  consoleBody.appendChild(entry);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

/* ── 会话状态 ─────────────────────────────── */
let history = [];                 // [{role, content}] —— assistant 用纯台词回灌
let emotionState = null;          // 随对话漂移
let transcript = [];              // 可重建的对话记录 [{role:'user',text}|{role:'char',beats,emotion_state}]
let activeCardId = null;          // 当前角色卡 id
let busy = false;
let currentAbort = null;

/* ── renderer：引擎调用这些回调来「演出」 ──
 * 不再每轮清空 textflow —— 改为往「当前轮的角色块」里追加，
 * textflow 变成可滚动的对话记录，保留历史，避免生硬。
 */
let currentCharBlock = null; // 本轮角色演出要写入的容器

function ensureCharBlock() {
  if (currentCharBlock) return currentCharBlock;
  const block = document.createElement("div");
  block.className = "turn char";
  const name = document.createElement("div");
  name.className = "turn-name";
  name.textContent = activeCharacter().name || "綾";
  const flow = document.createElement("div");
  flow.className = "turn-flow";
  block.appendChild(name);
  block.appendChild(flow);
  textflow.appendChild(block);
  currentCharBlock = flow;
  scrollToEnd();
  return flow;
}

function appendUserTurn(text, record = true) {
  const block = document.createElement("div");
  block.className = "turn user";
  const bubble = document.createElement("div");
  bubble.className = "turn-bubble";
  bubble.textContent = text;
  block.appendChild(bubble);
  textflow.appendChild(block);
  if (record) transcript.push({ role: "user", text });
  scrollToEnd();
}

function scrollToEnd() {
  textflow.scrollTop = textflow.scrollHeight;
}

const renderer = {
  setExpression(emoji, label) {
    emojiEl.textContent = emoji;
    labelEl.textContent = label;
    portrait.classList.add("pop");
    setTimeout(() => portrait.classList.remove("pop"), 180);
  },
  beginLine(type) {
    const target = ensureCharBlock();
    const line = document.createElement("span");
    line.className = `line ${type}`;
    const caret = document.createElement("span");
    caret.className = "caret";
    line.appendChild(caret);
    target.appendChild(line);
    scrollToEnd();
    return { line, caret };
  },
  appendChar(handle, char) {
    handle.caret.insertAdjacentText("beforebegin", char);
    scrollToEnd();
  },
  endLine(handle) {
    handle.caret.remove();
  },
  onState(state) {
    emotionState = state;
    stateReadout.textContent =
      `mood:${state.mood}  affection:${state.affection}  energy:${state.energy}`;
  },
  onDone() {
    continueHint.classList.add("show");
    currentCharBlock = null; // 本轮演出结束，下轮另起一块
    setBusy(false);
  },
};

const engine = new PerformanceEngine(renderer, { defaultTypingSpeed: 55 });
window.engine = engine; // 方便控制台调试

/* ── 模式与配置 ─────────────────────────────── */
function activeCharacter() {
  return ArtiEmoStore.getCard(activeCardId) || ArtiEmoStore.listCards()[0];
}

/* ── 会话持久化 ──────────────────────────────
 * 每轮结束后把 {cardId, history, emotionState, transcript} 存进 localStorage，
 * 刷新页面 / 读档时按 transcript 瞬间重建对话(不走打字动画)。
 */
function snapshotSession() {
  return {
    cardId: activeCardId,
    history,
    emotionState,
    transcript,
  };
}
function autosave() {
  ArtiEmoStore.saveSession(snapshotSession());
}

function restoreSession(session) {
  if (!session) return false;
  activeCardId = session.cardId || ArtiEmoStore.getActiveCardId();
  history = session.history || [];
  emotionState = session.emotionState || null;
  transcript = session.transcript || [];
  // 重建 DOM
  textflow.innerHTML = "";
  currentCharBlock = null;
  for (const turn of transcript) {
    if (turn.role === "user") {
      appendUserTurn(turn.text, /*record=*/ false);
    } else if (turn.role === "char") {
      renderCharInstant(turn.beats || []);
    }
  }
  if (emotionState) {
    stateReadout.textContent =
      `mood:${emotionState.mood}  affection:${emotionState.affection}  energy:${emotionState.energy}`;
  }
  // 末态表情：取最后一个 expression beat
  const lastExpr = [...transcript].reverse()
    .find((t) => t.role === "char" && (t.beats || []).some((b) => b.type === "expression"));
  if (lastExpr) {
    const e = [...lastExpr.beats].reverse().find((b) => b.type === "expression");
    if (e) { emojiEl.textContent = e.emoji; labelEl.textContent = e.label; }
  } else {
    const c = activeCharacter();
    emojiEl.textContent = c.emoji || "🙂";
  }
  scrollToEnd();
  return true;
}

/* 瞬间渲染一整轮角色演出(读档用，无动画) */
function renderCharInstant(beats) {
  const block = document.createElement("div");
  block.className = "turn char";
  const name = document.createElement("div");
  name.className = "turn-name";
  name.textContent = activeCharacter().name || "綾";
  const flow = document.createElement("div");
  flow.className = "turn-flow";
  block.appendChild(name);
  block.appendChild(flow);
  for (const b of beats) {
    if (b.type === "dialogue" || b.type === "action") {
      const line = document.createElement("span");
      line.className = `line ${b.type}`;
      line.textContent = b.content || "";
      flow.appendChild(line);
    }
  }
  textflow.appendChild(block);
}

function refreshMode() {
  const live = ArtiEmoLLM.isConfigured();
  modeBadge.textContent = live ? "实时模式" : "演示模式";
  modeBadge.classList.toggle("live", live);
  chatForm.classList.toggle("enabled", live);
  userInput.disabled = !live;
  sendBtn.disabled = !live;
  userInput.placeholder = live
    ? "对她说点什么…"
    : "未配置 API Key —— 点右上角 ⚙ 设置，或先点「播放演示」看效果";
  charNameEl.textContent = activeCharacter().name || "綾";
  playBtn.style.display = live ? "none" : "";
}

function setBusy(v) {
  busy = v;
  sendBtn.disabled = v || !ArtiEmoLLM.isConfigured();
  userInput.disabled = v || !ArtiEmoLLM.isConfigured();
  playBtn.disabled = v;
  if (v) {
    continueHint.classList.remove("show");
  }
}

function resetStage(clearHistory = false) {
  continueHint.classList.remove("show");
  currentCharBlock = null;
  if (clearHistory) {
    textflow.innerHTML = "";
    history = [];
    transcript = [];
    emotionState = null;
    stateReadout.textContent = "";
    const c = activeCharacter();
    emojiEl.textContent = (c && c.emoji) || "🙂";
    labelEl.textContent = "平静";
  }
}

/* 开新会话：清空对话，情绪回到角色卡初始状态 */
function newSession() {
  engine.cancel();
  resetStage(true);
  const c = activeCharacter();
  emotionState = c && c.initial_state ? { ...c.initial_state } : null;
  charNameEl.textContent = (c && c.name) || "綾";
  autosave();
}

/* ── 演示模式：播放样例脚本 ─────────────────── */
function startDemo() {
  resetStage(true);
  charNameEl.textContent = window.SAMPLE_SCRIPT.character || "綾";
  setBusy(true);
  playBtn.textContent = "演出中…";
  engine.cancel();
  setTimeout(async () => {
    await engine.play(window.SAMPLE_SCRIPT);
    playBtn.textContent = "▶ 重播演示";
  }, 50);
}

/* ── 实时模式：一轮对话 ─────────────────────── */
async function sendTurn(text) {
  if (busy || !text.trim()) return;
  const input = text.trim();

  // 保留历史对话：先把用户这句追加到记录里，不清空舞台
  continueHint.classList.remove("show");
  appendUserTurn(input);
  setBusy(true);
  emojiEl.textContent = "💭";
  labelEl.textContent = "思考中";
  userInput.value = "";

  currentAbort = new AbortController();
  const t0 = performance.now();
  let firstBeatMs = null;
  try {
    logConsole("request", { userInput: input, historyLen: history.length, emotionState });

    // 流式：beat 边到边演，首字延迟 = 第一个 beat 生成时间
    const ctrl = engine.playStream();
    const collectedBeats = [];
    let finalState = emotionState;

    const result = await ArtiEmoLLM.generateBeatsStream({
      systemPrompt: window.BEAT_PROTOCOL_SYSTEM_PROMPT,
      character: activeCharacter(),
      history,
      emotionState,
      userInput: input,
      signal: currentAbort.signal,
      onBeat: (beat) => {
        if (firstBeatMs == null) {
          firstBeatMs = performance.now() - t0;
          logConsole("parsed", { firstBeat: beat, 首字延迟ms: Math.round(firstBeatMs) });
        }
        collectedBeats.push(beat);
        ctrl.push(beat);
      },
      onState: (s) => { finalState = s; ctrl.setState(s); },
      onRaw: (raw) => logConsole("raw", raw),
    });

    ctrl.done();
    await ctrl.whenDone(); // 等演出真正播完（含打字/停顿）

    logConsole("parsed", { beats: collectedBeats, emotion_state: finalState, 总耗时ms: Math.round(performance.now() - t0) });

    // 记历史 + 可重建记录
    history.push({ role: "user", content: input });
    history.push({ role: "assistant", content: result.plainReply || "" });
    if (history.length > 16) history = history.slice(-16);
    transcript.push({ role: "char", beats: collectedBeats, emotion_state: finalState });

    autosave();
  } catch (e) {
    if (e.name === "AbortError") {
      // 用户主动取消，不报错
    } else {
      logConsole("error", e.message);
      emojiEl.textContent = "⚠️";
      labelEl.textContent = "出错";
      const block = document.createElement("div");
      block.className = "turn char error";
      block.textContent = "演出失败：" + e.message;
      textflow.appendChild(block);
      scrollToEnd();
    }
    currentCharBlock = null;
    setBusy(false);
  } finally {
    currentAbort = null;
  }
}

/* ── 控件绑定 ──────────────────────────────── */
playBtn.addEventListener("click", startDemo);

skipBtn.addEventListener("click", () => {
  const on = !engine.skipDelays;
  engine.setSkipDelays(on);
  skipBtn.classList.toggle("active", on);
  skipBtn.textContent = on ? "✓ 已跳过停顿" : "跳过停顿";
});

speedRange.addEventListener("input", () => {
  const v = parseFloat(speedRange.value);
  engine.setSpeed(v);
  speedVal.textContent = v.toFixed(2) + "x";
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!ArtiEmoLLM.isConfigured()) {
    openSettings();
    return;
  }
  sendTurn(userInput.value);
});

/* ── 设置面板（仅 LLM 连接，角色卡移到角色面板） ── */
const settingsModal = $("settingsModal");
const cfgBaseURL = $("cfgBaseURL");
const cfgApiKey = $("cfgApiKey");
const cfgModel = $("cfgModel");
const cfgTemp = $("cfgTemp");
const tempVal = $("tempVal");

function openSettings() {
  const c = ArtiEmoLLM.getConfig();
  cfgBaseURL.value = c.baseURL || "";
  cfgApiKey.value = c.apiKey || "";
  cfgModel.value = c.model || "";
  cfgTemp.value = c.temperature ?? 0.9;
  tempVal.textContent = Number(cfgTemp.value).toFixed(2);
  settingsModal.hidden = false;
}
function closeSettingsPanel() {
  settingsModal.hidden = true;
}

$("settingsBtn").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettingsPanel);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsPanel();
});
cfgTemp.addEventListener("input", () => {
  tempVal.textContent = Number(cfgTemp.value).toFixed(2);
});

$("saveCfg").addEventListener("click", () => {
  ArtiEmoLLM.saveConfig({
    baseURL: cfgBaseURL.value.trim() || ArtiEmoLLM.DEFAULT_CONFIG.baseURL,
    apiKey: cfgApiKey.value.trim(),
    model: cfgModel.value.trim() || ArtiEmoLLM.DEFAULT_CONFIG.model,
    temperature: parseFloat(cfgTemp.value),
  });
  closeSettingsPanel();
  refreshMode();
});

$("clearCfg").addEventListener("click", () => {
  ArtiEmoLLM.clearConfig();
  closeSettingsPanel();
  refreshMode();
});

/* ── 调试 Console 控件 ─────────────────────── */
if (consoleToggle) {
  consoleToggle.addEventListener("click", () => {
    const open = debugConsole.classList.toggle("open");
    consoleToggle.textContent = open ? "▾ 调试台" : "▸ 调试台";
  });
}
if (clearConsole) {
  clearConsole.addEventListener("click", () => {
    consoleBody.innerHTML = "";
  });
}

/* ══════════ Phase 3: 角色面板 + 存档面板 ══════════ */
const charModal = $("charModal");
const cardList = $("cardList");
const cardName = $("cardName");
const cardEmoji = $("cardEmoji");
const cardPersona = $("cardPersona");
const cardStyle = $("cardStyle");
let editingCardId = null;

function renderCardList() {
  cardList.innerHTML = "";
  for (const c of ArtiEmoStore.listCards()) {
    const row = document.createElement("div");
    row.className = "card-row" + (c.id === activeCardId ? " active" : "");
    row.innerHTML =
      `<span class="card-emoji">${c.emoji || "🙂"}</span>` +
      `<span class="card-meta"><b>${c.name}</b>` +
      `<small>${(c.persona || "").slice(0, 28)}…</small></span>`;
    const use = document.createElement("button");
    use.className = "ghost mini";
    use.textContent = c.id === activeCardId ? "使用中" : "切换";
    use.disabled = c.id === activeCardId;
    use.addEventListener("click", () => switchCard(c.id));
    const edit = document.createElement("button");
    edit.className = "ghost mini";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => fillCardForm(c));
    row.appendChild(use);
    row.appendChild(edit);
    if (!c.builtin) {
      const del = document.createElement("button");
      del.className = "ghost mini danger";
      del.textContent = "删";
      del.addEventListener("click", () => {
        if (confirm(`删除角色卡「${c.name}」?`)) {
          ArtiEmoStore.deleteCard(c.id);
          if (activeCardId === c.id) switchCard(ArtiEmoStore.listCards()[0].id);
          renderCardList();
        }
      });
      row.appendChild(del);
    }
    cardList.appendChild(row);
  }
}

function fillCardForm(c) {
  editingCardId = c ? c.id : null;
  cardName.value = c ? c.name : "";
  cardEmoji.value = c ? c.emoji || "" : "";
  cardPersona.value = c ? c.persona || "" : "";
  cardStyle.value = c ? c.speaking_style || "" : "";
}

function switchCard(id) {
  activeCardId = id;
  ArtiEmoStore.setActiveCardId(id);
  newSession();          // 换角色 = 开新会话（情绪回到该卡初始状态）
  refreshMode();
  renderCardList();
}

$("charBtn").addEventListener("click", () => {
  renderCardList();
  fillCardForm(activeCharacter());
  charModal.hidden = false;
});
$("closeChar").addEventListener("click", () => (charModal.hidden = true));
charModal.addEventListener("click", (e) => {
  if (e.target === charModal) charModal.hidden = true;
});
$("newCard").addEventListener("click", () => fillCardForm(null));
$("saveCard").addEventListener("click", () => {
  if (!cardName.value.trim()) {
    alert("角色名不能为空");
    return;
  }
  const saved = ArtiEmoStore.upsertCard({
    id: editingCardId || undefined,
    name: cardName.value.trim(),
    emoji: cardEmoji.value.trim() || "🙂",
    persona: cardPersona.value.trim(),
    speaking_style: cardStyle.value.trim(),
    initial_state:
      (ArtiEmoStore.getCard(editingCardId) || {}).initial_state ||
      { mood: "calm", affection: 30, energy: 0.5 },
  });
  editingCardId = saved.id;
  renderCardList();
});

/* ── 存档面板 ── */
const saveModal = $("saveModal");
const saveList = $("saveList");
const saveName = $("saveName");

function renderSaveList() {
  saveList.innerHTML = "";
  const saves = ArtiEmoStore.listSaves();
  if (!saves.length) {
    saveList.innerHTML = '<div class="empty">还没有存档。</div>';
    return;
  }
  for (const s of saves) {
    const row = document.createElement("div");
    row.className = "save-row";
    const turns = (s.session.transcript || []).filter((t) => t.role === "user").length;
    row.innerHTML =
      `<span class="save-meta"><b>${s.name}</b>` +
      `<small>${new Date(s.ts).toLocaleString("zh-CN")} · ${turns} 轮</small></span>`;
    const load = document.createElement("button");
    load.className = "ghost mini";
    load.textContent = "读取";
    load.addEventListener("click", () => {
      engine.cancel();
      restoreSession(s.session);
      ArtiEmoStore.setActiveCardId(activeCardId);
      autosave();
      refreshMode();
      saveModal.hidden = true;
    });
    const del = document.createElement("button");
    del.className = "ghost mini danger";
    del.textContent = "删";
    del.addEventListener("click", () => {
      ArtiEmoStore.deleteSave(s.id);
      renderSaveList();
    });
    row.appendChild(load);
    row.appendChild(del);
    saveList.appendChild(row);
  }
}

$("saveBtn").addEventListener("click", () => {
  saveName.value = "";
  renderSaveList();
  saveModal.hidden = false;
});
$("closeSave").addEventListener("click", () => (saveModal.hidden = true));
saveModal.addEventListener("click", (e) => {
  if (e.target === saveModal) saveModal.hidden = true;
});
$("doSave").addEventListener("click", () => {
  if (!transcript.length) {
    alert("当前还没有对话内容可存。");
    return;
  }
  ArtiEmoStore.createSave(saveName.value.trim(), snapshotSession());
  renderSaveList();
  saveName.value = "";
});
$("newSessionBtn").addEventListener("click", () => {
  if (transcript.length && !confirm("开始新会话？当前未存档的对话会被清空（已自动保存到当前会话槽）。")) return;
  newSession();
});

/* ── 启动：恢复上次会话 / 初始化角色 ── */
(function init() {
  activeCardId = ArtiEmoStore.getActiveCardId();
  const session = ArtiEmoStore.loadSession();
  if (session && (session.transcript || []).length) {
    restoreSession(session);
  } else {
    const c = activeCharacter();
    emotionState = c && c.initial_state ? { ...c.initial_state } : null;
    emojiEl.textContent = (c && c.emoji) || "🙂";
    charNameEl.textContent = (c && c.name) || "綾";
  }
  refreshMode();
})();
