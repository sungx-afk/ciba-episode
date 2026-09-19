#!/usr/bin/env python3
"""Convert 糍粑英语_TOEFL词汇.xlsx -> words.json (app database).

Output: { "words": [ {id, cat, sub, word, meaning, note} ... ] }
Sub category "" means the word belongs directly to the top category.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SRC = "/Users/gpro/Documents/english-learn/deepseek/糍粑英语_TOEFL词汇.xlsx"
OUT = "/Users/gpro/Documents/english-learn/deepseek/CibaEnglish/CibaEnglish/Data/words.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
T = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def colnum(ref):
    s = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in s:
        n = n * 26 + (ord(ch) - 64)
    return n


def cellval(c):
    t = c.get("t")
    if t == "inlineStr":
        is_ = c.find("m:is", NS)
        if is_ is None:
            return ""
        return "".join(x.text or "" for x in is_.iter(T + "t"))
    v = c.find("m:v", NS)
    return v.text if v is not None else ""


def clean(s):
    return re.sub(r"[ \t]+", " ", (s or "")).strip()


def main():
    z = zipfile.ZipFile(SRC)
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = sheet.find("m:sheetData", NS)

    words = []
    wid = 0
    for row in rows.findall("m:row", NS):
        if row.get("r") == "1":
            continue  # header row
        cells = {}
        for c in row.findall("m:c", NS):
            cells[colnum(c.get("r"))] = cellval(c)
        w = clean(cells.get(3, ""))
        if not w:
            continue  # header or blank
        wid += 1
        words.append({
            "id": wid,
            "cat": clean(cells.get(1, "")),
            "sub": clean(cells.get(2, "")),
            "word": w,
            "meaning": clean(cells.get(4, "")),
            "note": clean(cells.get(5, "")),
        })

    # sanity checks
    errs = []
    for i, w in enumerate(words):
        if not w["cat"]:
            errs.append(f"row {i + 1}: missing cat for {w['word']}")
        if not w["word"]:
            errs.append(f"row {i + 1}: empty word")
    if errs:
        print("ERRORS:")
        print("\n".join(errs[:40]))
        sys.exit(1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"words": words}, f, ensure_ascii=False, separators=(",", ":"))

    # summary
    from collections import Counter, OrderedDict
    cats = OrderedDict()
    for w in words:
        cats.setdefault(w["cat"], OrderedDict())
        cats[w["cat"]][w["sub"]] = cats[w["cat"]].get(w["sub"], 0) + 1

    print(f"words: {len(words)}")
    print(f"categories: {len(cats)}")
    total_subs = sum(len(v) for v in cats.values())
    print(f"cat+sub groups: {total_subs}")
    for name, subs in cats.items():
        t = sum(subs.values())
        detail = " + ".join(f"{k or '(直属)'}:{v}" for k, v in list(subs.items())[:6])
        if len(subs) > 6:
            detail += f" ... ({len(subs)} groups)"
        print(f"  {name}: {t}  [{detail}]")


if __name__ == "__main__":
    main()
