/**
 * ArtiEmo 应用层 —— 把演出引擎接到 DOM 上。
 * 实现 renderer 接口，处理控件交互。
 */

const $ = (id) => document.getElementById(id);

const portrait = $("portrait");
const emojiEl = $("emoji");
const labelEl = $("label");
const textflow = $("textflow");
const continueHint = $("continueHint");
const stateReadout = $("stateReadout");
const playBtn = $("playBtn");
const skipBtn = $("skipBtn");
const speedRange = $("speedRange");
const speedVal = $("speedVal");

// renderer：引擎调用这些回调来「演出」
const renderer = {
  setExpression(emoji, label) {
    emojiEl.textContent = emoji;
    labelEl.textContent = label;
    // 轻微弹一下，让表情切换有存在感
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
    stateReadout.textContent =
      `mood:${state.mood}  affection:${state.affection}  energy:${state.energy}`;
  },

  onDone() {
    continueHint.classList.add("show");
    playBtn.disabled = false;
    playBtn.textContent = "▶ 重播";
  }
};

const engine = new PerformanceEngine(renderer, { defaultTypingSpeed: 55 });

function startPlay() {
  // 重置舞台
  textflow.innerHTML = "";
  continueHint.classList.remove("show");
  stateReadout.textContent = "";
  emojiEl.textContent = "🙂";
  labelEl.textContent = "平静";
  playBtn.disabled = true;
  playBtn.textContent = "演出中…";
  engine.cancel();           // 取消上一场(若有)
  setTimeout(() => engine.play(window.SAMPLE_SCRIPT), 50);
}

playBtn.addEventListener("click", startPlay);

skipBtn.addEventListener("click", () => {
  const on = !engine.skipDelays;
  engine.setSkipDelays(on);
  skipBtn.classList.toggle("ghost", !on);
  skipBtn.textContent = on ? "✓ 已跳过停顿" : "跳过停顿";
});

speedRange.addEventListener("input", () => {
  const v = parseFloat(speedRange.value);
  engine.setSpeed(v);
  speedVal.textContent = v.toFixed(2) + "x";
});
