// game.js — しりとりゲームロジック（一人用・対戦で共通）

// 拗音・促音の小文字は、しりとりでは大文字として扱う。
// 例: 「きゃ」の末尾「ゃ」は「や」とみなす。
const SMALL_TO_LARGE = {
  "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
  "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "っ": "つ",
};

// エラーコードとメッセージの対応。
export const MESSAGES = {
  NOT_HIRAGANA: "ひらがなで入力してください",
  TOO_SHORT: "2文字以上で入力してください",
  NOT_IN_DICT: "辞書に存在しない単語です",
  NOT_CONNECTED: "前の単語に続いていません",
  DUPLICATE: "すでに使われた単語です",
  ENDS_WITH_N: "「ん」で終わりました",
};

// しりとりの繋がりを判定するための末尾文字を返す。小文字は大文字へ正規化する。
export function tailChar(word) {
  const last = word.slice(-1);
  return SMALL_TO_LARGE[last] ?? last;
}

// 全ての文字がひらがな(0x3041-0x3096)かどうか。長音「ー」やカタカナはfalse。
export function isHiragana(word) {
  if (word.length === 0) return false;
  for (const ch of word) {
    const code = ch.codePointAt(0);
    if (code < 0x3041 || code > 0x3096) return false;
  }
  return true;
}

// 単語を検証する。
// previousWord: 直前の単語 / nextWord: 入力された単語 / history: 使用済み単語の配列 / dict: 単語のSet
// 戻り値: { valid: true } または { valid: false, errorCode, message, gameOver }
export function validateWord(previousWord, nextWord, history, dict) {
  // 1. ひらがなのみか
  if (!isHiragana(nextWord)) return fail("NOT_HIRAGANA");
  // 2. 2文字以上か
  if (nextWord.length < 2) return fail("TOO_SHORT");
  // 3. 辞書に存在するか
  if (!dict.has(nextWord)) return fail("NOT_IN_DICT");
  // 4. 前の単語の末尾と先頭が繋がるか
  if (nextWord[0] !== tailChar(previousWord)) return fail("NOT_CONNECTED");
  // 5. 過去に使われていないか → 使われていたらゲーム終了
  if (history.includes(nextWord)) return fail("DUPLICATE", true);
  // 6. 「ん」で終わっていないか → 終わっていたらゲーム終了
  if (tailChar(nextWord) === "ん") return fail("ENDS_WITH_N", true);

  return { valid: true };
}

function fail(errorCode, gameOver = false) {
  return { valid: false, errorCode, message: MESSAGES[errorCode], gameOver };
}

// 辞書から「ん」で終わらない単語をランダムに選ぶ（初期単語用）。
export function pickInitialWord(words) {
  const candidates = words.filter((w) => tailChar(w) !== "ん");
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ゲーム1局分の状態を持つ。一人用・対戦の両方で使う。
export class ShiritoriGame {
  constructor(dict, words, firstWord) {
    this.dict = dict;           // 検索用Set
    this.words = words;         // 初期単語選択用の配列
    this.history = [firstWord ?? pickInitialWord(words)];
    this.finished = false;
  }

  get previousWord() {
    return this.history[this.history.length - 1];
  }

  // 単語を提出する。検証に成功すれば履歴に追加する。
  submit(nextWord) {
    if (this.finished) {
      return { valid: false, errorCode: "FINISHED", message: "ゲームは終了しています", gameOver: true };
    }
    const result = validateWord(this.previousWord, nextWord, this.history, this.dict);
    if (result.valid) {
      this.history.push(nextWord);
    } else if (result.gameOver) {
      this.finished = true;
    }
    return result;
  }
}
