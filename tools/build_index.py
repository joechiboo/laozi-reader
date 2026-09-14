# -*- coding: utf-8 -*-
"""掃 data/chapters/ 產 data/index.json：章目錄 + 關鍵詞反向索引。

用法：
  python tools/build_index.py

前端啟動只載這一支（幾 KB），拿到章目錄與整本的關鍵詞落點；
點某一章才去載該章的 NNN.json。所以這個檔是生成物，但必須進版控——
GitHub Pages 上沒有它，前端連第一畫面都畫不出來。

改過任何一章之後記得重跑；validate.py 先跑過再跑這支。
"""
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAPTERS = ROOT / "data" / "chapters"
OUT = ROOT / "data" / "index.json"


def main():
    files = sorted(CHAPTERS.glob("*.json"))
    if not files:
        print("找不到任何章資料")
        return 1

    chapters = []
    kw = defaultdict(list)   # term -> [{chapter, segments, sense?}]
    quiz_dir = ROOT / "data" / "quiz"

    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        entry = {
            "chapter": d["chapter"],
            "part": d["part"],
            "gist": d.get("gist", ""),
            "status": d["meta"]["status"],
            "segments": len(d["segments"]),
            "notes": len(d["notes"]),
        }
        # 有本章小考才標記；沒有的章前端就不畫小考區，免得去 fetch 一個不存在的檔
        if (quiz_dir / f"{d['chapter']:03d}.json").exists():
            entry["quiz"] = True
        chapters.append(entry)
        for k in d["keywords"]:
            entry = {"chapter": d["chapter"], "segments": k["refs"]}
            if k.get("sense"):
                entry["sense"] = k["sense"]
            kw[k["term"]].append(entry)

    chapters.sort(key=lambda c: c["chapter"])
    # 關鍵詞依出現章數排序（跨章愈多的愈值得追），同數再依筆畫無從判斷，就依詞序
    keywords = sorted(
        ({"term": t, "chapters": len(v), "refs": sorted(v, key=lambda e: e["chapter"])}
         for t, v in kw.items()),
        key=lambda k: (-k["chapters"], k["term"]),
    )

    OUT.write_text(
        json.dumps({
            "generated": date.today().isoformat(),
            "total": len(chapters),
            "chapters": chapters,
            "keywords": keywords,
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    withquiz = sum(1 for c in chapters if c.get("quiz"))
    print(f"data/index.json：{len(chapters)} 章、{len(keywords)} 個關鍵詞、{withquiz} 章有小考")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
