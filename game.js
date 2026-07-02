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

// しりとりの繋がりを判定するための末尾文字を返す。
// 末尾の長音「ー」は直前の文字で継ぐ（例: コーヒー→「ひ」、スキー→「き」）。
// 小文字（拗音・促音）は大文字へ正規化する。
export function tailChar(word) {
  let w = word;
  while (w.length > 1 && w.slice(-1) === "ー") w = w.slice(0, -1);
  const last = w.slice(-1);
  return SMALL_TO_LARGE[last] ?? last;
}

// しりとりで使える文字だけか判定する。ひらがな(0x3041-0x3096)と長音「ー」を許可。
// カタカナ・漢字・記号などはfalse。先頭が「ー」の語も無効。
export function isHiragana(word) {
  if (word.length === 0 || word[0] === "ー") return false;
  for (const ch of word) {
    const code = ch.codePointAt(0);
    const ok = (code >= 0x3041 && code <= 0x3096) || ch === "ー";
    if (!ok) return false;
  }
  return true;
}

// 単語を検証する。
// previousWord: 直前の単語 / nextWord: 入力された単語 / history: 使用済み単語の配列 / dict: 単語のSet
// opts.dictCheck: false にすると辞書チェックを行わない（部屋設定「辞書判定なし」用）
// 戻り値: { valid: true } または { valid: false, errorCode, message, gameOver }
export function validateWord(previousWord, nextWord, history, dict, opts = {}) {
  const { dictCheck = true } = opts;
  // 1. ひらがなのみか
  if (!isHiragana(nextWord)) return fail("NOT_HIRAGANA");
  // 2. 2文字以上か
  if (nextWord.length < 2) return fail("TOO_SHORT");
  // 3. 辞書に存在するか
  if (dictCheck && !dict.has(nextWord)) return fail("NOT_IN_DICT");
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

// 先頭文字 → 単語リスト の索引を作る（CPUが次の手を高速に探すため）。
export function buildFirstCharIndex(words) {
  const index = new Map();
  for (const w of words) {
    const list = index.get(w[0]);
    if (list) list.push(w);
    else index.set(w[0], [w]);
  }
  return index;
}

// CPUの次の一手を選ぶ。
// 「ん」で終わらない単語を優先し、それしか無ければ「ん」で終わる単語を出して負ける。
// 候補が全く無ければ降参(NO_WORD)。
// 戻り値: { word, lose, reason }
export function pickCpuWord(previousWord, history, index) {
  const candidates = index.get(tailChar(previousWord)) ?? [];
  const used = new Set(history);
  const safe = [];
  const losing = [];
  for (const w of candidates) {
    if (used.has(w)) continue;
    (tailChar(w) === "ん" ? losing : safe).push(w);
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  if (safe.length > 0) return { word: pick(safe), lose: false, reason: null };
  if (losing.length > 0) return { word: pick(losing), lose: true, reason: "ENDS_WITH_N" };
  return { word: null, lose: true, reason: "NO_WORD" };
}

// ゲーム1局分の状態を持つ。CPU対戦・オンライン対戦の両方で使う。
export class ShiritoriGame {
  constructor(dict, words, firstWord, opts = {}) {
    this.dict = dict;           // 検索用Set
    this.words = words;         // 初期単語選択用の配列
    this.opts = opts;           // 検証オプション（dictCheckなど）
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
    const result = validateWord(this.previousWord, nextWord, this.history, this.dict, this.opts);
    if (result.valid) {
      this.history.push(nextWord);
    } else if (result.gameOver) {
      this.finished = true;
    }
    return result;
  }
}
