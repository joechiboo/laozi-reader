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

  function renderSidebar() {
    var html = index.chapters.map(function (c) {
      return '<li data-ch="' + c.chapter + '"><a href="#/' + c.chapter + '">' +
        '<span class="num">' + c.chapter + '</span>' +
        (c.status === 'draft' ? '<span class="badge">草稿</span>' : '') +
        '<span class="gist">' + esc(c.gist) + '</span></a></li>'
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
