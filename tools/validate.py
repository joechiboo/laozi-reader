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
  7. 跨章：notes.see 的錨點若指向已建立的章，那一句必須存在
     （指向還沒建的章只列出來提醒，不算錯）
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAPTERS = ROOT / "data" / "chapters"


def check(path, d=None):
    """回傳該章的錯誤訊息清單（空 list = 通過）。"""
    errs = []
    if d is None:
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


def check_see(d, all_segs, seg_text, built, pending, warns):
    """跨章互見錨點。分三級：

    錯誤   see 指向已建立的章，卻沒有那一句（錨點根本落空）
    提醒   see 指向還沒建立的章（那章建好後才驗得了）
    疑慮   註文引的句子與錨點不同句——可能是錨點寫錯（6.2 與 6.3 都存在時，
           上面那條抓不到），但也可能是刻意引別句來對照，所以只提醒不擋。
    """
    errs = []
    for n in d["notes"]:
        refs = n.get("see", [])
        for ref in refs:
            ch = int(ref.split(".")[0])
            if ch not in built:
                pending.append(f"第 {d['chapter']} 章 {n['id']} → {ref}（第 {ch} 章尚未建立）")
            elif ref not in all_segs:
                errs.append(f"{n['id']} 的 see {ref} 指不到——第 {ch} 章已建立，但沒有這一句")

        # 互見註幾乎都會把對方的句子用「」引出來，拿引文回頭核對落點。
        for quote in re.findall(r"「([^」]{4,})」", n.get("text", "")):
            hits = [sid for sid, text in seg_text.items()
                    if quote in text and sid.split(".")[0] != str(d["chapter"])]
            if len(hits) != 1:
                continue          # 引文跨句或不只一處，判不準就不判
            hit = hits[0]
            same_ch = [r for r in refs if r.split(".")[0] == hit.split(".")[0]]
            if same_ch and hit not in same_ch:
                warns.append(f"第 {d['chapter']} 章 {n['id']} 引了「{quote}」（在 {hit}），"
                             f"但 see 指的是 {'、'.join(same_ch)}")
    return errs


def check_quiz(all_segs):
    """小測驗：每題的 ref 必須指得到全書某一句，答案必須是布林，id 不重複。

    測驗題與章資料是分開的兩個檔，最容易發生的錯就是改了斷句之後，
    題目的 ref 變成孤兒——所以這裡一起驗。
    """
    path = ROOT / "data" / "quiz.json"
    if not path.exists():
        return []
    errs = []
    q = json.loads(path.read_text(encoding="utf-8"))
    ids = [x["id"] for x in q["questions"]]
    if len(set(ids)) != len(ids):
        errs.append("題目 id 有重複")
    for x in q["questions"]:
        if not isinstance(x.get("answer"), bool):
            errs.append(f"{x['id']} 的 answer 不是 true/false")
        for field in ("statement", "explain", "ref"):
            if not x.get(field):
                errs.append(f"{x['id']} 缺少 {field}")
        if x.get("ref") and x["ref"] not in all_segs:
            errs.append(f"{x['id']} 的 ref {x['ref']} 指不到全書任何一句")
    return errs


def check_chapter_quiz(all_segs):
    """本章小考：每章至少五題（多的供隨機抽），ref 必須指到「本章」的句。"""
    qdir = ROOT / "data" / "quiz"
    if not qdir.exists():
        return []
    errs = []
    for f in sorted(qdir.glob("*.json")):
        q = json.loads(f.read_text(encoding="utf-8"))
        ch = q.get("chapter")
        if f.stem != f"{ch:03d}":
            errs.append(f"{f.name}：檔名與 chapter 不符")
        if len(q["questions"]) < 5:
            errs.append(f"{f.name}：至少要 5 題，實為 {len(q['questions'])} 題")
        ids = [x["id"] for x in q["questions"]]
        if len(set(ids)) != len(ids):
            errs.append(f"{f.name}：題目 id 有重複")
        for x in q["questions"]:
            if not isinstance(x.get("answer"), bool):
                errs.append(f"{f.name} {x['id']}：answer 不是 true/false")
            for field in ("statement", "explain", "ref"):
                if not x.get(field):
                    errs.append(f"{f.name} {x['id']}：缺少 {field}")
            ref = x.get("ref", "")
            if ref and ref not in all_segs:
                errs.append(f"{f.name} {x['id']}：ref {ref} 指不到任何一句")
            elif ref and ref.split(".")[0] != str(ch):
                errs.append(f"{f.name} {x['id']}：ref {ref} 不在本章")
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

    # 全書的句 id 與已建立的章，供跨章 see 錨點檢查用
    # （不論這次只驗哪幾章，這裡一律全掃）
    all_segs, seg_text, built = set(), {}, set()
    for f in sorted(CHAPTERS.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        built.add(d["chapter"])
        all_segs.update(s["id"] for s in d["segments"])
        seg_text.update({s["id"]: s["text"] for s in d["segments"]})

    bad = 0
    pending, warns = [], []
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        errs = check(f, data) + check_see(data, all_segs, seg_text, built, pending, warns)
        if schema_check:
            errs = schema_check(data) + errs
        if errs:
            bad += 1
            print(f"[FAIL] {f.name}")
            for e in errs:
                print(f"  - {e}")
        else:
            print(f"[ OK ] {f.name}")
    print(f"\n{len(files)} 章，{bad} 章有問題")

    quiz_errs = check_quiz(all_segs) + check_chapter_quiz(all_segs)
    if quiz_errs:
        bad += 1
        print("\n[FAIL] 題庫")
        for e in quiz_errs:
            print(f"  - {e}")
    else:
        print("[ OK ] 題庫（綜合測驗＋本章小考）")
    if pending:
        print("\n互見錨點指向尚未建立的章（不算錯，那幾章建好後會自動開始檢查）：")
        for line in pending:
            print(f"  - {line}")
    if warns:
        print("\n註文引的句子與錨點不同句，確認一下是刻意的還是錨點寫錯：")
        for line in warns:
            print(f"  - {line}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
