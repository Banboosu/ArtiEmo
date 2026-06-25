/**
 * 示例 beat 脚本 —— 一段情绪化的对话，刻意带犹豫、停顿、动作与语言的混排。
 * 这是用来验证「停顿是否真的提升沉浸感」的样本数据，未来由 LLM 生成。
 *
 * 场景：你问了她一个不太想回答的问题。
 */
window.SAMPLE_SCRIPT = {
  beats: [
    { type: "expression", emoji: "🙂", label: "平静", pre_delay: 200 },
    { type: "dialogue", content: "嗯？你说刚才那件事啊。", pre_delay: 300 },

    // 表情先变，制造「她的态度变了」的预感
    { type: "expression", emoji: "😟", label: "迟疑", pre_delay: 500 },
    { type: "action", content: "她的视线移开了，落在桌角", pre_delay: 700 },

    // 长停顿 = 欲言又止
    { type: "dialogue", content: "其实……", pre_delay: 900, typing_speed: 90 },
    { type: "action", content: "话说到一半又咽了回去", pre_delay: 600 },

    { type: "expression", emoji: "😔", label: "落寞", pre_delay: 400 },
    { type: "action", content: "她轻轻摇了摇头，手指无意识地绞着衣角", pre_delay: 700 },
    { type: "dialogue", content: "……没什么。当我没问过吧。", pre_delay: 1100, typing_speed: 75 },

    // 情绪回弹一点点，留个钩子
    { type: "expression", emoji: "😶", label: "勉强", pre_delay: 600 },
    { type: "dialogue", content: "我没事的，真的。", pre_delay: 800 }
  ],
  emotion_state: { mood: "withdrawn", affection: 38, energy: 0.45 }
};
