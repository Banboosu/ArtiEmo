/**
 * 示例 beat 脚本 —— 一段情绪化的对话。
 * 设计原则(v2):
 *   1. 动作克制：只在关键节点点一下，不是每句配动作。
 *   2. 情绪从台词本身渗出：靠措辞、语气词、停顿、断句体现，不靠旁白过度描述。
 *   3. 动作叙述直接用角色名，不用「她/他」。
 *
 * 场景：你问了綾一个她不太想回答的问题。
 */
window.SAMPLE_SCRIPT = {
  character: "綾",
  beats: [
    { type: "expression", emoji: "🙂", label: "平静", pre_delay: 200 },
    { type: "dialogue", content: "嗯？你说刚才那件事啊。", pre_delay: 300 },

    // 表情先变，态度的转折先于语言
    { type: "expression", emoji: "😟", label: "迟疑", pre_delay: 550 },

    // 情绪靠台词本身：欲言又止用断句和省略号，而不是旁白
    { type: "dialogue", content: "其实……", pre_delay: 850, typing_speed: 95 },
    { type: "dialogue", content: "算了。", pre_delay: 1000, typing_speed: 85 },

    { type: "expression", emoji: "😔", label: "落寞", pre_delay: 450 },

    // 全场只保留这一个动作，落在最关键处
    { type: "action", content: "綾绞着衣角，没有抬头", pre_delay: 650 },

    { type: "dialogue", content: "没什么。当我没问过吧。", pre_delay: 1100, typing_speed: 70 },

    { type: "expression", emoji: "😶", label: "勉强", pre_delay: 650 },
    { type: "dialogue", content: "我没事的——真的。", pre_delay: 800 }
  ],
  emotion_state: { mood: "withdrawn", affection: 38, energy: 0.45 }
};
