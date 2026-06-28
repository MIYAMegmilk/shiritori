// room.js — マルチプレイヤーのルーム管理（2人1組・ターン制）
//
// プレイヤーは { id, name, send(message) } という抽象で扱う。
// send は1件のメッセージ(オブジェクト)を相手に届ける関数で、
// WebSocketでもテスト用のモックでも差し替えられるようにしている。

import { ShiritoriGame } from "./game.js";

// 1つの対戦ルーム。2人のプレイヤーと1局分のゲーム状態を持つ。
class Room {
  constructor(id, players, dict, words) {
    this.id = id;
    this.players = players; // [player0, player1]
    this.game = new ShiritoriGame(dict, words);
    this.turn = 0;          // 手番のプレイヤーのindex
    this.finished = false;
  }

  // ゲーム開始を両者に通知する。
  start() {
    const names = this.players.map((p) => p.name);
    this.players.forEach((p, i) => {
      p.send({
        type: "start",
        roomId: this.id,
        players: names,
        firstWord: this.game.previousWord,
        yourTurn: i === this.turn,
      });
    });
  }

  // 単語の提出を処理する。
  submit(player, nextWord) {
    if (this.finished) return;

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
    this.waiting = null;        // 対戦相手を待っているプレイヤー
    this.roomOf = new Map();    // playerId -> Room
    this.seq = 0;
  }

  // プレイヤーが参加する。待機者がいればマッチング、いなければ待機させる。
  join(player) {
    if (this.waiting === null) {
      this.waiting = player;
      player.send({ type: "waiting", message: "対戦相手を待っています..." });
      return;
    }
    if (this.waiting.id === player.id) return; // 二重join防止

    const opponent = this.waiting;
    this.waiting = null;

    const room = new Room(`room-${++this.seq}`, [opponent, player], this.dict, this.words);
    this.roomOf.set(opponent.id, room);
    this.roomOf.set(player.id, room);
    room.start();
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
    if (this.waiting && this.waiting.id === player.id) {
      this.waiting = null;
      return;
    }
    const room = this.roomOf.get(player.id);
    if (!room) return;

    for (const p of room.players) this.roomOf.delete(p.id);
    const opponent = room.players.find((p) => p.id !== player.id);
    if (opponent) opponent.send({ type: "opponent_left", message: "相手が切断しました" });
  }
}
