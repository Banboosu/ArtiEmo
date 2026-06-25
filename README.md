# ArtiEmo

> LLM 情绪演出引擎 —— 用「停顿、表情、动作」消除 AI roleplay 的机械感。

传统 LLM roleplay 会一口气把所有文字吐出来，丢掉了真人对话里最有沉浸感的部分：
**停顿、犹豫、欲言又止、表情变化、肢体动作**。ArtiEmo 把 LLM 的输出重新组织成
一段可「演出」的 beat 序列，像 galgame 引擎一样逐拍播放。

## 当前状态：Phase 1 — 演出引擎原型

纯静态网页，零依赖，用模拟数据验证核心假设：**停顿到底能不能提升沉浸感。**

直接打开 `index.html` 即可运行（无需构建、无需服务器）：

```bash
# 任选其一
open index.html
# 或起个本地服务器
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

点「▶ 播放演出」看效果。可调速度、可跳过停顿（调试用）。

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

## 项目结构

```
ArtiEmo/
├── index.html        # 舞台：左表情区 + 右文字框 + 控件
├── src/
│   ├── engine.js     # ★ 演出引擎：beat 队列播放器（核心，与渲染解耦）
│   ├── app.js        # 应用层：renderer 实现 + 控件交互
│   └── styles.css    # galgame 风格样式
└── data/
    └── sample.js     # 示例 beat 脚本（情绪化对话样本）
```

`engine.js` 是核心，且**与 DOM 解耦**——它只决定「何时该做什么」，
具体怎么画交给注入的 `renderer`。未来换 UI 框架/换渲染目标都不动引擎。

## 路线图

- [x] **Phase 1** 演出引擎原型（模拟数据，验证沉浸感）
- [ ] **Phase 2** Beat 协议 Prompt：约束 LLM 输出该 JSON + 规则层补全 `pre_delay`
- [ ] **Phase 3** 情绪状态闭环：`emotion_state` 持久化 + 多轮漂移 + 角色卡系统
- [ ] **Phase 4** 立绘差分图替换 emoji、语音合成
