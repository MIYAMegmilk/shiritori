// app.js — しりとりのフロントエンド（CPU対戦 + オンライン対戦）

// ===== 効果音 =====
// 音声ファイルは使わず Web Audio API で鳴らす。
// AudioContext はユーザー操作をきっかけに初めて作る（ブラウザの自動再生制限のため）。
const sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem("shiritori-muted") === "1";

  function tone(freq, startDelay, duration, type = "sine", volume = 0.12) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime + startDelay;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  const PATTERNS = {
    ok:    () => tone(880, 0, 0.12),
    error: () => tone(196, 0, 0.2, "square", 0.06),
    win:   () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.18, "triangle")),
    lose:  () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.22, "triangle")),
    tick:  () => tone(1200, 0, 0.05, "sine", 0.05),
  };

  return {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      localStorage.setItem("shiritori-muted", muted ? "1" : "0");
    },
    play(name) {
      if (muted) return;
      try {
        ctx ??= new (window.AudioContext ?? window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        PATTERNS[name]?.();
      } catch {
        // 音を鳴らせない環境では黙って無視する
      }
    },
  };
})();

const muteBtn = document.getElementById("mute-btn");
const renderMuteBtn = () => (muteBtn.textContent = sound.muted ? "🔇" : "🔊");
muteBtn.addEventListener("click", () => {
  sound.toggle();
  renderMuteBtn();
});
renderMuteBtn();

// CSSアニメーションをやり直すためにクラスを付け直す。
function animate(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // reflowを挟むと同じアニメーションを再生できる
  el.classList.add(className);
}

// ===== モード切替タブ =====
const tabs = document.querySelectorAll(".tab");
const panels = {
  cpu: document.getElementById("cpu"),
  multi: document.getElementById("multi"),
};
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    panels.cpu.classList.toggle("hidden", mode !== "cpu");
    panels.multi.classList.toggle("hidden", mode !== "multi");
  });
});

// ゲーム終了理由の説明文
const REASON_TEXT = {
  ENDS_WITH_N: "「ん」で終わりました",
  DUPLICATE: "すでに使われた単語です",
  TIME_UP: "時間切れです",
};

// ===== CPU対戦 =====
// 履歴はクライアントが持つ。by は "start"（初期単語）| "you" | "cpu"。
const cpuStatusEl = document.getElementById("cpu-status");
const currentWordEl = document.getElementById("current-word");
const historyEl = document.getElementById("history");
const messageEl = document.getElementById("message");
const formEl = document.getElementById("word-form");
const inputEl = document.getElementById("word-input");
const resetBtn = document.getElementById("reset-btn");

const BY_LABEL = { start: "スタート", you: "あなた", cpu: "CPU" };

let cpuHistory = [];      // {word, by} の配列
let cpuFinished = false;
let cpuBusy = false;      // CPUが考え中（入力を受け付けない）
let cpuGen = 0;           // リセットで無効になった応答を捨てるための世代番号

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function setCpuInputEnabled(on) {
  inputEl.disabled = !on;
  formEl.querySelector("button").disabled = !on;
}

function setCpuStatus(text, active = false) {
  cpuStatusEl.textContent = text;
  cpuStatusEl.classList.toggle("active-turn", active);
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
}

// 履歴1件分の <li> を作る（誰の単語かのタグと得点付き）。対戦モードと共用。
function historyItem(word, label, points = 0) {
  const li = document.createElement("li");
  const wordSpan = document.createElement("span");
  wordSpan.textContent = word;
  li.appendChild(wordSpan);
  if (label) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = label;
    li.appendChild(tag);
  }
  if (points > 0) {
    const pts = document.createElement("span");
    pts.className = "pts";
    pts.textContent = `+${points}`;
    li.appendChild(pts);
  }
  return li;
}

const cpuScoreYouEl = document.getElementById("cpu-score-you");
const cpuScoreCpuEl = document.getElementById("cpu-score-cpu");

function renderCpu() {
  currentWordEl.textContent = cpuHistory[cpuHistory.length - 1].word;
  animate(currentWordEl, "pop");
  historyEl.innerHTML = "";
  // スコア = 自分／CPUが出した単語の文字数の累計
  const scores = { you: 0, cpu: 0 };
  for (const entry of cpuHistory) {
    const points = entry.by === "start" ? 0 : entry.word.length;
    if (points > 0) scores[entry.by] += points;
    historyEl.appendChild(historyItem(entry.word, BY_LABEL[entry.by], points));
  }
  historyEl.lastElementChild?.classList.add("new");
  cpuScoreYouEl.textContent = `${scores.you}点`;
  cpuScoreCpuEl.textContent = `${scores.cpu}点`;
}

function endCpu(youWon, messageText) {
  cpuFinished = true;
  setCpuStatus(youWon ? "あなたの勝ち！" : "あなたの負け…", youWon);
  animate(cpuStatusEl, "result");
  sound.play(youWon ? "win" : "lose");
  setMessage(`${messageText} 「リセット」で再挑戦できます。`, !youWon);
  setCpuInputEnabled(false);
}

async function startCpuGame() {
  cpuGen++;
  const res = await fetch("/api/cpu/start", { method: "POST" });
  const data = await res.json();
  cpuHistory = [{ word: data.firstWord, by: "start" }];
  cpuFinished = false;
  cpuBusy = false;
  renderCpu();
  setMessage("");
  setCpuStatus("あなたの番です", true);
  setCpuInputEnabled(true);
  inputEl.value = "";
}

async function submitCpuWord(nextWord) {
  const gen = cpuGen;
  const res = await fetch("/api/cpu/word", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nextWord, history: cpuHistory.map((e) => e.word) }),
  });
  const data = await res.json();
  if (gen !== cpuGen) return; // 通信中にリセットされた

  if (!res.ok) {
    if (data.gameOver) {
      endCpu(false, `「${nextWord}」…${data.message}。`);
    } else {
      setMessage(data.message, true);
      sound.play("error");
      animate(inputEl, "shake");
    }
    return;
  }

  // 自分の単語が通った
  cpuHistory.push({ word: nextWord, by: "you" });
  inputEl.value = "";
  renderCpu();
  setMessage("");
  sound.play("ok");

  // CPUの手番（考えている風の間を置く）
  cpuBusy = true;
  setCpuInputEnabled(false);
  setCpuStatus("コンピュータが考えています…");
  await delay(500 + Math.random() * 700);
  if (gen !== cpuGen) return;
  cpuBusy = false;

  if (data.cpuWord) {
    cpuHistory.push({ word: data.cpuWord, by: "cpu" });
    renderCpu();
  }

  if (data.cpuGameOver) {
    if (data.reason === "NO_WORD") {
      endCpu(true, "コンピュータは続く単語を思いつきませんでした！");
    } else {
      endCpu(true, `コンピュータが「${data.cpuWord}」…「ん」で終わりました！`);
    }
  } else {
    setCpuStatus("あなたの番です", true);
    setCpuInputEnabled(true);
    inputEl.focus();
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const word = inputEl.value.trim();
  if (!word || cpuFinished || cpuBusy) return;
  submitCpuWord(word);
});

resetBtn.addEventListener("click", startCpuGame);

startCpuGame();

// ===== 対戦 =====
const nameInput = document.getElementById("multi-name");
const quickBtn = document.getElementById("quick-btn");
const createBtn = document.getElementById("create-btn");
const customCodeInput = document.getElementById("custom-code");
const joinForm = document.getElementById("join-form");
const roomCodeInput = document.getElementById("room-code");
const setupMessageEl = document.getElementById("setup-message");
const setupEl = document.getElementById("multi-setup");
const waitingEl = document.getElementById("multi-waiting");
const shareBoxEl = document.getElementById("share-box");
const roomCodeDisplayEl = document.getElementById("room-code-display");
const shareUrlEl = document.getElementById("share-url");
const copyBtn = document.getElementById("copy-btn");
const mGameEl = document.getElementById("multi-game");
const mTurnEl = document.getElementById("multi-turn");
const mCurrentEl = document.getElementById("multi-current-word");
const mFormEl = document.getElementById("multi-form");
const mInputEl = document.getElementById("multi-input");
const mMessageEl = document.getElementById("multi-message");
const mHistoryEl = document.getElementById("multi-history");
const mScoreNameYouEl = document.getElementById("multi-score-name-you");
const mScoreNameOppEl = document.getElementById("multi-score-name-opp");
const mScoreYouEl = document.getElementById("multi-score-you");
const mScoreOppEl = document.getElementById("multi-score-opp");
const settingTimeEl = document.getElementById("setting-time");
const settingFirstEl = document.getElementById("setting-first");
const settingDictEl = document.getElementById("setting-dict");
const settingsInfoEl = document.getElementById("multi-settings-info");
const timerEl = document.getElementById("timer");
const timerFillEl = document.getElementById("timer-fill");
const timerTextEl = document.getElementById("timer-text");

let ws = null;
let myTurn = false;
let finished = false;
let myIdx = 0;         // 自分が players の何番目か（startメッセージで確定）
let firstMoverIdx = 0; // 最初に手番だった側。履歴の何番目を誰が出したかの判定に使う

const show = (el, visible) => el.classList.toggle("hidden", !visible);

// ===== ターンの残り時間表示 =====
// 実際の時間切れ判定はサーバーが行い、ここでは見た目のカウントダウンだけを担当する。
let timeLimitSec = 0;
let countdownId = null;

function stopCountdown() {
  if (countdownId !== null) {
    clearInterval(countdownId);
    countdownId = null;
  }
}

function startCountdown() {
  stopCountdown();
  if (!timeLimitSec) return;
  const deadline = Date.now() + timeLimitSec * 1000;
  show(timerEl, true);
  let lastTickSec = Infinity;
  const tick = () => {
    const remainMs = Math.max(0, deadline - Date.now());
    const secs = Math.ceil(remainMs / 1000);
    timerTextEl.textContent = `${secs}秒`;
    timerFillEl.style.width = `${(remainMs / (timeLimitSec * 1000)) * 100}%`;
    timerEl.classList.toggle("urgent", secs <= 5);
    // 残り5秒からは1秒ごとにカチカチ鳴らす
    if (secs <= 5 && secs > 0 && secs < lastTickSec) {
      lastTickSec = secs;
      sound.play("tick");
    }
    if (remainMs <= 0) stopCountdown();
  };
  tick();
  countdownId = setInterval(tick, 100);
}

function setMyTurn(yourTurn) {
  myTurn = yourTurn;
  mTurnEl.textContent = yourTurn ? "あなたの番です" : "相手の番です";
  mTurnEl.classList.toggle("active-turn", yourTurn);
  mInputEl.disabled = !yourTurn;
  mFormEl.querySelector("button").disabled = !yourTurn;
}

function renderMulti(previousWord, history) {
  mCurrentEl.textContent = previousWord;
  mHistoryEl.innerHTML = "";
  // 履歴の1語目は初期単語、以降は最初の手番から交互に出している
  history.forEach((word, i) => {
    if (i === 0) {
      mHistoryEl.appendChild(historyItem(word, "スタート"));
      return;
    }
    const idx = (firstMoverIdx + i - 1) % 2;
    mHistoryEl.appendChild(historyItem(word, idx === myIdx ? "あなた" : "相手", word.length));
  });
  if (history.length > 1) mHistoryEl.lastElementChild.classList.add("new");
  animate(mCurrentEl, "pop");
}

function renderMultiScores(scores) {
  if (!scores) return;
  mScoreYouEl.textContent = `${scores[myIdx]}点`;
  mScoreOppEl.textContent = `${scores[1 - myIdx]}点`;
}

function endMulti(turnText, messageText) {
  finished = true;
  stopCountdown();
  show(timerEl, false);
  mTurnEl.textContent = turnText;
  mTurnEl.classList.remove("active-turn");
  mMessageEl.textContent = messageText;
  mInputEl.disabled = true;
  mFormEl.querySelector("button").disabled = true;
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "created": {
      // 部屋作成 → 合言葉と共有URLを表示
      const url = `${location.origin}/?room=${encodeURIComponent(msg.roomId)}`;
      roomCodeDisplayEl.textContent = msg.roomId;
      shareUrlEl.value = url;
      show(shareBoxEl, true);
      break;
    }
    case "waiting":
      show(waitingEl, true);
      break;
    case "start": {
      show(waitingEl, false);
      show(mGameEl, true);
      mMessageEl.textContent = "";
      // 部屋の設定を表示し、制限時間ありならカウントダウンを始める
      const s = msg.settings ?? {};
      timeLimitSec = s.timeLimitSec ?? 0;
      settingsInfoEl.textContent = [
        `制限時間: ${timeLimitSec ? `${timeLimitSec}秒` : "なし"}`,
        `辞書判定: ${s.dictCheck === false ? "なし" : "あり"}`,
      ].join(" ／ ");
      // スコア表示の名前と、履歴のタグ判定に使う情報を覚えておく
      myIdx = msg.you ?? 0;
      firstMoverIdx = msg.yourTurn ? myIdx : 1 - myIdx;
      mScoreNameYouEl.textContent = "あなた";
      mScoreNameOppEl.textContent = msg.players?.[1 - myIdx] || "相手";
      renderMultiScores(msg.scores);
      renderMulti(msg.firstWord, [msg.firstWord]);
      setMyTurn(msg.yourTurn);
      startCountdown();
      break;
    }
    case "update":
      mMessageEl.textContent = "";
      renderMulti(msg.previousWord, msg.history);
      renderMultiScores(msg.scores);
      setMyTurn(msg.yourTurn);
      mInputEl.value = "";
      sound.play("ok");
      startCountdown();
      break;
    case "error":
      if (mGameEl.classList.contains("hidden")) {
        // マッチング前のエラー（部屋が無い・満員）→ セットアップに戻す
        finished = true;
        setupMessageEl.textContent = msg.message;
        setupMessageEl.classList.add("error");
        show(waitingEl, false);
        show(setupEl, true);
        if (ws) ws.close();
      } else {
        mMessageEl.textContent = msg.message;
        mMessageEl.classList.add("error");
        sound.play("error");
        animate(mInputEl, "shake");
      }
      break;
    case "gameover": {
      // 手番中に終了した側が負け（「ん」終わり・重複・時間切れを出した本人）
      const youLost = myTurn;
      const reason = REASON_TEXT[msg.reason] ?? msg.reason;
      endMulti(
        youLost ? "あなたの負け…" : "あなたの勝ち！",
        msg.word ? `「${msg.word}」で${reason}` : reason,
      );
      animate(mTurnEl, "result");
      sound.play(youLost ? "lose" : "win");
      break;
    }
    case "opponent_left":
      endMulti("", `${msg.message} あなたの不戦勝です。`);
      break;
  }
}

// 名前を添えてWebSocketを開き、最初のメッセージ(quick/create/join)を送る。
function openWs(initialMessage) {
  const name = nameInput.value.trim() || "プレイヤー";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  finished = false;
  setupMessageEl.textContent = "";
  ws.onopen = () => ws.send(JSON.stringify({ ...initialMessage, name }));
  ws.onmessage = (ev) => handleServerMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    // 対戦中に切れた場合だけ通知する（マッチング前の意図的なcloseは無視）
    if (!finished && !mGameEl.classList.contains("hidden")) {
      endMulti("", "接続が切れました。");
    }
  };
  show(setupEl, false);
  show(waitingEl, true);
}

quickBtn.addEventListener("click", () => openWs({ type: "quick" }));
createBtn.addEventListener("click", () => {
  const custom = customCodeInput.value.trim();
  // 部屋主が決めた設定を添えて部屋を作る
  const settings = {
    timeLimitSec: Number(settingTimeEl.value),
    firstTurn: settingFirstEl.value,
    dictCheck: settingDictEl.value !== "off",
  };
  openWs({ type: "create", roomId: custom || undefined, settings });
});

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = roomCodeInput.value.trim();
  if (!code) {
    setupMessageEl.textContent = "合言葉を入力してください";
    setupMessageEl.classList.add("error");
    roomCodeInput.focus();
    return;
  }
  openWs({ type: "join", roomId: code });
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.value);
    copyBtn.textContent = "コピーしました";
    setTimeout(() => (copyBtn.textContent = "URLをコピー"), 1500);
  } catch {
    shareUrlEl.select();
    document.execCommand("copy");
  }
});

mFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const word = mInputEl.value.trim();
  if (!word || !myTurn || finished || !ws) return;
  ws.send(JSON.stringify({ type: "word", nextWord: word }));
});

// URLに ?room=合言葉 があれば、対戦タブを開いてコードを入れておく。
const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam) {
  document.querySelector('.tab[data-mode="multi"]').click();
  roomCodeInput.value = roomParam.toUpperCase();
  nameInput.focus();
}
