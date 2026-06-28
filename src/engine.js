/**
 * ArtiEmo 演出引擎 (Performance Engine)
 * ------------------------------------
 * 职责：接收一个 beat 序列，按顺序逐 beat 播放，模拟 galgame 演出节奏。
 * 核心价值 = 消除「机械感」：beat 之间的停顿(pre_delay) + 逐字打字(typing_speed)。
 *
 * Beat 协议 (项目地基，前后端共享的契约):
 *   { type: "expression", emoji, label, pre_delay }
 *   { type: "action",     content, pre_delay, typing_speed? }   // 第三人称叙述
 *   { type: "dialogue",   content, pre_delay, typing_speed? }   // 第一人称台词
 *
 * 引擎与渲染解耦：引擎只负责「何时该做什么」，具体怎么画交给注入的 renderer。
 */

class PerformanceEngine {
  /**
   * @param {object} renderer  渲染回调集合
   *   renderer.setExpression(emoji, label)
   *   renderer.beginLine(type) -> 返回一个 lineHandle
   *   renderer.appendChar(lineHandle, char)
   *   renderer.endLine(lineHandle)
   *   renderer.onState(emotionState)
   *   renderer.onDone()
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.defaultTypingSpeed = opts.defaultTypingSpeed ?? 55; // ms / 字
    this.speed = 1;          // 全局速度倍率 (1 = 原速)
    this.skipDelays = false; // 跳过 pre_delay (调试用)
    this._cancelled = false;
    this._running = false;
  }

  setSpeed(mult) { this.speed = mult > 0 ? mult : 1; }
  setSkipDelays(v) { this.skipDelays = !!v; }

  cancel() { this._cancelled = true; }

  _sleep(ms) {
    const scaled = this.skipDelays ? 0 : ms / this.speed;
    return new Promise((res) => setTimeout(res, scaled));
  }

  async _typeOut(lineHandle, text, perChar) {
    for (const ch of text) {
      if (this._cancelled) return;
      this.renderer.appendChar(lineHandle, ch);
      // 标点处天然多停一拍，更像真人打字
      const extra = /[，。、！？…—,.!?]/.test(ch) ? perChar * 2.5 : 0;
      await this._sleep(perChar + extra); // _sleep 内部已按 speed 缩放
    }
  }

  /**
   * 播放一个完整脚本（非流式，一次性传入全部 beats）
   * @param {object} script  { beats: [...], emotion_state?: {...} }
   */
  async play(script) {
    if (this._running) return;
    this._running = true;
    this._cancelled = false;

    const beats = script.beats || [];
    for (const beat of beats) {
      if (this._cancelled) break;
      await this._playBeat(beat);
    }

    if (script.emotion_state) this.renderer.onState(script.emotion_state);
    if (!this._cancelled) this.renderer.onDone();
    this._running = false;
  }

  /** 播放单个 beat（pre_delay → 表情/打字），play 与 playStream 共用 */
  async _playBeat(beat) {
    // 1. 关键：beat 播放前的停顿 —— 这是「思考/犹豫/欲言又止」的来源
    await this._sleep(beat.pre_delay ?? 0);
    if (this._cancelled) return;

    if (beat.type === "expression") {
      this.renderer.setExpression(beat.emoji, beat.label);
    } else if (beat.type === "dialogue" || beat.type === "action") {
      const handle = this.renderer.beginLine(beat.type);
      const speed = beat.typing_speed ?? this.defaultTypingSpeed;
      await this._typeOut(handle, beat.content ?? "", speed);
      this.renderer.endLine(handle);
    }
  }

  /**
   * 流式播放：beat 边到边演，不必等整段生成完。
   * 返回一个「控制器」，生产者(llm.js)通过它推送 beat / 结束 / 报错。
   *
   *   const ctrl = engine.playStream();
   *   ctrl.push(beat);            // 收到一个完整 beat 就推进来
   *   ctrl.setState(emotionState);// 收到 emotion_state（可选，通常在最后）
   *   ctrl.done();                // 流正常结束
   *   ctrl.fail(err);             // 流出错（已演出的部分保留）
   *
   * 引擎内部维护一个队列：有 beat 就播，没 beat 但流没结束就等待。
   * 这样「第一个 beat 一到就开始演」，首字延迟 = 第一个 beat 的生成时间。
   */
  playStream() {
    if (this._running) return null;
    this._running = true;
    this._cancelled = false;

    const queue = [];
    let finished = false;
    let pendingState = null;
    let notify = null; // 唤醒等待中的消费者

    const wake = () => {
      if (notify) { notify(); notify = null; }
    };

    // 消费者循环：串行播放队列里的 beat
    const consumer = (async () => {
      while (!this._cancelled) {
        if (queue.length === 0) {
          if (finished) break;
          // 队列空且流未结束 —— 等待新 beat 或结束信号
          await new Promise((res) => { notify = res; });
          continue;
        }
        const beat = queue.shift();
        await this._playBeat(beat);
      }
      if (pendingState) this.renderer.onState(pendingState);
      if (!this._cancelled) this.renderer.onDone();
      this._running = false;
    })();

    return {
      push: (beat) => { if (beat) { queue.push(beat); wake(); } },
      setState: (s) => { pendingState = s; },
      done: () => { finished = true; wake(); },
      fail: () => { finished = true; wake(); }, // 出错也让消费者收尾，保留已演部分
      whenDone: () => consumer,
    };
  }
}

window.PerformanceEngine = PerformanceEngine;
