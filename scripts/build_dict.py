#!/usr/bin/env python3
"""IPAdic の一般名詞からひらがなの読みを抽出して dict/words.txt を生成する。

IPAdic（MeCab辞書）の名詞CSVはEUC-JPで、12列目（index 11）に
カタカナの読みが入っている。これをひらがなへ変換し、
しりとりで使える単語リストとして書き出す。

使い方:
    python scripts/build_dict.py
"""

import sys
import urllib.request
from pathlib import Path

# IPAdic の名詞CSV（https://github.com/taku910/mecab）。EUC-JPエンコード。
BASE_URL = "https://raw.githubusercontent.com/taku910/mecab/master/mecab-ipadic"
CSV_FILES = [
    "Noun.csv",
    "Noun.adjv.csv",
    "Noun.adverbal.csv",
    "Noun.verbal.csv",
]

READING_COL = 11  # 12列目: 読み（カタカナ）
MIN_LEN = 2
MAX_LEN = 15

OUT_PATH = Path(__file__).resolve().parent.parent / "dict" / "words.txt"


def katakana_to_hiragana(text):
    """カタカナをひらがなに変換する。

    カタカナ(0x30A1-0x30F6)はコードポイント -0x60 でひらがな(0x3041-0x3096)になる。
    長音「ー」など変換対象外の文字はそのまま残し、後段のフィルタで除外する。
    """
    out = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def is_all_hiragana(text):
    """全ての文字がひらがな(0x3041-0x3096)かどうか。長音「ー」が残っていればFalse。"""
    return all(0x3041 <= ord(ch) <= 0x3096 for ch in text)


def fetch_csv(name):
    url = f"{BASE_URL}/{name}"
    print(f"ダウンロード: {url}", file=sys.stderr)
    with urllib.request.urlopen(url) as resp:
        return resp.read().decode("euc_jp", errors="replace")


def main():
    words = set()
    for name in CSV_FILES:
        for line in fetch_csv(name).splitlines():
            cols = line.split(",")
            if len(cols) <= READING_COL:
                continue
            reading = cols[READING_COL].strip()
            if not reading or reading == "*":
                continue

            word = katakana_to_hiragana(reading)
            if not is_all_hiragana(word):
                continue
            if not (MIN_LEN <= len(word) <= MAX_LEN):
                continue

            words.add(word)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")
    print(f"{len(words)} 語を {OUT_PATH} に出力しました。", file=sys.stderr)


if __name__ == "__main__":
    main()
