# -*- coding: utf-8 -*-
"""章資料檢查：照 data/schema.json 驗每一章，並補做 schema 表達不了的跨欄位一致性檢查。

用法：
  python tools/validate.py                 # 檢查 data/chapters/ 全部
  python tools/validate.py data/chapters/001.json

檢查項目：
  1. JSON Schema（需 pip install jsonschema；沒裝則跳過，只跑第 2 項並提醒）
  2. text 與 segments 串接是否一致（標點、漏字最常在這裡抓到）
  3. segment id 是否為「章.序」且連號、章號與檔名相符
  4. notes.ref / keywords.refs 是否都指得到存在的 segment
  5. keywords.refs 指的那一句，原文裡是否真的有這個詞
  6. status=reviewed 的章不得留 meta.todo
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAPTERS = ROOT / "data" / "chapters"


def check(path):
    """回傳該章的錯誤訊息清單（空 list = 通過）。"""
    errs = []
    d = json.loads(path.read_text(encoding="utf-8"))
    ch = d.get("chapter")

    if path.stem != f"{ch:03d}":
        errs.append(f"檔名與 chapter 不符：{path.name} vs chapter={ch}")

    seg_ids = [s["id"] for s in d["segments"]]
    joined = "".join(s["text"] for s in d["segments"])
    if joined != d["text"]:
        errs.append(f"text 與 segments 串接不一致：\n    text     = {d['text']}\n    segments = {joined}")

    for i, sid in enumerate(seg_ids, 1):
        if sid != f"{ch}.{i}":
            errs.append(f"segment id 應為 {ch}.{i}，實為 {sid}")
    if len(set(seg_ids)) != len(seg_ids):
        errs.append("segment id 有重複")

    known = set(seg_ids)
    note_ids = [n["id"] for n in d["notes"]]
    if len(set(note_ids)) != len(note_ids):
        errs.append("note id 有重複")
    for n in d["notes"]:
        if n["ref"] != "*" and n["ref"] not in known:
            errs.append(f"{n['id']} 的 ref {n['ref']} 指不到本章任何一句")
        if n["type"] == "互見" and not n.get("see"):
            errs.append(f"{n['id']} type=互見 但沒填 see")

    seg_text = {s["id"]: s["text"] for s in d["segments"]}
    for kw in d["keywords"]:
        for ref in kw["refs"]:
            if ref not in known:
                errs.append(f"關鍵詞「{kw['term']}」的 refs {ref} 指不到本章任何一句")
            elif kw["term"] not in seg_text[ref]:
                errs.append(f"關鍵詞「{kw['term']}」標在 {ref}，但該句原文裡沒有這個字：{seg_text[ref]}")

    if d["meta"]["status"] == "reviewed" and d["meta"].get("todo"):
        errs.append("status=reviewed 卻還留著 meta.todo")
    return errs


def main():
    schema_check = None
    try:
        import jsonschema
        schema = json.loads((ROOT / "data" / "schema.json").read_text(encoding="utf-8"))
        validator = jsonschema.Draft7Validator(schema)
        schema_check = lambda d: [f"schema: {'/'.join(str(p) for p in e.path)}: {e.message}"
                                  for e in validator.iter_errors(d)]
    except ImportError:
        print("（未安裝 jsonschema，略過 schema 驗證：pip install jsonschema）\n")

    args = sys.argv[1:]
    files = [Path(a) for a in args] if args else sorted(CHAPTERS.glob("*.json"))
    if not files:
        print("找不到任何章資料"); return 1

    bad = 0
    for f in files:
        errs = check(f)
        if schema_check:
            errs = schema_check(json.loads(f.read_text(encoding="utf-8"))) + errs
        if errs:
            bad += 1
            print(f"[FAIL] {f.name}")
            for e in errs:
                print(f"  - {e}")
        else:
            print(f"[ OK ] {f.name}")
    print(f"\n{len(files)} 章，{bad} 章有問題")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
