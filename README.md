# laozi-reader 道德經原文與解析

一份可查可讀的《道德經》文本工具。重點只有兩件事：**原文與解析並列**、**關鍵詞跨章跳轉**。

不做漫畫、不生圖、不配樂——純文本。

## 現況

MVP 先做五章：**1、8、42、60、81**（第一章的道體與方法、第八章上善若水、第四十二章生成論、第六十章治大國若烹小鮮、第八十一章總結）。
跑完這五章評估單章實際工時，再決定是否走完 81 章。

| 項目 | 狀態 |
| --- | --- |
| JSON schema | ✅ 定稿（`data/schema.json`） |
| 第 1 章資料 | 🟡 起草完成，白話待口述校稿（`meta.status = draft`） |
| 章資料檢查器 | ✅ `tools/validate.py` |
| 索引生成 | ✅ `tools/build_index.py` |
| 呈現層 | ✅ `index.html`（線上：https://joechiboo.github.io/laozi-reader/） |

## 底本與版權界線

- **原文**：王弼本，公版。
- **白話與註解**：全部自撰。**不得抄錄任何現行譯註本的文字**（陳鼓應、傅佩榮、南懷瑾等一律不引、不改寫）。
- **可引且須註明出處**：王弼注、河上公注、《說文》等古注（公版），以及帛書本、郭店簡本等出土文本的異文。註解裡用 `source` 欄位標明。
- 判準很簡單：**古人的話可以引，今人的話一個字都不用。**

## 目錄結構

```text
data/
  schema.json           單章資料的 JSON Schema（draft-07），欄位定義的唯一真相
  chapters/001.json     一章一檔，檔名三位數補零
  keywords.md           受控詞表：同一概念只准一種寫法（待建）
  index.json            生成物：章目錄 + 關鍵詞反向索引，供前端一次載入（須進版控）
tools/
  validate.py           照 schema 驗章，另查 schema 管不到的跨欄位一致性
  build_index.py        掃 data/chapters/ 產 data/index.json
assets/                 style.css / reader.js
index.html              單頁閱讀器
```

## 資料格式

完整定義看 `data/schema.json`，範例看 `data/chapters/001.json`。重點欄位：

| 欄位 | 說明 |
| --- | --- |
| `chapter` / `part` | 章次；道經 1–37、德經 38–81 |
| `gist` | 一句話章旨，給左側索引當摘要 |
| `text` | 全章原文（王弼本＋現代標點） |
| `segments[]` | 斷句。`{id, text, plain, alt?}`——**原文與白話的對位單位**，並列呈現時左右靠 `id` 對齊 |
| `plain` | 全章白話通讀（補上語氣轉折，可獨立讀完，不是 segments 的機械串接） |
| `notes[]` | 註解。`type` 分 訓詁／異文／異讀／義理／互見；訓詁與異文要填 `source` |
| `keywords[]` | `{term, refs, sense?}`——`refs` 是該詞在本章出現的句 id，也就是跨章跳轉的落點 |
| `meta.status` | `draft`（起草／補註完、未校）→ `reviewed`（口述改寫並校過，可上站） |

兩個設計決定值得記一下：

1. **句 id（`1.3`）是永久錨點。** 跨章互見、關鍵詞跳轉、網址 hash 全靠它，一經發布不可重編號；要拆句就新增尾號，不要重排。
2. **關鍵詞掛在句上、不是掛在章上。** 否則「道」會指到 60 幾章的章首，跳過去還得自己找——掛句才能一鍵到位。

## 單章工作流程

```text
① 口述理解   使用者講對這章的白話理解（segments 逐句 + 全章通讀）
② 補訓詁異文 Claude 補 notes：字義、他本異文、斷句歧異、互見章節，標 source
③ 檢查       python tools/validate.py data/chapters/0NN.json
④ 校稿       使用者改白話措辭 → meta.status 改 reviewed、清空 meta.todo
```

第 1 章是反過來跑的（Claude 先起草白話，供口述時改寫覆蓋），所以 `meta.status` 仍是 `draft`。

## 開發

```bash
pip install -r requirements.txt   # 只有 jsonschema，沒裝也能跑，只是跳過 schema 驗證

python tools/validate.py                          # 驗全部章
python tools/validate.py data/chapters/001.json   # 驗單章
python tools/build_index.py                       # 改過任何一章後重產 data/index.json
python -m http.server 8000                        # 本機預覽 http://localhost:8000/
```

改資料的順序固定是 **validate → build_index → 預覽**。`data/index.json` 是生成物但必須進版控——GitHub Pages 上沒有它，前端連第一畫面都畫不出來。

`validate.py` 除了 schema 之外，另外查這些 schema 表達不了的事：`text` 與 `segments` 串接是否一致、句 id 是否連號、`notes.ref` 與 `keywords.refs` 是否都指得到句、**關鍵詞標的那一句原文裡是否真的有這個詞**（最後這條在第 1 章就抓到一個誤標）。

## 技術棧

沿用既有 side project 慣例：**純靜態、零框架、零 build**——HTML + CSS + vanilla JS，資料 fetch JSON，Python 腳本只做生成與檢查，部署 GitHub Pages。

呈現層：單頁 `index.html` + hash 路由（`#/1` 跳章、`#/1.3` 直接跳句），左側章次索引與關鍵詞，右側原文與白話等寬並列、註解掛在該句底下；啟動只載 `data/index.json`（幾 KB），點到哪一章才載該章 JSON。點關鍵詞會列出它在全書的落點並跳到第一處，原文中該字標色。

部署照 bard-comics 那套：GitHub Pages 直接發 `main` 分支根目錄，不走 Actions、不用 build。
