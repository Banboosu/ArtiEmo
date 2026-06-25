# ArtiEmo

> LLM 情绪演出引擎 —— 用「停顿、表情、动作」消除 AI roleplay 的机械感。

传统 LLM roleplay 会一口气把所有文字吐出来，丢掉了真人对话里最有沉浸感的部分：
**停顿、犹豫、欲言又止、表情变化、肢体动作**。ArtiEmo 把 LLM 的输出重新组织成
一段可「演出」的 beat 序列，像 galgame 引擎一样逐拍播放。

## 当前状态：Phase 2 — 接真实 LLM（BYOK，纯静态零后端）

纯静态网页，零依赖、零后端。两种模式：

- **演示模式**（未配置 Key）：点「▶ 播放演示」播放内置样例脚本，验证演出节奏。
- **实时模式**（配置 Key 后）：在输入框对话 → LLM 按 beat 协议输出 → 引擎逐拍演出。

直接打开 `index.html` 即可运行（无需构建）。注意纯本地打开（file://）调真实接口可能受
浏览器 CORS 限制，建议起个本地服务器：

```bash
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

### 接 LLM（BYOK）

点右上角 ⚙ 设置，填入：

| 字段 | 说明 |
|------|------|
| 接口地址 | OpenAI 兼容 baseURL，填到 `/v1`（自动拼 `/chat/completions`）。可填任意兼容网关，或本地模型 LM Studio / Ollama |
| API Key | 你自己的 key |
| 模型 | 如 `gpt-4o-mini` |
| 角色卡 | 可选，留空用默认「綾」 |

> ⚠️ **Key 只存在本机浏览器 localStorage，无后端、不上传**。请求直接从浏览器打到你填的接口。
> 建议用临时/低额度 Key，或本地模型。某些网关不允许浏览器跨域调用（CORS），换支持 CORS 的网关即可。

### 容错设计

- LLM 返回的 JSON 即使被 ```` ```json ```` 包裹、或前后带解释文字，也能抠出来解析。
- 规则层 `normalizeBeats` 给所有 beat 兜底补全 `pre_delay` / `typing_speed`，
  即使 LLM 漏给或给了离谱值，演出仍有节奏（这是「演出引擎」对「内容生成」的最后防线）。
- `emotion_state` 每轮回灌给 LLM，实现连贯情绪漂移。

## 核心概念：Beat 协议

整个项目的地基。LLM 输出 / 前端渲染都围绕这个契约：

```jsonc
{
  "beats": [
    { "type": "expression", "emoji": "😟", "label": "迟疑", "pre_delay": 500 },
    { "type": "action",     "content": "她的视线移开了", "pre_delay": 700 },
    { "type": "dialogue",   "content": "其实……", "pre_delay": 900, "typing_speed": 90 }
  ],
  "emotion_state": { "mood": "withdrawn", "affection": 38, "energy": 0.45 }
}
```

| 字段 | 说明 |
|------|------|
| `type` | `expression`(表情) / `action`(第三人称动作) / `dialogue`(第一人称语言) |
| `pre_delay` | **该 beat 播放前的停顿(ms)** —— 消除机械感的关键 |
| `typing_speed` | 每字毫秒数，仅 action/dialogue |
| `emotion_state` | 情绪状态，随对话漂移，下一轮回传给 LLM 作上下文 |

- **语言与动作分离**：两者都进文字框，但视觉区分（动作斜体+括号+异色），且可任意先后混排。
- **表情显示在文字框左边**：emoji + 标签双显示，方便调试期对照。
- **前端严格按数组顺序播放**：顺序、停顿、混排全由 beat 序列决定。

### 演出原则（写 prompt 时的硬约束）

1. **动作克制**：只在关键节点点一下，不是每句配动作。多数 beat 应是表情+对话。
2. **情绪从台词渗出**：靠措辞、语气词、停顿、断句体现情绪，不靠旁白过度描述。
   好的演出是「话里有情绪」，不是「旁白告诉你她有情绪」。
3. **动作叙述直接用角色名**（如「綾绞着衣角」），不用「她/他」。

## 项目结构

```
ArtiEmo/
├── index.html        # 舞台 + 输入框 + 设置面板
├── src/
│   ├── engine.js     # ★ 演出引擎：beat 队列播放器（核心，与渲染解耦，Phase 1 起不动）
│   ├── llm.js        # ★ BYOK LLM 客户端：OpenAI 兼容请求 + 容错 JSON 解析 + 规则层补全
│   ├── app.js        # 应用层：renderer 实现 + 演示/实时双模式 + 设置面板 + 对话循环
│   └── styles.css    # galgame 风格样式
├── prompts/
│   ├── beat-protocol.system.md   # beat 协议 system prompt（人读版）
│   └── beat-protocol.system.js   # 同内容 JS 版（前端 import，保持同步）
└── data/
    ├── sample.js     # 演示模式的示例 beat 脚本
    └── character.js  # 默认角色卡（可被设置面板覆盖）
```

`engine.js` 是核心，且**与 DOM 解耦**——它只决定「何时该做什么」，
具体怎么画交给注入的 `renderer`。未来换 UI 框架/换渲染目标都不动引擎。
`llm.js` 也与引擎解耦——它只负责「拿到一段合法的 beat 序列」，怎么演由引擎管。

## 路线图

- [x] **Phase 1** 演出引擎原型（模拟数据，验证沉浸感）
- [x] **Phase 2** 接真实 LLM：beat 协议 prompt + BYOK OpenAI 兼容客户端 + 规则层补全 + emotion_state 多轮漂移
- [ ] **Phase 3** 情绪状态深化：emotion_state 持久化 + 角色卡库 + 存档/读档
- [ ] **Phase 4** 立绘差分图替换 emoji、语音合成
