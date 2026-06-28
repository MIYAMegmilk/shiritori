import { serveDir } from "@std/http/file-server";
import { ShiritoriGame } from "./game.js";
import { RoomManager } from "./room.js";

const PORT = Number(Deno.env.get("PORT") ?? 8000);

// 起動時に辞書を読み込む。ローカルはCRLF・Deno DeployはLFなので両対応で分割する。
const dictText = await Deno.readTextFile(new URL("./dict/words.txt", import.meta.url));
const words = dictText.split(/\r?\n/).filter(Boolean);
const dict = new Set(words);
console.log(`辞書を読み込みました: ${words.length} 語`);

// 一人用のゲーム状態（サーバー上に1つだけ持つシンプルな構成）。
let game = new ShiritoriGame(dict, words);

// 対戦用のルーム管理。
const rooms = new RoomManager(dict, words);
let nextPlayerId = 1;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleApi(req, pathname) {
  // 現在の単語と履歴を返す
  if (pathname === "/api/word" && req.method === "GET") {
    return json({ previousWord: game.previousWord, history: game.history });
  }

  // 単語を提出して検証する
  if (pathname === "/api/word" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const nextWord = (body.nextWord ?? "").trim();
    const result = game.submit(nextWord);
    if (result.valid) {
      return json({ previousWord: game.previousWord, history: game.history, valid: true });
    }
    return json({
      error: true,
      errorCode: result.errorCode,
      message: result.message,
      gameOver: result.gameOver ?? false,
      history: game.history,
    }, 400);
  }

  // ゲームをリセットする
  if (pathname === "/api/reset" && req.method === "POST") {
    game = new ShiritoriGame(dict, words);
    return json({ previousWord: game.previousWord, history: game.history });
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
    if (data.type === "join") {
      player.name = (data.name ?? "").trim() || "プレイヤー";
      rooms.join(player);
    } else if (data.type === "word") {
      rooms.word(player, (data.nextWord ?? "").trim());
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
