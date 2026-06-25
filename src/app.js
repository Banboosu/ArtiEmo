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

/* ── 会话状态 ─────────────────────────────── */
let history = [];                 // [{role, content}] —— assistant 用纯台词回灌
let emotionState = null;          // 随对话漂移
let busy = false;
let currentAbort = null;

/* ── renderer：引擎调用这些回调来「演出」 ── */
const renderer = {
  setExpression(emoji, label) {
    emojiEl.textContent = emoji;
    labelEl.textContent = label;
    portrait.classList.add("pop");
    setTimeout(() => portrait.classList.remove("pop"), 180);
  },
  beginLine(type) {
    const line = document.createElement("span");
    line.className = `line ${type}`;
    const caret = document.createElement("span");
    caret.className = "caret";
    line.appendChild(caret);
    textflow.appendChild(line);
    textflow.scrollTop = textflow.scrollHeight;
    return { line, caret };
  },
  appendChar(handle, char) {
    handle.caret.insertAdjacentText("beforebegin", char);
    textflow.scrollTop = textflow.scrollHeight;
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
    setBusy(false);
  },
};

const engine = new PerformanceEngine(renderer, { defaultTypingSpeed: 55 });

/* ── 模式与配置 ─────────────────────────────── */
function activeCharacter() {
  const c = ArtiEmoLLM.getConfig();
  if (c.character && c.character.name) return c.character;
  return window.DEFAULT_CHARACTER;
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
  textflow.innerHTML = "";
  continueHint.classList.remove("show");
  emojiEl.textContent = "🙂";
  labelEl.textContent = "平静";
  if (clearHistory) {
    history = [];
    emotionState = null;
    stateReadout.textContent = "";
  }
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

  // 用户气泡先不画在 textflow（textflow 是角色的演出区），
  // 这里直接清舞台、显示「思考中」表情，等 LLM 回来再演。
  resetStage(false);
  setBusy(true);
  emojiEl.textContent = "💭";
  labelEl.textContent = "思考中";
  userInput.value = "";

  currentAbort = new AbortController();
  try {
    const result = await ArtiEmoLLM.generateBeats({
      systemPrompt: window.BEAT_PROTOCOL_SYSTEM_PROMPT,
      character: activeCharacter(),
      history,
      emotionState,
      userInput: input,
      signal: currentAbort.signal,
    });

    // 记历史：user 原文 + assistant 纯台词
    history.push({ role: "user", content: input });
    history.push({ role: "assistant", content: result.plainReply || "" });
    // 限制历史长度，避免无限增长（保留最近 16 条）
    if (history.length > 16) history = history.slice(-16);

    resetStage(false);
    await engine.play({ beats: result.beats, emotion_state: result.emotion_state });
  } catch (e) {
    if (e.name === "AbortError") {
      // 用户主动取消，不报错
    } else {
      emojiEl.textContent = "⚠️";
      labelEl.textContent = "出错";
      const errLine = document.createElement("span");
      errLine.className = "line action";
      errLine.textContent = "演出失败：" + e.message;
      textflow.appendChild(errLine);
    }
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

/* ── 设置面板 ──────────────────────────────── */
const settingsModal = $("settingsModal");
const cfgBaseURL = $("cfgBaseURL");
const cfgApiKey = $("cfgApiKey");
const cfgModel = $("cfgModel");
const cfgTemp = $("cfgTemp");
const tempVal = $("tempVal");
const cfgCharName = $("cfgCharName");
const cfgCharPersona = $("cfgCharPersona");
const cfgCharStyle = $("cfgCharStyle");

function openSettings() {
  const c = ArtiEmoLLM.getConfig();
  cfgBaseURL.value = c.baseURL || "";
  cfgApiKey.value = c.apiKey || "";
  cfgModel.value = c.model || "";
  cfgTemp.value = c.temperature ?? 0.9;
  tempVal.textContent = Number(cfgTemp.value).toFixed(2);
  const ch = c.character || {};
  cfgCharName.value = ch.name || "";
  cfgCharPersona.value = ch.persona || "";
  cfgCharStyle.value = ch.speaking_style || "";
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
  const character =
    cfgCharName.value.trim() || cfgCharPersona.value.trim() || cfgCharStyle.value.trim()
      ? {
          name: cfgCharName.value.trim() || "綾",
          persona: cfgCharPersona.value.trim(),
          speaking_style: cfgCharStyle.value.trim(),
        }
      : null;

  ArtiEmoLLM.saveConfig({
    baseURL: cfgBaseURL.value.trim() || ArtiEmoLLM.DEFAULT_CONFIG.baseURL,
    apiKey: cfgApiKey.value.trim(),
    model: cfgModel.value.trim() || ArtiEmoLLM.DEFAULT_CONFIG.model,
    temperature: parseFloat(cfgTemp.value),
    character,
  });
  closeSettingsPanel();
  refreshMode();
  resetStage(true);
});

$("clearCfg").addEventListener("click", () => {
  ArtiEmoLLM.clearConfig();
  closeSettingsPanel();
  refreshMode();
  resetStage(true);
});

/* ── 启动 ──────────────────────────────────── */
refreshMode();
