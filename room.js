// room.js — マルチプレイヤーのルーム管理（2人1組・ターン制）
//
// プレイヤーは { id, name, send(message) } という抽象で扱う。
// send は1件のメッセージ(オブジェクト)を相手に届ける関数で、
// WebSocketでもテスト用のモックでも差し替えられるようにしている。
//
// マッチング方式は2種類:
//   - quick : 待っている人とランダムに当たる
//   - create/join : 合言葉(部屋ID)で友達と当たる

import { ShiritoriGame } from "./game.js";

// 紛らわしい文字(0,O,1,I,L)を除いた部屋ID用の文字。
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

// 部屋設定として選べる値。
const TIME_LIMITS = [0, 10, 20, 30, 60]; // 0 = 制限なし
const FIRST_TURNS = ["random", "host", "guest"];

// さっと対戦（ランダムマッチ）で使う固定設定。
export const QUICK_SETTINGS = { timeLimitSec: 30, dictCheck: true, firstTurn: "random" };

// クライアントから送られた部屋設定を検証し、不正な値はデフォルトに落とす。
export function sanitizeSettings(s = {}) {
  return {
    timeLimitSec: TIME_LIMITS.includes(s.timeLimitSec) ? s.timeLimitSec : 0,
    dictCheck: s.dictCheck !== false,
    firstTurn: FIRST_TURNS.includes(s.firstTurn) ? s.firstTurn : "random",
  };
}

// 1つの対戦ルーム。最大2人のプレイヤーと1局分のゲーム状態を持つ。
// settings は部屋主が決める: { timeLimitSec, dictCheck, firstTurn }
class Room {
  constructor(id, dict, words, settings) {
    this.id = id;
    this.dict = dict;
    this.words = words;
    this.settings = settings;
    this.players = [];
    this.game = null;
    this.turn = 0;
    this.started = false;
    this.finished = false;
    this.timer = null;
  }

  isFull() {
    return this.players.length >= 2;
  }

  // プレイヤーを追加する。2人揃ったらゲームを開始する。
  addPlayer(player) {
    this.players.push(player);
    if (this.players.length === 2) this.start();
  }

  start() {
    this.game = new ShiritoriGame(this.dict, this.words, undefined, {
      dictCheck: this.settings.dictCheck,
    });
    this.started = true;
    // 先手: host = 部屋を作った側(players[0]) / guest = 後から入った側 / random
    this.turn = this.settings.firstTurn === "host"
      ? 0
      : this.settings.firstTurn === "guest"
      ? 1
      : Math.floor(Math.random() * 2);
    const names = this.players.map((p) => p.name);
    this.players.forEach((p, i) => {
      p.send({
        type: "start",
        roomId: this.id,
        players: names,
        you: i,
        settings: this.settings,
        firstWord: this.game.previousWord,
        yourTurn: i === this.turn,
      });
    });
    this.startTurnTimer();
  }

  // 制限時間ありの部屋では、手番のたびにタイマーを張り直す。
  startTurnTimer() {
    this.clearTurnTimer();
    if (!this.settings.timeLimitSec) return;
    this.timer = setTimeout(() => this.timeout(), this.settings.timeLimitSec * 1000);
  }

  clearTurnTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // 時間切れ → 手番のプレイヤーの負け。
  timeout() {
    if (this.finished) return;
    this.finished = true;
    this.broadcast({
      type: "gameover",
      reason: "TIME_UP",
      loser: this.players[this.turn].name,
      word: null,
    });
  }

  // 単語の提出を処理する。
  submit(player, nextWord) {
    if (!this.started || this.finished) return;

    const idx = this.players.indexOf(player);
    if (idx !== this.turn) {
      player.send({ type: "error", errorCode: "NOT_YOUR_TURN", message: "あなたの番ではありません" });
      return;
    }

    const result = this.game.submit(nextWord);

    if (!result.valid) {
      if (result.gameOver) {
        // 「ん」で終わる・重複 → 提出した本人の負けでゲーム終了
        this.finished = true;
        this.clearTurnTimer();
        this.broadcast({
          type: "gameover",
          reason: result.errorCode,
          loser: player.name,
          word: nextWord,
        });
      } else {
        // 通常のエラーは本人にだけ返し、手番は移さない
        player.send({ type: "error", errorCode: result.errorCode, message: result.message });
      }
      return;
    }

    // 成功 → 手番を交代して両者に更新を通知
    this.turn = 1 - this.turn;
    this.players.forEach((p, i) => {
      p.send({
        type: "update",
        previousWord: this.game.previousWord,
        history: this.game.history,
        yourTurn: i === this.turn,
        lastPlayer: player.name,
      });
    });
    this.startTurnTimer();
  }

  broadcast(message) {
    for (const p of this.players) p.send(message);
  }
}

// マッチメイキングとルームの割り当てを管理する。
export class RoomManager {
  constructor(dict, words) {
    this.dict = dict;
    this.words = words;
    this.quickWaiting = null;   // ランダム対戦の待機者
    this.rooms = new Map();     // roomId -> Room
    this.roomOf = new Map();    // playerId -> Room
    this.seq = 0;
  }

  // 重複しない部屋IDを生成する。
  generateId() {
    let id;
    do {
      id = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
    } while (this.rooms.has(id));
    return id;
  }

  // ランダム対戦。待機者がいればマッチング、いなければ待機させる。
  quick(player) {
    if (this.quickWaiting === null) {
      this.quickWaiting = player;
      player.send({ type: "waiting", message: "対戦相手を待っています..." });
      return;
    }
    if (this.quickWaiting.id === player.id) return;

    const opponent = this.quickWaiting;
    this.quickWaiting = null;

    const room = new Room(`q-${++this.seq}`, this.dict, this.words, { ...QUICK_SETTINGS });
    this.rooms.set(room.id, room);
    this.assign(room, opponent);
    this.assign(room, player);
  }

  // 合言葉を正規化する（前後空白を除き大文字化）。
  normalizeId(roomId) {
    return (roomId ?? "").trim().toUpperCase();
  }

  // 合言葉として使えるか検証する。問題があればエラー情報を返す。
  validateId(id) {
    if (id.length > 12) return { code: "INVALID_CODE", message: "合言葉は12文字までです" };
    if (/\s/.test(id)) return { code: "INVALID_CODE", message: "合言葉に空白は使えません" };
    return null;
  }

  // 部屋を作る。合言葉と部屋設定を指定できる（合言葉が空ならランダム生成）。
  // 作成者に部屋IDを返して待機させる。
  create(player, roomId, settings) {
    const requested = this.normalizeId(roomId);
    let id;
    if (requested) {
      const err = this.validateId(requested);
      if (err) {
        player.send({ type: "error", errorCode: err.code, message: err.message });
        return;
      }
      if (this.rooms.has(requested)) {
        player.send({ type: "error", errorCode: "ROOM_TAKEN", message: "その合言葉は使用中です。別の言葉にしてください" });
        return;
      }
      id = requested;
    } else {
      id = this.generateId();
    }

    const room = new Room(id, this.dict, this.words, sanitizeSettings(settings));
    this.rooms.set(id, room);
    this.assign(room, player);
    player.send({ type: "created", roomId: id });
    player.send({ type: "waiting", message: "対戦相手を待っています..." });
  }

  // 部屋IDを指定して参加する。
  join(player, roomId) {
    const room = this.rooms.get(this.normalizeId(roomId));
    if (!room || room.id.startsWith("q-")) {
      player.send({ type: "error", errorCode: "ROOM_NOT_FOUND", message: "その部屋は見つかりません" });
      return;
    }
    if (room.isFull() || room.started) {
      player.send({ type: "error", errorCode: "ROOM_FULL", message: "その部屋は満員です" });
      return;
    }
    this.assign(room, player);
  }

  // プレイヤーをルームに登録する。
  assign(room, player) {
    this.roomOf.set(player.id, room);
    room.addPlayer(player);
  }

  // 単語提出をルームへ渡す。
  word(player, nextWord) {
    const room = this.roomOf.get(player.id);
    if (!room) {
      player.send({ type: "error", errorCode: "NO_ROOM", message: "ゲームが開始されていません" });
      return;
    }
    room.submit(player, nextWord);
  }

  // 切断・退出を処理する。待機中なら取り消し、対戦中なら相手に通知する。
  leave(player) {
    if (this.quickWaiting && this.quickWaiting.id === player.id) {
      this.quickWaiting = null;
      return;
    }
    const room = this.roomOf.get(player.id);
    if (!room) return;

    room.clearTurnTimer();
    for (const p of room.players) this.roomOf.delete(p.id);
    this.rooms.delete(room.id);

    const opponent = room.players.find((p) => p.id !== player.id);
    if (opponent) opponent.send({ type: "opponent_left", message: "相手が切断しました" });
  }
}
