// app.js — 一人用しりとりのフロントエンド処理

const currentWordEl = document.getElementById("current-word");
const historyEl = document.getElementById("history");
const messageEl = document.getElementById("message");
const formEl = document.getElementById("word-form");
const inputEl = document.getElementById("word-input");
const resetBtn = document.getElementById("reset-btn");

let gameOver = false;

// 画面の単語・履歴を更新する
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

// 現在の状態を取得して表示する
async function loadState() {
  const res = await fetch("/api/word");
  const data = await res.json();
  render(data.previousWord, data.history);
}

// 単語を送信する
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

  // エラー or ゲームオーバー
  setMessage(data.message, true);
  if (data.gameOver) {
    gameOver = true;
    inputEl.disabled = true;
    formEl.querySelector("button").disabled = true;
    setMessage(`${data.message} ゲームオーバー！「リセット」で再挑戦できます。`, true);
  }
}

// リセットする
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

// 初期表示
loadState();
