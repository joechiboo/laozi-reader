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

  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ENTITIES[c] })
  }

  // 把句子裡的關鍵詞標出來（只在從關鍵詞跳過來時用）
  function mark(text, term) {
    var safe = esc(text)
    if (!term) return safe
    return safe.split(esc(term)).join('<mark>' + esc(term) + '</mark>')
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
    return '<nav class="chapnav">' +
      (nb.prev ? '<a href="#/' + nb.prev + '">← 第 ' + nb.prev + ' 章</a>' : '<span></span>') +
      '<span class="cur">第 ' + ch + ' 章</span>' +
      (nb.next ? '<a href="#/' + nb.next + '">第 ' + nb.next + ' 章 →</a>' : '<span></span>') +
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
      return head + '<li data-ch="' + c.chapter + '">' +
        '<a href="#/' + c.chapter + '" title="' + esc(c.gist) + '">' + c.chapter + '</a></li>'
    }).join('')
    $list.innerHTML = html
    $progress.textContent = index.chapters.length + ' / ' + TOTAL + ' 章已有資料'

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
      '<h2>第 ' + d.chapter + ' 章' + (draft ? '<span class="badge">白話待校稿</span>' : '') + '</h2>' +
      '<p class="meta">' + esc(d.part) + ' ／ ' + esc(d.meta.base || '王弼本') +
      ' ／ ' + d.segments.length + ' 句 ' + d.notes.length + ' 註' +
      (d.gist ? ' ／ ' + esc(d.gist) : '') + '</p></div>'

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

  // #/1 或 #/1.3
  function route() {
    var raw = (location.hash || '').replace(/^#\/?/, '').trim()
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
    }
  })

  window.addEventListener('hashchange', route)

  // 鍵盤 ← → 翻章（焦點在輸入框時不搶）
  document.addEventListener('keydown', function (e) {
    if (!index || e.altKey || e.ctrlKey || e.metaKey) return
    var tag = (e.target && e.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    var ch = parseInt((location.hash || '').replace(/^#\/?/, ''), 10)
    if (!ch) return
    var nb = neighbors(ch)
    var to = e.key === 'ArrowLeft' ? nb.prev : nb.next
    if (to) location.hash = '#/' + to
  })

  fetch('data/index.json')
    .then(function (r) { return r.json() })
    .then(function (d) {
      index = d
      renderSidebar()
      route()
    })
    .catch(function () {
      $main.innerHTML = '<p class="loading">載不到 data/index.json，' +
        '請先跑 <code>python tools/build_index.py</code>。</p>'
    })
})()
