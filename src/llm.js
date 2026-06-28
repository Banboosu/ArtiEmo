/**
 * ArtiEmo LLM 客户端 (Phase 2)
 * ----------------------------
 * BYOK + OpenAI 兼容：用户自带 API key / baseURL / model，全部存浏览器 localStorage。
 * 纯静态、零后端。请求直接从浏览器打到用户填的 endpoint。
 *
 * 暴露的能力：
 *   ArtiEmoLLM.getConfig() / saveConfig() / clearConfig()
 *   ArtiEmoLLM.generateBeats({ character, history, emotionState, userInput, signal })
 *     -> { beats, emotion_state }   // 已解析、已规则层补全 pre_delay
 */

const LS_KEY = "artiemo.llm.config.v1";

const DEFAULT_CONFIG = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.9,
};

function getConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(partial) {
  const next = { ...getConfig(), ...partial };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

function clearConfig() {
  localStorage.removeItem(LS_KEY);
}

function isConfigured() {
  const c = getConfig();
  return !!(c.apiKey && c.baseURL && c.model);
}

/* ── 规则层：pre_delay 兜底补全 ─────────────────────────────
 * 即使 LLM 没给或给了不合理的 pre_delay，也保证演出有节奏感。
 * 这是「演出引擎」对「内容生成」的最后一道防线。
 */
function normalizeBeats(beats) {
  const TYPING_DEFAULT = 55;
  return beats
    .filter((b) => b && typeof b.type === "string")
    .map((b) => {
      const beat = { ...b };
      // pre_delay 合法化
      let d = Number(beat.pre_delay);
      if (!Number.isFinite(d) || d < 0) {
        // 按 type 给经验默认值
        d = beat.type === "expression" ? 450 : 600;
      }
      d = Math.min(d, 4000); // 上限，避免 LLM 给出离谱长停顿
      beat.pre_delay = Math.round(d);

      if (beat.type === "dialogue" || beat.type === "action") {
        let t = Number(beat.typing_speed);
        if (!Number.isFinite(t) || t <= 0) t = TYPING_DEFAULT;
        beat.typing_speed = Math.round(Math.min(Math.max(t, 20), 160));
        beat.content = String(beat.content ?? "");
      }
      if (beat.type === "expression") {
        beat.emoji = String(beat.emoji ?? "🙂");
        beat.label = String(beat.label ?? "平静");
      }
      return beat;
    });
}

/* ── 容错 JSON 解析 ───────────────────────────────────────
 * LLM 偶尔会用 ```json 包裹，或在 JSON 前后带解释文字。
 * 尽量从文本里抠出第一个完整 JSON 对象。
 */
function extractJSON(text) {
  if (!text) throw new Error("LLM 返回为空");
  // 去掉 markdown code fence
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 直接尝试
  try {
    return JSON.parse(s);
  } catch {
    /* 继续兜底 */
  }

  // 抠第一个 { ... }（括号配平）
  const start = s.indexOf("{");
  if (start === -1) throw new Error("LLM 返回中找不到 JSON");
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error("LLM 返回的 JSON 不完整");
}

/* ── 组装对话上下文 ──────────────────────────────────────── */
function buildMessages({ systemPrompt, character, history, emotionState, userInput }) {
  const messages = [];

  // 1. beat 协议 system prompt（项目地基）
  messages.push({ role: "system", content: systemPrompt });

  // 2. 角色卡 + 当前情绪状态，作为补充 system 上下文
  const cardLines = [];
  if (character) {
    cardLines.push("## 你扮演的角色");
    if (character.name) cardLines.push(`姓名：${character.name}`);
    if (character.persona) cardLines.push(`设定：${character.persona}`);
    if (character.speaking_style) cardLines.push(`说话风格：${character.speaking_style}`);
  }
  if (emotionState) {
    cardLines.push("");
    cardLines.push("## 当前情绪状态（上一轮结束时）");
    cardLines.push(JSON.stringify(emotionState));
    cardLines.push("请让本轮 emotion_state 从这个状态连贯漂移，不要剧烈跳变。");
  }
  if (cardLines.length) {
    messages.push({ role: "system", content: cardLines.join("\n") });
  }

  // 3. 对话历史（user 文本 / assistant 用台词回灌，避免把整段 beat JSON 塞回去）
  for (const turn of history || []) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      // 用纯台词重建 assistant 上文，省 token 且更聚焦
      messages.push({ role: "assistant", content: turn.content });
    }
  }

  // 4. 本轮用户输入
  messages.push({ role: "user", content: userInput });
  return messages;
}

/* ── 主入口：生成一段 beat 演出序列 ──────────────────────── */
async function generateBeats({
  systemPrompt,
  character,
  history,
  emotionState,
  userInput,
  signal,
  onRaw,
}) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error("未配置 API Key，请先在右上角设置。");

  const messages = buildMessages({
    systemPrompt,
    character,
    history,
    emotionState,
    userInput,
  });

  const url = cfg.baseURL.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature ?? 0.9,
    // 大多数 OpenAI 兼容网关支持 response_format；不支持的会忽略
    response_format: { type: "json_object" },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    // 网络/CORS 错误
    throw new Error(
      `请求失败：${e.message}。若是 CORS 报错，说明该网关不允许浏览器直接调用，` +
        `需换支持 CORS 的网关或本地模型（如 LM Studio / Ollama 开 CORS）。`
    );
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j.error?.message || JSON.stringify(j);
    } catch {
      detail = await resp.text().catch(() => "");
    }
    throw new Error(`API ${resp.status}：${detail || resp.statusText}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof onRaw === "function") onRaw(content ?? "(空)");
  const parsed = extractJSON(content);

  if (!Array.isArray(parsed.beats)) {
    throw new Error("LLM 返回缺少 beats 数组。");
  }

  return {
    beats: normalizeBeats(parsed.beats),
    emotion_state: parsed.emotion_state || emotionState || null,
    // 回灌历史用的纯台词（拼接 dialogue beats）
    plainReply: parsed.beats
      .filter((b) => b.type === "dialogue")
      .map((b) => b.content)
      .join(""),
  };
}

/* ── 增量 beat 流式解析器 (方案A) ──────────────────────────
 * 喂入累积的文本，每当一个完整 beat 对象闭合就吐出来。
 * 不依赖整段 JSON 合法——只在 "beats" 数组范围内逐个抠对象。
 */
function createBeatStreamParser() {
  let buf = "";
  let scanFrom = 0;       // 下次扫描起点
  let inBeatsArray = false;

  function tryLocateBeatsArray() {
    if (inBeatsArray) return;
    const key = buf.indexOf('"beats"');
    if (key === -1) return;
    const bracket = buf.indexOf("[", key);
    if (bracket === -1) return;
    inBeatsArray = true;
    scanFrom = bracket + 1;
  }

  // 从 scanFrom 起，找下一个完整 { ... }（括号配平，忽略字符串内括号）
  function nextObject() {
    let i = scanFrom;
    while (i < buf.length && /[\s,]/.test(buf[i])) i++;
    if (i >= buf.length) { scanFrom = i; return null; }
    if (buf[i] === "]") { scanFrom = i; return null; }  // 数组结束
    if (buf[i] !== "{") { scanFrom = i; return null; }  // 还没到对象起点

    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < buf.length; j++) {
      const ch = buf[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const objStr = buf.slice(i, j + 1);
          scanFrom = j + 1;
          try { return JSON.parse(objStr); }
          catch { return null; }
        }
      }
    }
    scanFrom = i; // 没闭合，等更多数据
    return null;
  }

  return {
    /** 喂入累积后的完整文本，返回本次新闭合的 beat 数组 */
    feed(fullText) {
      buf = fullText;
      tryLocateBeatsArray();
      if (!inBeatsArray) return [];
      const out = [];
      let guard = 0;
      while (guard++ < 1000) {
        const before = scanFrom;
        const obj = nextObject();
        if (obj) { if (obj.type) out.push(obj); continue; }
        if (scanFrom === before) break; // 没进展，等更多数据
        break;                          // 遇到 ] 或非法对象
      }
      return out;
    },
    /** 流结束后用主解析器抠 emotion_state（鲁棒） */
    getEmotionState() {
      try { return extractJSON(buf).emotion_state || null; }
      catch { return null; }
    },
  };
}

/* ── 流式生成 beats (方案A) ────────────────────────────────
 * stream:true + SSE 读取 + 增量 beat 提取，beat 边到边回调。
 * 网关不支持 stream 时自动回退非流式。
 */
async function generateBeatsStream({
  systemPrompt, character, history, emotionState, userInput,
  signal, onBeat, onState, onRaw,
}) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error("未配置 API Key，请先在右上角设置。");

  const messages = buildMessages({ systemPrompt, character, history, emotionState, userInput });
  const url = cfg.baseURL.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature ?? 0.9,
    response_format: { type: "json_object" },
    stream: true,
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(`请求失败：${e.message}。若是 CORS 报错，说明该网关不允许浏览器直接调用。`);
  }

  if (!resp.ok) {
    let detail = "";
    try { const j = await resp.json(); detail = j.error?.message || JSON.stringify(j); }
    catch { detail = await resp.text().catch(() => ""); }
    throw new Error(`API ${resp.status}：${detail || resp.statusText}`);
  }

  // 网关不支持流式 → 回退非流式
  const ctype = resp.headers.get("content-type") || "";
  if (!resp.body || (!ctype.includes("event-stream") && ctype.includes("application/json"))) {
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    if (onRaw) onRaw(content);
    const parsed = extractJSON(content);
    const beats = normalizeBeats(parsed.beats || []);
    for (const b of beats) onBeat && onBeat(b);
    if (onState) onState(parsed.emotion_state || emotionState || null);
    return { plainReply: beats.filter((b) => b.type === "dialogue").map((b) => b.content).join("") };
  }

  // 真·流式：读 SSE
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const parser = createBeatStreamParser();
  let sseBuf = "";
  let contentAccum = "";
  const dialogueParts = [];

  const flush = () => {
    for (const raw of parser.feed(contentAccum)) {
      const [b] = normalizeBeats([raw]);
      if (!b) continue;
      if (b.type === "dialogue") dialogueParts.push(b.content);
      onBeat && onBeat(b);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) { contentAccum += delta; flush(); }
      } catch { /* 不完整 data 行，忽略 */ }
    }
  }

  if (onRaw) onRaw(contentAccum);
  if (onState) onState(parser.getEmotionState() || emotionState || null);
  return { plainReply: dialogueParts.join("") };
}

window.ArtiEmoLLM = {
  getConfig,
  saveConfig,
  clearConfig,
  isConfigured,
  generateBeats,
  generateBeatsStream,
  normalizeBeats,
  extractJSON,
  createBeatStreamParser,
  DEFAULT_CONFIG,
};
