// app.js — しりとりのフロントエンド（一人用 + 対戦）

// ===== モード切替タブ =====
const tabs = document.querySelectorAll(".tab");
const panels = {
  single: document.getElementById("single"),
  multi: document.getElementById("multi"),
};
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    panels.single.classList.toggle("hidden", mode !== "single");
    panels.multi.classList.toggle("hidden", mode !== "multi");
  });
});

// 「ん」終わり・重複の説明文
const REASON_TEXT = {
  ENDS_WITH_N: "「ん」で終わりました",
  DUPLICATE: "すでに使われた単語です",
};

// ===== 一人用 =====
const currentWordEl = document.getElementById("current-word");
const historyEl = document.getElementById("history");
const messageEl = document.getElementById("message");
const formEl = document.getElementById("word-form");
const inputEl = document.getElementById("word-input");
const resetBtn = document.getElementById("reset-btn");

let gameOver = false;

function render(previousWord, history) {
  currentWordEl.textContent = previousWord;
  historyEl.innerHTML = "";
  for (const word of history) {
    const li = document.createElement("li");
    li.textContent = word;
    historyEl.appendChild(li);
  }
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
}

async function loadState() {
  const res = await fetch("/api/word");
  const data = await res.json();
  render(data.previousWord, data.history);
}

async function submitWord(nextWord) {
  const res = await fetch("/api/word", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nextWord }),
  });
  const data = await res.json();

  if (res.ok && data.valid) {
    render(data.previousWord, data.history);
    setMessage("");
    inputEl.value = "";
    return;
  }

  setMessage(data.message, true);
  if (data.gameOver) {
    gameOver = true;
    inputEl.disabled = true;
    formEl.querySelector("button").disabled = true;
    setMessage(`${data.message} ゲームオーバー！「リセット」で再挑戦できます。`, true);
  }
}

async function reset() {
  const res = await fetch("/api/reset", { method: "POST" });
  const data = await res.json();
  render(data.previousWord, data.history);
  setMessage("");
  gameOver = false;
  inputEl.disabled = false;
  inputEl.value = "";
  formEl.querySelector("button").disabled = false;
  inputEl.focus();
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const word = inputEl.value.trim();
  if (!word || gameOver) return;
  submitWord(word);
});

resetBtn.addEventListener("click", reset);

loadState();

// ===== 対戦 =====
const matchForm = document.getElementById("match-form");
const nameInput = document.getElementById("multi-name");
const setupEl = document.getElementById("multi-setup");
const waitingEl = document.getElementById("multi-waiting");
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
      mMessageEl.textContent = msg.message;
      mMessageEl.classList.add("error");
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

matchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim() || "プレイヤー";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  finished = false;
  ws.onopen = () => ws.send(JSON.stringify({ type: "join", name }));
  ws.onmessage = (ev) => handleServerMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    if (!finished) endMulti("", "接続が切れました。");
  };
  show(setupEl, false);
  show(waitingEl, true);
});

mFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const word = mInputEl.value.trim();
  if (!word || !myTurn || finished || !ws) return;
  ws.send(JSON.stringify({ type: "word", nextWord: word }));
});
