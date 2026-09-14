/* 道德經閱讀器
   路由：#/1 跳章、#/1.3 跳到某一句（句 id 就是錨點，見 README）
   啟動只載 data/index.json，點到哪一章才載該章 JSON（載過就留在 cache）。 */
(function () {
  'use strict'

  var TOTAL = 81
  var index = null
  var cache = {}
  var activeTerm = null

  var $main = document.getElementById('main')
  var $list = document.getElementById('chapter-list')
  var $cloud = document.getElementById('keyword-cloud')
  var $progress = document.getElementById('progress')
  var $mode = document.getElementById('mode-toggle')

  // 精簡模式：只留原文與全章通讀（白話、註解、todo 由 CSS 收起）
  // 切換鈕在 masthead、不在 main 裡，所以換章重畫不會影響它。
  var LEAN_KEY = 'laozi-reader:lean'

  function setLean(on) {
    document.body.classList.toggle('lean', on)
    $mode.setAttribute('aria-pressed', on ? 'true' : 'false')
    $mode.textContent = on ? '顯示白話與註解' : '只看原文與通讀'
    try { localStorage.setItem(LEAN_KEY, on ? '1' : '0') } catch (e) { /* 無痕視窗等 */ }
  }

  $mode.addEventListener('click', function () {
    setLean(!document.body.classList.contains('lean'))
  })

  try { setLean(localStorage.getItem(LEAN_KEY) === '1') } catch (e) { setLean(false) }

  // 收起標題：masthead 縮成一條細列，做法同精簡模式——只切 body.compact，交給 CSS
  var $head = document.getElementById('head-toggle')
  var COMPACT_KEY = 'laozi-reader:compact'

  function setCompact(on) {
    document.body.classList.toggle('compact', on)
    $head.setAttribute('aria-expanded', on ? 'false' : 'true')
    $head.textContent = on ? '展開 ﹀' : '收起 ︿'
    $head.title = on ? '展開標題' : '收起標題'
    try { localStorage.setItem(COMPACT_KEY, on ? '1' : '0') } catch (e) { /* 無痕視窗等 */ }
  }

  $head.addEventListener('click', function () {
    setCompact(!document.body.classList.contains('compact'))
  })

  try { setCompact(localStorage.getItem(COMPACT_KEY) === '1') } catch (e) { setCompact(false) }

  // 讀過標記：純手動，標了才算；只存在這台瀏覽器
  var READ_KEY = 'laozi-reader:read'
  var readSet = {}

  function loadRead() {
    try {
      var raw = JSON.parse(localStorage.getItem(READ_KEY) || '[]')
      readSet = {}
      if (Array.isArray(raw)) raw.forEach(function (n) { readSet[n] = true })
    } catch (e) { readSet = {} }
  }

  function saveRead() {
    var list = Object.keys(readSet).filter(function (k) { return readSet[k] })
      .map(Number).sort(function (a, b) { return a - b })
    try { localStorage.setItem(READ_KEY, JSON.stringify(list)) } catch (e) { /* 無痕視窗等 */ }
  }

  function readCount() {
    return Object.keys(readSet).filter(function (k) { return readSet[k] }).length
  }

  function renderProgress() {
    var n = readCount()
    var p = passCount()
    $progress.textContent = index.chapters.length + ' / ' + TOTAL + ' 章已有資料' +
      (n ? '　已讀 ' + n + ' 章' : '') + (p ? '　通過 ' + p + ' 章' : '')
  }

  function readButton(ch) {
    var on = !!readSet[ch]
    return '<button type="button" class="read-toggle' + (on ? ' on' : '') + '" ' +
      'data-read="' + ch + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      (on ? '✓ 已讀' : '標記讀過') + '</button>'
  }

  // 標記後只動那顆鈕、側欄該格與進度列，不重畫整章
  function toggleRead(ch) {
    readSet[ch] = !readSet[ch]
    saveRead()
    var btn = $main.querySelector('.read-toggle[data-read="' + ch + '"]')
    if (btn) btn.outerHTML = readButton(ch)
    var li = $list.querySelector('li[data-ch="' + ch + '"]')
    if (li) li.classList.toggle('read', !!readSet[ch])
    renderProgress()
  }

  // 本章小考：五題答對四題算通過。與「讀過」分開——讀過是自己說的，通過是考出來的。
  var PASS_KEY = 'laozi-reader:pass'
  var CHAPQUIZ_KEY = 'laozi-reader:chapquiz'
  var PASS_NEED = 4
  var DRAW = 5                 // 每次考幾題（題庫可以比這個多，多的部分隨機抽）
  var GENERAL_NEED = 8         // 綜合小測驗十題，答對八題算通過
  var GENERAL = 0              // 綜合測驗在 passSet 裡借用章號 0，免得再開一把 key
  var passSet = {}
  var chapAnswers = {}
  var chapQuiz = {}

  function loadQuizState() {
    try {
      var p = JSON.parse(localStorage.getItem(PASS_KEY) || '[]')
      passSet = {}
      if (Array.isArray(p)) p.forEach(function (n) { passSet[n] = true })
    } catch (e) { passSet = {} }
    try { chapAnswers = JSON.parse(localStorage.getItem(CHAPQUIZ_KEY) || '{}') || {} }
    catch (e) { chapAnswers = {} }
  }

  function saveQuizState() {
    var list = Object.keys(passSet).filter(function (k) { return passSet[k] })
      .map(Number).sort(function (a, b) { return a - b })
    try {
      localStorage.setItem(PASS_KEY, JSON.stringify(list))
      localStorage.setItem(CHAPQUIZ_KEY, JSON.stringify(chapAnswers))
    } catch (e) { /* 無痕視窗等 */ }
  }

  function passCount() {
    // 章數不算綜合測驗那一筆
    return Object.keys(passSet).filter(function (k) { return passSet[k] && Number(k) !== GENERAL }).length
  }

  function shuffle(a) {                      // Fisher–Yates
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = a[i]; a[i] = a[j]; a[j] = t
    }
    return a
  }

  // 舊版把作答直接存成 {題號: 是否}，沒有抽題紀錄；讀到舊格式就地補上 draw
  function chapState(ch, questions) {
    var st = chapAnswers[ch]
    if (st && st.ans && st.draw) return st
    if (st && !st.ans) st = { draw: Object.keys(st), ans: st }
    else st = { draw: null, ans: {} }
    if (!st.draw || !st.draw.length) {
      // 分層抽題：是與否各至少抽 2 題（題庫不足就有多少算多少）。
      // 不這樣做的話，5是2否的題庫有機會抽出 5 題全是「是」，
      // 一路猜「是」就能通過——那個「考核通過」標記就不值錢了。
      var yes = questions.filter(function (x) { return x.answer }).map(function (x) { return x.id })
      var no = questions.filter(function (x) { return !x.answer }).map(function (x) { return x.id })
      shuffle(yes); shuffle(no)
      var MIN = 2
      var pick = yes.splice(0, Math.min(MIN, yes.length))
        .concat(no.splice(0, Math.min(MIN, no.length)))
      var rest = yes.concat(no)
      shuffle(rest)
      pick = pick.concat(rest.slice(0, Math.max(0, Math.min(DRAW, questions.length) - pick.length)))
      shuffle(pick)
      st.draw = pick
    }
    chapAnswers[ch] = st
    return st
  }

  function drawnQuestions(ch) {
    var all = chapQuiz[ch].questions
    var st = chapState(ch, all)
    return st.draw.map(function (id) {
      return all.filter(function (x) { return x.id === id })[0]
    }).filter(Boolean)
  }

  function hasQuiz(ch) {
    var c = index.chapters.filter(function (x) { return x.chapter === ch })[0]
    return !!(c && c.quiz)
  }

  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ENTITIES[c] })
  }

  // 難字讀音：原文裡這些字加虛線底線，點一下看讀音（data/readings.json）
  var readings = {}

  // 只處理標籤外的文字，免得把 <mark> 裡的屬性也換掉
  function annotate(html) {
    if (!html) return html
    var out = ''
    var i = 0
    while (i < html.length) {
      var lt = html.indexOf('<', i)
      if (lt < 0) { out += ruby(html.slice(i)); break }
      out += ruby(html.slice(i, lt))
      var gt = html.indexOf('>', lt)
      if (gt < 0) { out += html.slice(lt); break }
      out += html.slice(lt, gt + 1)
      i = gt + 1
    }
    return out
  }

  function ruby(text) {
    var out = ''
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i)
      var r = readings[c]
      out += r ? '<span class="ru" data-ru="' + c + '" tabindex="0">' + c + '</span>' : c
    }
    return out
  }

  // 把句子裡的關鍵詞標出來（只在從關鍵詞跳過來時用），再加上難字底線
  function mark(text, term) {
    var safe = esc(text)
    if (term) safe = safe.split(esc(term)).join('<mark>' + esc(term) + '</mark>')
    return annotate(safe)
  }

  function showReading(c) {
    var r = readings[c]
    if (!r) return
    var bar = document.getElementById('reading-bar')
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'reading-bar'
      bar.addEventListener('click', function (e) {
        if (e.target.classList.contains('rb-close')) hideReading()
      })
      document.body.appendChild(bar)
    }
    // 只顯示注音；拼音仍留在 readings.json 裡備用，但不上畫面
    bar.innerHTML = '<span class="rb-char">' + esc(c) + '</span>' +
      '<span class="rb-zhuyin">' + esc(r.zhuyin) + '</span>' +
      '<span class="rb-gloss">' + esc(r.gloss) + '</span>' +
      '<button type="button" class="rb-close" aria-label="關閉">×</button>'
    bar.classList.add('on')
  }

  function hideReading() {
    var bar = document.getElementById('reading-bar')
    if (bar) bar.classList.remove('on')
  }

  function pad(n) { return ('00' + n).slice(-3) }

  function loadChapter(n) {
    if (cache[n]) return Promise.resolve(cache[n])
    return fetch('data/chapters/' + pad(n) + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error(r.status)
        return r.json()
      })
      .then(function (d) { cache[n] = d; return d })
  }

  // 前後章：照 index.chapters 的順序找鄰居（章沒建齊時會自動跳過缺的）
  function neighbors(ch) {
    var list = index.chapters.map(function (c) { return c.chapter })
    var i = list.indexOf(ch)
    return {
      prev: i > 0 ? list[i - 1] : null,
      next: i >= 0 && i < list.length - 1 ? list[i + 1] : null
    }
  }

  function renderNav(ch) {
    var nb = neighbors(ch)
    // 鄰章若標過已讀就加一個 ✓，翻過去之前就看得出來讀過沒
    var tick = function (n) { return readSet[n] ? '<span class="done">✓</span>' : '' }
    return '<nav class="chapnav">' +
      (nb.prev ? '<a href="#/' + nb.prev + '">← 第 ' + nb.prev + ' 章' + tick(nb.prev) + '</a>' : '<span></span>') +
      '<span class="cur">第 ' + ch + ' 章</span>' +
      (nb.next ? '<a href="#/' + nb.next + '">' + tick(nb.next) + '第 ' + nb.next + ' 章 →</a>' : '<span></span>') +
      '</nav>'
  }

  function renderSidebar() {
    // 81 章排成數字格子，道經／德經各一組；章旨放在 title 裡，滑過去看
    var lastPart = null
    var html = index.chapters.map(function (c) {
      var head = ''
      if (c.part !== lastPart) {
        head = '<li class="part">' + esc(c.part) + '</li>'
        lastPart = c.part
      }
      var cls = []
      if (readSet[c.chapter]) cls.push('read')
      if (passSet[c.chapter]) cls.push('pass')
      return head + '<li data-ch="' + c.chapter + '"' +
        (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' +
        '<a href="#/' + c.chapter + '" title="' + esc(c.gist) + '">' + c.chapter + '</a></li>'
    }).join('')
    $list.innerHTML = html
    renderProgress()

    $cloud.innerHTML = index.keywords.map(function (k) {
      var hits = k.refs.reduce(function (n, r) { return n + r.segments.length }, 0)
      return '<button class="kw" data-term="' + esc(k.term) + '">' + esc(k.term) +
        '<span class="n">' + hits + '</span></button>'
    }).join('')
  }

  function renderKeywordResult(term) {
    var k = index.keywords.filter(function (x) { return x.term === term })[0]
    if (!k) return ''
    var rows = k.refs.map(function (r) {
      var links = r.segments.map(function (s) {
        return '<a href="#/' + esc(s) + '">' + esc(s) + '</a>'
      }).join('、')
      return '<li>第 ' + r.chapter + ' 章：' + links +
        (r.sense ? ' <span class="source">（' + esc(r.sense) + '）</span>' : '') + '</li>'
    }).join('')
    return '<div class="kw-result">' +
      '<a class="close" href="#/" data-clear="1">清除</a>' +
      '<h3>「' + esc(term) + '」出現在 ' + k.chapters + ' 章</h3>' +
      '<ul>' + rows + '</ul></div>'
  }

  function renderNotes(notes, segId) {
    var mine = notes.filter(function (n) { return n.ref === segId })
    if (!mine.length) return ''
    return '<ul class="notes">' + mine.map(function (n) {
      var see = (n.see || []).map(function (s) {
        return '<a href="#/' + esc(s) + '">' + esc(s) + '</a>'
      }).join('、')
      return '<li>' +
        '<span class="type">' + esc(n.type) + '</span>' +
        (n.term ? '<span class="term">' + esc(n.term) + '</span>' : '') +
        esc(n.text) +
        (n.source ? ' <span class="source">〔' + esc(n.source) + '〕</span>' : '') +
        (see ? ' <span class="see">→ ' + see + '</span>' : '') +
        '</li>'
    }).join('') + '</ul>'
  }

  function renderChapter(d, focusSeg) {
    var draft = d.meta.status === 'draft'
    var html = ''

    if (activeTerm) html += renderKeywordResult(activeTerm)

    html += renderNav(d.chapter)
    html += '<div class="chapter-head">' +
      '<div class="head-row">' +
      '<h2>第 ' + d.chapter + ' 章' + (draft ? '<span class="badge">白話待校稿</span>' : '') +
      (passSet[d.chapter] ? '<span class="badge pass-badge">考核通過 ✓</span>' : '') + '</h2>' +
      readButton(d.chapter) + '</div>' +
      '<p class="meta">' + esc(d.part) + ' ／ ' + esc(d.meta.base || '王弼本') +
      ' ／ ' + d.segments.length + ' 句 ' + d.notes.length + ' 註' +
      (d.gist ? ' ／ ' + esc(d.gist) : '') + '</p>' +
      (function () {
        var list = idiomsOf(d.chapter)
        if (!list.length) return ''
        return '<p class="im-chips">本章出處的成語：' + list.map(function (x) {
          return '<a href="#/idioms/' + esc(x.id) + '">' + esc(x.idiom) + '</a>'
        }).join('') + '</p>'
      })() + '</div>'

    html += '<p class="full-text">' + mark(d.text, activeTerm) + '</p>'

    html += d.segments.map(function (s) {
      return '<div class="seg" id="' + esc(s.id) + '">' +
        '<div class="orig"><span class="sid">' + esc(s.id) + '</span>' + mark(s.text, activeTerm) + '</div>' +
        '<div class="plain">' + esc(s.plain) +
        (s.alt ? '<div class="alt">' + esc(s.alt) + '</div>' : '') + '</div>' +
        renderNotes(d.notes, s.id) +
        '</div>'
    }).join('')

    html += '<div class="readthrough"><h3>全章通讀</h3><p>' + esc(d.plain) + '</p></div>'
    if (hasQuiz(d.chapter)) html += '<section class="chapquiz" id="chapquiz"></section>'

    if (draft && d.meta.todo && d.meta.todo.length) {
      html += '<div class="todo-box">待辦：<ul>' +
        d.meta.todo.map(function (t) { return '<li>' + esc(t) + '</li>' }).join('') +
        '</ul></div>'
    }

    html += renderNav(d.chapter)

    $main.innerHTML = html

    Array.prototype.forEach.call($list.children, function (li) {
      li.classList.toggle('active', Number(li.dataset.ch) === d.chapter)
    })

    if (hasQuiz(d.chapter)) showChapQuiz(d.chapter)

    if (focusSeg) {
      var el = document.getElementById(focusSeg)
      if (el) {
        el.classList.add('hit')
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } else {
      window.scrollTo(0, 0)
    }
  }

  // ── 小測驗 ────────────────────────────────
  // 作答結果只存在瀏覽器（localStorage），不上傳也不跨裝置。
  var QUIZ_KEY = 'laozi-reader:quiz'
  var quiz = null
  var answers = {}

  function loadAnswers() {
    try { answers = JSON.parse(localStorage.getItem(QUIZ_KEY) || '{}') || {} }
    catch (e) { answers = {} }
  }

  function saveAnswers() {
    try { localStorage.setItem(QUIZ_KEY, JSON.stringify(answers)) } catch (e) { /* 無痕視窗等 */ }
  }

  function generalResult() {
    var done = 0, right = 0
    quiz.questions.forEach(function (q) {
      if (typeof answers[q.id] === 'boolean') {
        done++
        if (answers[q.id] === q.answer) right++
      }
    })
    return { done: done, right: right, total: quiz.questions.length }
  }

  function scoreLine() {
    var r = generalResult()
    if (r.done < r.total) {
      return '已答 ' + r.done + ' / ' + r.total + (r.done ? '，答對 ' + r.right + ' 題' : '') +
        '（答滿 ' + r.total + ' 題才結算）'
    }
    if (r.right >= GENERAL_NEED) {
      return '<strong class="pass">答對 ' + r.right + ' / ' + r.total + '　綜合測驗通過 ✓</strong>'
    }
    return '答對 ' + r.right + ' / ' + r.total + '　差一點（要 ' + GENERAL_NEED + ' 題才算通過）'
  }

  // 通過與否由答題結果決定；標記借 passSet 的章號 0，順便讓標題那排的連結掛上 ✓
  function gradeGeneral() {
    var r = generalResult()
    passSet[GENERAL] = r.done === r.total && r.right >= GENERAL_NEED
    saveQuizState()
    var link = document.querySelector('.quiz-link')
    if (link) {
      var tick = link.querySelector('.done')
      if (passSet[GENERAL] && !tick) link.insertAdjacentHTML('beforeend', '<span class="done">✓</span>')
      if (!passSet[GENERAL] && tick) tick.remove()
    }
  }

  // 一題的內容（作答前只有兩個鈕，答完才長出解說與原文連結）
  function renderQuestion(q, i) {
    var mine = answers[q.id]
    var answered = typeof mine === 'boolean'
    var html = '<p class="q-stmt"><span class="q-no">' + (i + 1) + '</span>' + esc(q.statement) + '</p>'

    html += '<p class="q-btns">' +
      '<button type="button" data-q="' + q.id + '" data-v="1"' +
      (answered && mine === true ? ' class="picked"' : '') + '>是</button>' +
      '<button type="button" data-q="' + q.id + '" data-v="0"' +
      (answered && mine === false ? ' class="picked"' : '') + '>否</button>' +
      '</p>'

    if (answered) {
      var ok = mine === q.answer
      html += '<p class="q-verdict ' + (ok ? 'ok' : 'ng') + '">' +
        (ok ? '答對了' : '答錯了') + '　正解：' + (q.answer ? '是' : '否') + '</p>' +
        '<p class="q-explain">' + esc(q.explain) + '</p>' +
        '<p class="q-ref">原文在 <a href="#/' + esc(q.ref) + '">' + esc(q.ref) + '</a></p>'
    }
    return html
  }

  function renderQuiz() {
    var html = '<div class="quiz">' +
      '<div class="chapter-head"><h2>' + esc(quiz.title) + '</h2>' +
      '<p class="meta">' + esc(quiz.intro) + '</p></div>' +
      '<p class="quiz-score" id="quiz-score">' + scoreLine() + '</p>' +
      '<ol class="quiz-list">' +
      quiz.questions.map(function (q, i) {
        return '<li class="qitem" id="qi-' + q.id + '">' + renderQuestion(q, i) + '</li>'
      }).join('') +
      '</ol>' +
      '<p class="quiz-foot">' +
      '<button type="button" class="quiz-reset">清空作答</button>' +
      '<a href="#/1">回到第 1 章</a></p>' +
      '</div>'

    $main.innerHTML = html
    Array.prototype.forEach.call($list.children, function (li) { li.classList.remove('active') })
    window.scrollTo(0, 0)
  }

  function showQuiz() {
    if (quiz) { renderQuiz(); return }
    fetch('data/quiz.json')
      .then(function (r) { return r.json() })
      .then(function (d) { quiz = d; loadAnswers(); gradeGeneral(); renderQuiz() })
      .catch(function () { $main.innerHTML = '<p class="loading">載不到 data/quiz.json。</p>' })
  }

  // ── 本章小考 ──────────────────────────────
  function chapQuizResult(ch) {
    var qs = drawnQuestions(ch)
    var mine = chapAnswers[ch].ans
    var done = 0, right = 0
    qs.forEach(function (x) {
      if (typeof mine[x.id] === 'boolean') {
        done++
        if (mine[x.id] === x.answer) right++
      }
    })
    return { done: done, right: right, total: qs.length }
  }

  function renderChapQuestion(ch, x, i) {
    var mine = chapAnswers[ch].ans[x.id]
    var answered = typeof mine === 'boolean'
    var html = '<p class="q-stmt"><span class="q-no">' + (i + 1) + '</span>' + esc(x.statement) + '</p>'
    html += '<p class="q-btns">' +
      '<button type="button" data-cq="' + ch + '" data-qid="' + x.id + '" data-v="1"' +
      (answered && mine === true ? ' class="picked"' : '') + '>是</button>' +
      '<button type="button" data-cq="' + ch + '" data-qid="' + x.id + '" data-v="0"' +
      (answered && mine === false ? ' class="picked"' : '') + '>否</button>' +
      '</p>'
    if (answered) {
      var ok = mine === x.answer
      html += '<p class="q-verdict ' + (ok ? 'ok' : 'ng') + '">' +
        (ok ? '答對了' : '答錯了') + '　正解：' + (x.answer ? '是' : '否') + '</p>' +
        '<p class="q-explain">' + esc(x.explain) + '</p>' +
        '<p class="q-ref">原文在 <a href="#/' + esc(x.ref) + '">' + esc(x.ref) + '</a></p>'
    }
    return html
  }

  function chapQuizFoot(ch) {
    var r = chapQuizResult(ch)
    var line
    if (r.done < r.total) {
      line = '已答 ' + r.done + ' / ' + r.total + '　答對 ' + r.right + ' 題（答滿五題才結算）'
    } else if (r.right >= Math.min(PASS_NEED, r.total)) {
      line = '<strong class="pass">答對 ' + r.right + ' / ' + r.total + '　考核通過 ✓</strong>'
    } else {
      line = '答對 ' + r.right + ' / ' + r.total + '　差一點（要 ' + PASS_NEED + ' 題才算通過），回頭看看原文再重做'
    }
    return '<p class="cq-foot"><span id="cq-score">' + line + '</span>' +
      '<button type="button" class="cq-reset" data-cq-reset="' + ch + '">重做本章</button></p>'
  }

  // 答滿五題才結算；通過與否直接由答題結果決定，不能自己按
  function gradeChapQuiz(ch) {
    var r = chapQuizResult(ch)
    var was = !!passSet[ch]
    var now = r.done === r.total && r.right >= Math.min(PASS_NEED, r.total)
    passSet[ch] = now
    saveQuizState()
    if (was !== now) {
      var li = $list.querySelector('li[data-ch="' + ch + '"]')
      if (li) li.classList.toggle('pass', now)
      var h2 = $main.querySelector('.head-row h2')
      if (h2) {
        var badge = h2.querySelector('.pass-badge')
        if (now && !badge) h2.insertAdjacentHTML('beforeend', '<span class="badge pass-badge">考核通過 ✓</span>')
        if (!now && badge) badge.remove()
      }
      renderProgress()
    }
  }

  function renderChapQuiz(ch) {
    var box = document.getElementById('chapquiz')
    if (!box) return
    var pool = chapQuiz[ch].questions.length
    var n = drawnQuestions(ch).length
    box.innerHTML = '<h3>本章小考</h3>' +
      '<p class="cq-intro">' + n + ' 題是非題，答對 ' + Math.min(PASS_NEED, n) + ' 題即通過；' +
      (pool > n ? '題庫共 ' + pool + ' 題，每次隨機抽 ' + n + ' 題，重做會換一批。' : '答完會告訴你原文在哪一句。') +
      '</p>' +
      '<ol class="quiz-list">' +
      drawnQuestions(ch).map(function (x, i) {
        return '<li class="qitem" id="cq-' + ch + '-' + x.id + '">' +
          renderChapQuestion(ch, x, i) + '</li>'
      }).join('') +
      '</ol>' + chapQuizFoot(ch)
  }

  function showChapQuiz(ch) {
    if (chapQuiz[ch]) { renderChapQuiz(ch); return }
    fetch('data/quiz/' + pad(ch) + '.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(function (d) { chapQuiz[ch] = d; renderChapQuiz(ch) })
      .catch(function () {
        var box = document.getElementById('chapquiz')
        if (box) box.innerHTML = ''
      })
  }

  // ── 成語 ──────────────────────────────────
  var idioms = null

  function idiomsOf(ch) {
    if (!idioms) return []
    return idioms.idioms.filter(function (x) { return Number(x.ref.split('.')[0]) === ch })
  }

  function renderIdioms(focus) {
    var html = '<div class="chapter-head"><h2>' + esc(idioms.title) + '</h2>' +
      '<p class="meta">' + esc(idioms.intro) + '　共 ' + idioms.idioms.length + ' 條</p></div>' +
      '<ol class="idiom-list">' +
      idioms.idioms.map(function (x) {
        return '<li class="idiom" id="im-' + x.id + '">' +
          '<h3>' + esc(x.idiom) + '<a class="im-ref" href="#/' + esc(x.ref) + '">第 ' +
          x.ref.split('.')[0] + ' 章 ' + esc(x.ref) + '</a></h3>' +
          '<p class="im-source">' + annotate(esc(x.source)) + '</p>' +
          '<p class="im-now"><span class="im-tag">今義</span>' + esc(x.now) + '</p>' +
          '<p class="im-note"><span class="im-tag">原文</span>' + esc(x.note) + '</p>' +
          '</li>'
      }).join('') + '</ol>'
    $main.innerHTML = html
    Array.prototype.forEach.call($list.children, function (li) { li.classList.remove('active') })
    if (focus) {
      var el = document.getElementById('im-' + focus)
      if (el) { el.classList.add('hit'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
    }
    window.scrollTo(0, 0)
  }

  function showIdioms(focus) {
    if (idioms) { renderIdioms(focus); return }
    fetch('data/idioms.json')
      .then(function (r) { return r.json() })
      .then(function (d) { idioms = d; renderIdioms(focus) })
      .catch(function () { $main.innerHTML = '<p class="loading">載不到 data/idioms.json。</p>' })
  }

  // #/idioms、#/quiz、#/1 或 #/1.3
  
  function route() {
    var raw = (location.hash || '').replace(/^#\/?/, '').trim()
    if (raw === 'quiz') { showQuiz(); return }
    if (raw === 'idioms' || raw.indexOf('idioms/') === 0) {
      showIdioms(raw.indexOf('/') > 0 ? raw.split('/')[1] : null); return
    }
    var parts = raw.split('.')
    var ch = parseInt(parts[0], 10)
    if (!ch || ch < 1 || ch > TOTAL) ch = index.chapters.length ? index.chapters[0].chapter : 1
    var seg = parts.length > 1 ? ch + '.' + parseInt(parts[1], 10) : null

    loadChapter(ch)
      .then(function (d) { renderChapter(d, seg) })
      .catch(function () {
        $main.innerHTML = '<p class="loading">第 ' + ch + ' 章還沒有資料。' +
          '目前完成 ' + index.chapters.map(function (c) { return c.chapter }).join('、') + ' 章。</p>'
      })
  }

  $cloud.addEventListener('click', function (e) {
    var btn = e.target.closest('.kw')
    if (!btn) return
    var term = btn.dataset.term
    activeTerm = activeTerm === term ? null : term
    Array.prototype.forEach.call($cloud.children, function (b) {
      b.classList.toggle('on', b.dataset.term === activeTerm)
    })
    var k = index.keywords.filter(function (x) { return x.term === activeTerm })[0]
    if (k) {
      var target = '#/' + k.refs[0].segments[0]
      if (location.hash === target) route()   // hash 沒變不會觸發 hashchange，手動重畫
      else location.hash = target
    } else {
      route()
    }
  })

  $main.addEventListener('click', function (e) {
    if (e.target.dataset && e.target.dataset.clear) {
      e.preventDefault()
      activeTerm = null
      Array.prototype.forEach.call($cloud.children, function (b) { b.classList.remove('on') })
      route()
      return
    }

    var cq = e.target.closest && e.target.closest('.q-btns button[data-cq]')
    if (cq) {
      var ch = Number(cq.dataset.cq)
      var qid = cq.dataset.qid
      if (!chapQuiz[ch]) return
      chapState(ch, chapQuiz[ch].questions).ans[qid] = cq.dataset.v === '1'
      saveQuizState()
      var drawn = drawnQuestions(ch)
      var di = -1
      drawn.forEach(function (x, n) { if (x.id === qid) di = n })
      document.getElementById('cq-' + ch + '-' + qid).innerHTML =
        renderChapQuestion(ch, drawn[di], di)
      gradeChapQuiz(ch)
      var foot = document.querySelector('.cq-foot')
      if (foot) foot.outerHTML = chapQuizFoot(ch)
      return
    }

    var cqr = e.target.closest && e.target.closest('.cq-reset')
    if (cqr) {
      var rch = Number(cqr.dataset.cqReset)
      delete chapAnswers[rch]
      passSet[rch] = false
      saveQuizState()
      renderChapQuiz(rch)
      var li2 = $list.querySelector('li[data-ch="' + rch + '"]')
      if (li2) li2.classList.remove('pass')
      var badge2 = $main.querySelector('.pass-badge')
      if (badge2) badge2.remove()
      renderProgress()
      return
    }

    var ru = e.target.closest && e.target.closest('.ru')
    if (ru) { showReading(ru.dataset.ru); return }
    var rd = e.target.closest && e.target.closest('.read-toggle')
    if (rd) { toggleRead(Number(rd.dataset.read)); return }

    // 作答：只重畫那一題與計分列，不整頁重畫（免得捲動位置跳掉）
    var pick = e.target.closest && e.target.closest('.q-btns button')
    if (pick && quiz) {
      var qid = pick.dataset.q
      var i = -1
      quiz.questions.forEach(function (q, n) { if (q.id === qid) i = n })
      if (i < 0) return
      answers[qid] = pick.dataset.v === '1'
      saveAnswers()
      document.getElementById('qi-' + qid).innerHTML = renderQuestion(quiz.questions[i], i)
      gradeGeneral()
      document.getElementById('quiz-score').innerHTML = scoreLine()
      return
    }

    if (e.target.classList && e.target.classList.contains('quiz-reset')) {
      answers = {}
      saveAnswers()
      gradeGeneral()
      renderQuiz()
    }
  })

  window.addEventListener('hashchange', route)

  // 鍵盤 ← → 翻章（焦點在輸入框時不搶）
  document.addEventListener('keydown', function (e) {
    if (!index || e.altKey || e.ctrlKey || e.metaKey) return
    var tag = (e.target && e.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'Escape') { hideReading(); return }
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('ru')) {
      showReading(e.target.dataset.ru); return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    var ch = parseInt((location.hash || '').replace(/^#\/?/, ''), 10)
    if (!ch) return
    var nb = neighbors(ch)
    var to = e.key === 'ArrowLeft' ? nb.prev : nb.next
    if (to) location.hash = '#/' + to
  })

  fetch('data/readings.json')
    .then(function (r) { return r.json() })
    .then(function (d) { readings = d.readings || {} })
    .catch(function () { readings = {} })
    .then(function () { return fetch('data/idioms.json') })
    .then(function (r) { return r.json() })
    .then(function (d) { idioms = d })
    .catch(function () { idioms = null })
    .then(function () { return fetch('data/index.json') })
    .then(function (r) { return r.json() })
    .then(function (d) {
      index = d
      loadRead()
      loadQuizState()
      if (passSet[GENERAL]) {
        var ql = document.querySelector('.quiz-link')
        if (ql) ql.insertAdjacentHTML('beforeend', '<span class="done">✓</span>')
      }
      renderSidebar()
      route()
    })
    .catch(function () {
      $main.innerHTML = '<p class="loading">載不到 data/index.json，' +
        '請先跑 <code>python tools/build_index.py</code>。</p>'
    })
})()
