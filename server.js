import { serveDir } from "@std/http/file-server";
import { buildFirstCharIndex, pickCpuWord, pickInitialWord, validateWord } from "./game.js";
import { RoomManager } from "./room.js";

const PORT = Number(Deno.env.get("PORT") ?? 8000);

// 起動時に辞書を読み込む。ローカルはCRLF・Deno DeployはLFなので両対応で分割する。
// - words.txt       … IPAdicの名詞（一般＋固有）。入力の受理判定とCPUの語彙に使う
// - words_extra.txt … NEologd由来の新語・カタカナ語。入力の受理判定にだけ使う
//   （俗語なども含まれるため、CPUの返答には使わない）
const readWords = async (path) => {
  const text = await Deno.readTextFile(new URL(path, import.meta.url));
  return text.split(/\r?\n/).filter(Boolean);
};
const words = await readWords("./dict/words.txt");
const extraWords = await readWords("./dict/words_extra.txt").catch(() => []);
const dict = new Set(words);
for (const w of extraWords) dict.add(w);
const firstCharIndex = buildFirstCharIndex(words);
console.log(`辞書を読み込みました: 基本 ${words.length} 語 / 追加 ${extraWords.length} 語`);

// 対戦用のルーム管理。
const rooms = new RoomManager(dict, words);
let nextPlayerId = 1;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// CPU対戦のAPI。ゲームの履歴はクライアントが持ち、
// サーバーは「プレイヤーの単語の検証」と「CPUの返答」だけを担当する（ステートレス）。
async function handleApi(req, pathname) {
  // 新しいゲームを開始する（ランダムな最初の単語を返す）
  if (pathname === "/api/cpu/start" && req.method === "POST") {
    return json({ firstWord: pickInitialWord(words) });
  }

  // プレイヤーの単語を検証し、OKならCPUの返答を返す
  if (pathname === "/api/cpu/word" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const nextWord = (body.nextWord ?? "").trim();
    const history = Array.isArray(body.history)
      ? body.history.filter((w) => typeof w === "string")
      : [];
    if (history.length === 0) {
      return json({ error: true, message: "historyが必要です" }, 400);
    }

    const previousWord = history[history.length - 1];
    const result = validateWord(previousWord, nextWord, history, dict);
    if (!result.valid) {
      return json({
        error: true,
        errorCode: result.errorCode,
        message: result.message,
        gameOver: result.gameOver ?? false,
      }, 400);
    }

    const cpu = pickCpuWord(nextWord, [...history, nextWord], firstCharIndex);
    return json({
      valid: true,
      cpuWord: cpu.word,
      cpuGameOver: cpu.lose,
      reason: cpu.reason,
    });
  }

  // 単語が辞書に存在するか確認する
  if (pathname === "/api/validate" && req.method === "GET") {
    const word = new URL(req.url).searchParams.get("word") ?? "";
    return json({ word, exists: dict.has(word) });
  }

  return json({ error: true, message: "Not Found" }, 404);
}

// WebSocket接続を1人のプレイヤーとして扱う。
function handleWebSocket(req) {
  const { socket, response } = Deno.upgradeWebSocket(req);

  const player = {
    id: nextPlayerId++,
    name: "プレイヤー",
    send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
  };

  socket.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    const setName = () => {
      player.name = (data.name ?? "").trim() || "プレイヤー";
    };
    switch (data.type) {
      case "quick":  // ランダム対戦
        setName();
        rooms.quick(player);
        break;
      case "create": // 部屋を作る（合言葉は任意・部屋設定は部屋主が指定）
        setName();
        rooms.create(player, data.roomId, data.settings);
        break;
      case "join":   // 部屋に入る
        setName();
        rooms.join(player, data.roomId);
        break;
      case "word":
        rooms.word(player, (data.nextWord ?? "").trim());
        break;
    }
  };

  socket.onclose = () => rooms.leave(player);
  socket.onerror = () => rooms.leave(player);

  return response;
}

Deno.serve({ port: PORT }, (req) => {
  const { pathname } = new URL(req.url);

  // 対戦用WebSocket
  if (pathname === "/ws") {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("WebSocketで接続してください", { status: 426 });
    }
    return handleWebSocket(req);
  }

  if (pathname.startsWith("/api/")) {
    return handleApi(req, pathname);
  }

  // それ以外は public/ 以下を静的配信する
  return serveDir(req, { fsRoot: "public", quiet: true });
});

console.log(`しりとりサーバー起動: http://localhost:${PORT}`);
