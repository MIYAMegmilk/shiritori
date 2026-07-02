#!/usr/bin/env python3
"""mecab-ipadic-NEologd の種データから新語・カタカナ語を抽出して
dict/words_extra.txt を生成する。

words_extra.txt は「プレイヤー入力の受理判定」専用の追加辞書。
NEologdには俗語や際どい固有名詞も含まれるため、CPUの返答には使わない
（CPUの語彙は words.txt のみ）。

収録を絞るため、表層形がカナ（カタカナ・ひらがな・長音）または
英数字だけの語（=カタカナ語・新語・アルファベット略語の読み）に限定する。
例: スマホ→すまほ、YouTube→ゆーちゅーぶ、アプリ→あぷり

使い方:
    python scripts/build_extra_dict.py   # words.txt を先に生成しておくこと
"""

import csv
import io
import lzma
import sys
import urllib.request
from pathlib import Path

SEED_URL = (
    "https://github.com/neologd/mecab-ipadic-neologd/raw/master/seed/"
    "mecab-user-dict-seed.20200910.csv.xz"
)

READING_COL = 11  # 12列目: 読み（カタカナ）
MIN_LEN = 2
MAX_LEN = 15

DICT_DIR = Path(__file__).resolve().parent.parent / "dict"
BASE_PATH = DICT_DIR / "words.txt"
OUT_PATH = DICT_DIR / "words_extra.txt"


def katakana_to_hiragana(text):
    out = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def is_valid_word(text):
    """しりとりで使える語か。ひらがな(0x3041-0x3096)と長音「ー」のみ・先頭「ー」不可。"""
    if not text or text[0] == "ー":
        return False
    return all(0x3041 <= ord(ch) <= 0x3096 or ch == "ー" for ch in text)


def is_kana_or_ascii_surface(surface):
    """表層形がカナ・英数字だけか（漢字を含む固有名詞などを除外するフィルタ）。"""
    if not surface:
        return False
    for ch in surface:
        code = ord(ch)
        kana = 0x3041 <= code <= 0x3096 or 0x30A1 <= code <= 0x30F6 or ch == "ー" or ch == "・"
        ascii_ok = 0x21 <= code <= 0x7E  # 英数字・記号
        if not (kana or ascii_ok):
            return False
    return True


def main():
    base_words = set(BASE_PATH.read_text(encoding="utf-8").split())

    print(f"ダウンロード: {SEED_URL}", file=sys.stderr)
    with urllib.request.urlopen(SEED_URL) as resp:
        raw = resp.read()
    print(f"ダウンロード完了: {len(raw) / 1024 / 1024:.1f} MB", file=sys.stderr)

    text = lzma.decompress(raw).decode("utf-8", errors="replace")
    csv.field_size_limit(1 << 20)

    words = set()
    total = 0
    for cols in csv.reader(io.StringIO(text)):
        total += 1
        if len(cols) <= READING_COL or cols[4] != "名詞":
            continue
        if not is_kana_or_ascii_surface(cols[0]):
            continue
        reading = cols[READING_COL].strip()
        if not reading or reading == "*":
            continue
        word = katakana_to_hiragana(reading)
        if not is_valid_word(word):
            continue
        if not (MIN_LEN <= len(word) <= MAX_LEN):
            continue
        if word in base_words:
            continue
        words.add(word)

    OUT_PATH.write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")
    print(f"{total} 行から {len(words)} 語を {OUT_PATH} に出力しました。", file=sys.stderr)


if __name__ == "__main__":
    main()
