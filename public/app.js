// app.js — しりとりのフロントエンド（CPU対戦 + オンライン対戦）

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

// 「ん」終わり・重複の説明文
const REASON_TEXT = {
  ENDS_WITH_N: "「ん」で終わりました",
  DUPLICATE: "すでに使われた単語です",
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

// 履歴1件分の <li> を作る（誰の単語かのタグ付き）。対戦モードと共用。
function historyItem(word, label) {
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
  return li;
}

function renderCpu() {
  currentWordEl.textContent = cpuHistory[cpuHistory.length - 1].word;
  historyEl.innerHTML = "";
  for (const entry of cpuHistory) {
    historyEl.appendChild(historyItem(entry.word, BY_LABEL[entry.by]));
  }
}

function endCpu(youWon, messageText) {
  cpuFinished = true;
  setCpuStatus(youWon ? "あなたの勝ち！" : "あなたの負け…", youWon);
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
    }
    return;
  }

  // 自分の単語が通った
  cpuHistory.push({ word: nextWord, by: "you" });
  inputEl.value = "";
  renderCpu();
  setMessage("");

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

let ws = null;
let myTurn = false;
let finished = false;

const show = (el, visible) => el.classList.toggle("hidden", !visible);

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
  for (const word of history) {
    const li = document.createElement("li");
    li.textContent = word;
    mHistoryEl.appendChild(li);
  }
}

function endMulti(turnText, messageText) {
  finished = true;
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
    case "start":
      show(waitingEl, false);
      show(mGameEl, true);
      mMessageEl.textContent = "";
      renderMulti(msg.firstWord, [msg.firstWord]);
      setMyTurn(msg.yourTurn);
      break;
    case "update":
      mMessageEl.textContent = "";
      renderMulti(msg.previousWord, msg.history);
      setMyTurn(msg.yourTurn);
      mInputEl.value = "";
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
      }
      break;
    case "gameover": {
      // 自分の手番中に終了した側が負け（「ん」終わり・重複を出した本人）
      const youLost = myTurn;
      const reason = REASON_TEXT[msg.reason] ?? msg.reason;
      endMulti(
        youLost ? "あなたの負け…" : "あなたの勝ち！",
        `「${msg.word}」で${reason}`,
      );
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
  openWs(custom ? { type: "create", roomId: custom } : { type: "create" });
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
