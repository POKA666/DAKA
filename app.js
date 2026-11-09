/* 小打卡 · 界面与交互 */
(function () {
  'use strict';

  var S = window.DakaStore;
  var state = S.load();
  var today = S.todayKey();

  var ui = {
    tab: 'today',
    date: today,
    calMonth: today.slice(0, 7),
    period: 'day',
    span: 7,
    editing: null,
    draft: null,
    justChecked: '',
    lastToday: today,
    lastLock: S.isLocked(today, state.settings)
  };

  /* 支持用地址栏 #stats 之类直接打开某个页面 */
  (function () {
    var want = String(window.location.hash || '').replace('#', '');
    if (['today', 'calendar', 'stats', 'settings'].indexOf(want) !== -1) ui.tab = want;
  })();

  var el = {
    view: document.getElementById('view'),
    fab: document.getElementById('fab'),
    backdrop: document.getElementById('sheetBackdrop'),
    sheetTitle: document.getElementById('sheetTitle'),
    form: document.getElementById('planForm'),
    name: document.getElementById('planName'),
    del: document.getElementById('planDelete'),
    error: document.getElementById('planError'),
    emojiGrid: document.getElementById('emojiGrid'),
    colorRow: document.getElementById('colorRow'),
    freqSeg: document.getElementById('freqSeg'),
    weekdayRow: document.getElementById('weekdayRow'),
    wallFile: document.getElementById('wallFile'),
    importFile: document.getElementById('importFile'),
    toast: document.getElementById('toast'),
    foot: document.getElementById('appFoot')
  };

  var saveTimer = null;
  var toastTimer = null;

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return { r: 47, g: 107, b: 79 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function shade(hex, amount) {
    var c = hexToRgb(hex);
    function ch(v) {
      var n = Math.round(v + 255 * amount);
      n = Math.max(0, Math.min(255, n));
      return ('0' + n.toString(16)).slice(-2);
    }
    return '#' + ch(c.r) + ch(c.g) + ch(c.b);
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-open'); }, 2200);
  }

  function saveNow() {
    var res = S.save(state);
    if (!res.ok) toast('存储空间满了，试试换一张小一点的壁纸');
    return res.ok;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function fmtMD(key) {
    var d = S.parseKey(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtShort(key) {
    var d = S.parseKey(key);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function weekName(key) {
    return '周' + S.WEEK_LABELS[S.weekdayMon(key)];
  }

  function applyTheme() {
    var s = state.settings;
    var accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : '#2f6b4f';
    var rgb = hexToRgb(accent);
    var root = document.documentElement;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', rgb.r + ', ' + rgb.g + ', ' + rgb.b);
    root.style.setProperty('--accent-2', shade(accent, -0.14));
    root.style.setProperty('--accent-soft', 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', 0.12)');
    root.style.setProperty('--wall', s.wallpaper ? 'url("' + s.wallpaper + '")' : 'none');
    root.style.fontSize = s.fontScale === 'sm' ? '15px' : s.fontScale === 'lg' ? '17.5px' : '16px';
    document.body.classList.toggle('has-wallpaper', !!s.wallpaper);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', s.wallpaper ? '#f4f1ea' : accent);
  }

  /* ---------------- 渲染入口 ---------------- */

  function render() {
    var html;
    if (ui.tab === 'calendar') html = calendarView();
    else if (ui.tab === 'stats') html = analysisView();
    else if (ui.tab === 'settings') html = settingsView();
    else html = todayView();

    el.view.innerHTML = html;
    el.view.classList.remove('is-fresh');
    void el.view.offsetWidth;
    el.view.classList.add('is-fresh');

    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (btn) {
      var on = btn.getAttribute('data-tab') === ui.tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    el.foot.textContent = '数据不联网、不上传 · 换手机或清理浏览器前，请到「设置」导出备份';
    el.fab.hidden = ui.tab === 'stats' || ui.tab === 'settings';
    S.save(state);
    ui.lastLock = S.isLocked(ui.date, state.settings);
  }

  /* ---------------- 今日页 ---------------- */

  function planSub(plan) {
    if (!plan) return '计划已删除';
    if (plan.archivedAt) return '已删除的计划';
    var todayKey = S.todayKey();
    var streak = S.planStreak(state, plan.id, todayKey);
    var freq = plan.freq === 'weekly'
      ? '每周' + plan.weekdays.map(function (i) { return S.WEEK_LABELS[i]; }).join('、')
      : '每天';
    return (streak > 0 ? '连续 ' + streak + ' 天 · ' : '') + freq;
  }

  function planRowsHtml(day) {
    if (!day.items.length) return '';
    return day.items.map(function (it) {
      var done = !!day.checked[it.planId];
      var plan = S.getPlan(state, it.planId);
      var editable = plan && !plan.archivedAt;
      return '<div class="plan-item' + (done ? ' is-done' : '') + (ui.justChecked === it.planId ? ' is-pop' : '') + '">' +
        '<button type="button" class="plan-tap" data-action="toggle" data-plan="' + esc(it.planId) + '" aria-pressed="' + done + '">' +
          '<span class="check" style="--pc:' + esc(it.color) + '">' +
            '<span class="check-emoji">' + (it.emoji ? esc(it.emoji) : '✓') + '</span>' +
            '<span class="check-tick">✓</span>' +
          '</span>' +
          '<span class="plan-main">' +
            '<span class="plan-name">' + esc(it.name) + '</span>' +
            '<span class="plan-sub">' + esc(planSub(plan)) + '</span>' +
          '</span>' +
        '</button>' +
        (editable
          ? '<button type="button" class="icon-btn plan-edit" data-action="edit-plan" data-plan="' + esc(it.planId) + '" aria-label="编辑计划">⋯</button>'
          : '') +
      '</div>';
    }).join('');
  }

  function noticeHtml(locked, key) {
    if (!locked) return '';
    var todayKey = S.todayKey();
    var body;
    if (key > todayKey) body = '<b>还没到这一天</b>未来日期不能提前打卡。';
    else if (key < todayKey) body = '<b>这一天已经结算</b>过去的日子不能补打卡，打卡只在当天进行。';
    else body = '<b>今天已结算（' + esc(state.settings.cutoff) + '）</b> · 明天再打卡吧';
    return '<div class="notice"><span class="notice-mark" aria-hidden="true">🔒</span><span>' + body + '</span></div>';
  }

  function todayView() {
    var key = ui.date;
    var todayKey = S.todayKey();
    var isToday = key === todayKey;
    var locked = S.isLocked(key, state.settings);
    var day = S.ensureDay(state, key);
    var stats = S.dayStats(state, key);
    var streak = S.streak(state, todayKey);
    var week = S.rangeStats(state, S.weekStartKey(todayKey), todayKey);
    var month = S.rangeStats(state, S.monthStartKey(todayKey), todayKey);

    var nav = '<div class="day-nav">' +
      '<button type="button" class="day-btn" data-action="day-prev" aria-label="前一天">‹</button>' +
      '<div class="day-title">' + fmtMD(key) + '<span class="day-week">' + weekName(key) + '</span>' +
        (isToday ? '<em>今天</em>' : '<button type="button" class="day-back" data-action="day-today">回到今天</button>') +
      '</div>' +
      '<button type="button" class="day-btn" data-action="day-next" aria-label="后一天"' + (key >= todayKey ? ' disabled' : '') + '>›</button>' +
      '</div>';

    var hero = '<div class="overview">' +
      '<div class="ov-top"><span>' + (isToday ? '今日完成' : '当日完成') + '</span><span>' + stats.done + ' / ' + stats.total + '</span></div>' +
      '<div class="ov-balance">' + stats.pct + '<small>%</small></div>' +
      '<div class="ov-track"><i style="width:' + stats.pct + '%"></i></div>' +
      '<div class="ov-meta">' +
        '<span class="ov-chip">已打卡 <b>' + stats.done + '</b> 项</span>' +
        '<span class="ov-chip">连续 <b>' + streak + '</b> 天</span>' +
        '<span class="ov-chip">本周 <b>' + week.done + '/' + week.total + '</b></span>' +
      '</div>' +
      '</div>';

    var plansHtml = day.items.length
      ? '<div class="card plan-card">' + planRowsHtml(day) + '</div>'
      : '<div class="card empty-card">' +
          '<div class="empty-mark" aria-hidden="true">✓</div>' +
          '<h2>' + (isToday ? '今天还没有计划' : '这一天没有计划') + '</h2>' +
          '<p>把想坚持的小事加进来：喝水、散步、读书、早睡…… 完成后点一下圆圈就算打卡。</p>' +
          '<button type="button" class="btn primary" data-action="new-plan">＋ 添加第一个计划</button>' +
        '</div>';

    var memo = '<div class="card memo-card">' +
      '<div class="card-title">' + (isToday ? '今日备忘录' : fmtMD(key) + ' 备忘录') + '</div>' +
      '<textarea id="memoInput" class="memo-input" maxlength="' + S.MAX_MEMO + '" placeholder="随手记两句：今天的状态、想提醒自己的事…">' + esc(day.memo) + '</textarea>' +
      '<div class="memo-foot"><span class="memo-state" id="memoState">自动保存</span><span id="memoCount">' + day.memo.length + '/' + S.MAX_MEMO + '</span></div>' +
      '</div>';

    var tip = '<p class="muted-note">每天 ' + esc(state.settings.cutoff) + ' 结算：到点后当天不能再打卡，第二天的计划表在次日首次打开时自动生成。</p>';

    return nav + hero + noticeHtml(locked, key) + plansHtml + memo + tip;
  }

  /* ---------------- 日历页 ---------------- */

  function monthLabel(monthKey) {
    var d = S.parseKey(monthKey + '-01');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  }

  function shiftMonth(monthKey, n) {
    var d = S.parseKey(monthKey + '-01');
    d.setMonth(d.getMonth() + n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function levelClass(stats) {
    if (!stats.total) return '';
    if (stats.pct >= 100) return 'lv-4';
    if (stats.pct >= 50) return 'lv-3';
    if (stats.pct > 0) return 'lv-2';
    return 'lv-1';
  }

  function calendarView() {
    var todayKey = S.todayKey();
    var month = ui.calMonth;
    var daysInMonth = S.daysInMonth(month);
    var offset = S.weekdayMon(month + '-01');
    var currentMonth = todayKey.slice(0, 7);

    var head = S.WEEK_LABELS.map(function (w) {
      return '<span class="cal-week">' + w + '</span>';
    }).join('');

    var cells = '';
    for (var i = 0; i < offset; i++) cells += '<span class="cal-cell is-blank"></span>';

    for (var d = 1; d <= daysInMonth; d++) {
      var key = month + '-' + pad2(d);
      var cls = 'cal-cell';
      var disabled = '';
      if (key > todayKey) {
        cls += ' is-future';
        disabled = ' disabled';
      } else {
        var st = S.dayStats(state, key);
        var lv = levelClass(st);
        if (lv) cls += ' ' + lv;
        if (key === todayKey) cls += ' is-today';
        if (key === ui.date) cls += ' is-selected';
      }
      cells += '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' + key + '"' + disabled + '>' + d + '</button>';
    }

    var monthStart = month + '-01';
    var monthEnd = S.monthEndKey(monthStart);
    var endForStats = monthEnd < todayKey ? monthEnd : todayKey;
    var mStats = monthStart <= todayKey
      ? S.rangeStats(state, monthStart, endForStats)
      : { days: 0, perfect: 0, total: 0, done: 0, pct: 0 };

    var nextDisabled = month >= currentMonth ? ' disabled' : '';

    return '<div class="month-bar">' +
        '<button type="button" class="day-btn" data-action="cal-prev" aria-label="上个月">‹</button>' +
        '<span class="month-label">' + monthLabel(month) + '</span>' +
        '<button type="button" class="day-btn" data-action="cal-next" aria-label="下个月"' + nextDisabled + '>›</button>' +
      '</div>' +
      '<div class="card" style="padding:14px 14px 10px">' +
        '<div class="cal-grid">' + head + cells + '</div>' +
        '<div class="cal-legend">少' +
          '<span class="legend-swatch" style="background:rgba(var(--accent-rgb), 0.12)"></span>' +
          '<span class="legend-swatch" style="background:rgba(var(--accent-rgb), 0.28)"></span>' +
          '<span class="legend-swatch" style="background:rgba(var(--accent-rgb), 0.55)"></span>' +
          '<span class="legend-swatch" style="background:var(--accent)"></span>多' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">' + monthLabel(month) + '小结</div>' +
        '<div class="summary-grid">' +
          '<div><span>完成率</span><strong>' + mStats.pct + '%</strong></div>' +
          '<div><span>全勤</span><strong>' + mStats.perfect + ' 天</strong></div>' +
          '<div><span>打卡</span><strong>' + mStats.done + ' 次</strong></div>' +
        '</div>' +
        '<p class="muted-note">点某一天，可以查看那天的计划和备忘录。过去的日子不能补打卡。</p>' +
      '</div>';
  }

  /* ---------------- 分析页 ---------------- */

  function statRow(label, subLabel, pct, action, date) {
    var empty = pct === 0;
    var inner = '<span class="stat-label">' + esc(label) + (subLabel ? '<small>' + esc(subLabel) + '</small>' : '') + '</span>' +
      '<span class="stat-track"><i class="stat-fill' + (empty ? ' is-empty' : '') + '" style="width:' + pct + '%"></i></span>' +
      '<span class="stat-pct' + (empty ? ' is-zero' : '') + '">' + pct + '%</span>';
    if (action) {
      return '<button type="button" class="stat-row" data-action="' + action + '" data-date="' + date + '">' + inner + '</button>';
    }
    return '<div class="stat-row is-static">' + inner + '</div>';
  }

  /* 折线图：完成率趋势（SVG，不依赖任何库） */
  function trendChart(series) {
    var W = 320, H = 152, padL = 30, padR = 10, padT = 12, padB = 24;
    var iw = W - padL - padR;
    var ih = H - padT - padB;
    var n = series.length;

    function px(i) { return padL + (n <= 1 ? iw / 2 : iw * i / (n - 1)); }
    function py(v) { return padT + ih * (1 - v / 100); }

    var grid = '';
    [0, 25, 50, 75, 100].forEach(function (v) {
      var gy = py(v);
      grid += '<line class="chart-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>' +
        '<text class="chart-txt" x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + v + '</text>';
    });

    var segs = [];
    var cur = [];
    series.forEach(function (pt, i) {
      if (pt.pct === null) {
        if (cur.length) { segs.push(cur); cur = []; }
        return;
      }
      cur.push({ i: i, v: pt.pct });
    });
    if (cur.length) segs.push(cur);

    var areaPaths = '';
    var linePaths = '';
    var dots = '';
    var dotR = n > 14 ? 1.7 : 2.6;

    segs.forEach(function (seg) {
      var d = seg.map(function (p, idx) {
        return (idx ? 'L' : 'M') + px(p.i).toFixed(1) + ' ' + py(p.v).toFixed(1);
      }).join(' ');
      linePaths += '<path class="chart-line" d="' + d + '"/>';
      if (seg.length > 1) {
        areaPaths += '<path class="chart-area" d="' + d + ' L' + px(seg[seg.length - 1].i).toFixed(1) + ' ' + (padT + ih) +
          ' L' + px(seg[0].i).toFixed(1) + ' ' + (padT + ih) + ' Z"/>';
      }
      seg.forEach(function (p) {
        var last = p.i === n - 1;
        dots += '<circle class="chart-dot' + (last ? ' is-last' : '') + '" cx="' + px(p.i).toFixed(1) +
          '" cy="' + py(p.v).toFixed(1) + '" r="' + (last ? dotR + 1 : dotR) + '"/>';
      });
    });

    var labels = '';
    var idxs = [];
    if (n <= 8) {
      for (var i = 0; i < n; i++) idxs.push(i);
    } else {
      [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((n - 1) * 3 / 4), n - 1].forEach(function (idx) {
        if (idxs.indexOf(idx) === -1) idxs.push(idx);
      });
    }
    idxs.forEach(function (idx) {
      var label = idx === n - 1 ? '今天' : fmtShort(series[idx].key);
      labels += '<text class="chart-txt" x="' + px(idx).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + label + '</text>';
    });

    return '<svg class="trend-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="完成率趋势折线图">' +
      grid + areaPaths + linePaths + dots + labels + '</svg>';
  }

  /* 星期分布：7 根小柱 */
  function weekdayChart(weekdays) {
    var bars = weekdays.map(function (w) {
      var empty = w.pct === null || w.pct === 0;
      var h = empty ? 3 : Math.max(4, w.pct);
      return '<div class="wd-col">' +
          '<span class="wd-val">' + (w.pct === null ? '·' : w.pct + '%') + '</span>' +
          '<div class="wd-bar"><i class="wd-fill' + (empty ? ' is-empty' : '') + '" style="height:' + h + '%"></i></div>' +
          '<span class="wd-label">' + w.label + '</span>' +
        '</div>';
    }).join('');
    return '<div class="wd-chart">' + bars + '</div>';
  }

  function rankRows(list, warn) {
    return list.map(function (p) {
      var red = warn && p.pct < 80;
      return '<div class="plan-rate-row">' +
          '<div class="plan-rate-top"><span>' + (p.emoji ? esc(p.emoji) + ' ' : '') + esc(p.name) + '</span>' +
          '<span>' + p.done + ' / ' + p.appearances + ' 天</span></div>' +
          '<div class="rate-track"><i class="rate-fill' + (red ? ' is-warn' : '') + '" style="width:' + p.pct + '%"></i></div>' +
        '</div>';
    }).join('');
  }

  function analysisSentence(an, rank, span) {
    if (!an.activeDays) {
      return '最近 ' + span + ' 天还没有可打卡的记录。加一个计划、打几天卡，这里就会出现趋势和强弱项。';
    }
    var out = [];
    var trend = '';
    if (an.hasPrev) {
      if (an.delta > 0) trend = '，比上 ' + span + ' 天高了 ' + an.delta + ' 个百分点';
      else if (an.delta < 0) trend = '，比上 ' + span + ' 天低了 ' + Math.abs(an.delta) + ' 个百分点';
      else trend = '，和上 ' + span + ' 天持平';
    }
    out.push('最近 ' + span + ' 天整体完成率 ' + an.pct + '%（' + an.done + '/' + an.total + ' 项）' + trend + '。');

    var best = rank.best[0];
    if (best) out.push('「' + best.name + '」完成得最多，' + best.done + '/' + best.appearances + ' 天。');

    var worst = null;
    rank.worst.forEach(function (p) {
      if (!worst && p.pct < 80) worst = p;
    });
    if (worst) out.push('「' + worst.name + '」最容易漏，' + worst.done + '/' + worst.appearances + ' 天。');
    else if (best) out.push('没有明显掉队的计划，保持住。');

    var wdBest = null;
    var wdWorst = null;
    an.weekdays.forEach(function (w) {
      if (w.pct === null) return;
      if (!wdBest || w.pct > wdBest.pct) wdBest = w;
      if (!wdWorst || w.pct < wdWorst.pct) wdWorst = w;
    });
    if (wdBest && wdWorst && wdBest.idx !== wdWorst.idx && wdBest.pct !== wdWorst.pct) {
      out.push('周' + wdBest.label + '完成得最好（' + wdBest.pct + '%），周' + wdWorst.label + '最容易漏（' + wdWorst.pct + '%）。');
    }
    return out.join('');
  }

  function analysisView() {
    var now = new Date();
    var todayKey = S.todayKey(now);
    var span = ui.span === 30 ? 30 : 7;
    var an = S.windowAnalysis(state, span, now);
    var rank = S.planRanking(an);
    var detailSeg = '<div class="seg big" role="tablist" aria-label="明细口径">' +
      ['day', 'week', 'month'].map(function (p) {
        var label = p === 'day' ? '每日' : p === 'week' ? '每周' : '每月';
        return '<button type="button" class="seg-btn' + (ui.period === p ? ' is-active' : '') + '" data-action="period" data-period="' + p + '">' + label + '</button>';
      }).join('') +
      '</div>';

    var rows = '';

    if (ui.period === 'day') {
      for (var i = 13; i >= 0; i--) {
        var key = S.addDays(todayKey, -i);
        var st = S.dayStats(state, key);
        rows += statRow(fmtShort(key), weekName(key), st.pct, 'pick-day', key);
      }
    } else if (ui.period === 'week') {
      var thisWeek = S.weekStartKey(todayKey);
      for (var w = 7; w >= 0; w--) {
        var start = S.addDays(thisWeek, -7 * w);
        var end = S.addDays(start, 6);
        var endClamped = end > todayKey ? todayKey : end;
        var ws = S.rangeStats(state, start, endClamped);
        rows += statRow(fmtShort(start) + '–' + fmtShort(end), w === 0 ? '本周' : '', ws.pct);
      }
    } else {
      var month = todayKey.slice(0, 7);
      for (var m = 5; m >= 0; m--) {
        var mKey = shiftMonth(month, -m);
        var mStart = mKey + '-01';
        var mEnd = S.monthEndKey(mStart);
        var mEndClamped = mEnd > todayKey ? todayKey : mEnd;
        var ms = S.rangeStats(state, mStart, mEndClamped);
        rows += statRow(monthLabel(mKey), m === 0 ? '本月' : '', ms.pct);
      }
    }

    var allStart = S.earliestStartKey(state);
    var overall = allStart ? S.rangeStats(state, allStart, todayKey) : { days: 0, perfect: 0, total: 0, done: 0, pct: 0 };
    var best = S.bestStreak(state);
    var current = S.streak(state, todayKey);
    var totalChecks = S.totalChecked(state);

    var summary = '<div class="card">' +
        '<div class="card-title">总览</div>' +
        '<div class="summary-grid">' +
          '<div><span>累计打卡</span><strong>' + totalChecks + ' 次</strong></div>' +
          '<div><span>全勤天数</span><strong>' + overall.perfect + ' 天</strong></div>' +
          '<div><span>当前连续</span><strong>' + current + ' 天</strong></div>' +
        '</div>' +
        '<div class="summary-grid" style="margin-top:14px">' +
          '<div><span>最长连续</span><strong>' + best + ' 天</strong></div>' +
          '<div><span>记录天数</span><strong>' + overall.days + ' 天</strong></div>' +
          '<div><span>整体完成率</span><strong>' + overall.pct + '%</strong></div>' +
        '</div>' +
      '</div>';

    var spanSeg = '<div class="seg big" role="tablist" aria-label="分析范围">' +
      [7, 30].map(function (d) {
        return '<button type="button" class="seg-btn' + (span === d ? ' is-active' : '') + '" data-action="span" data-span="' + d + '">近 ' + d + ' 天</button>';
      }).join('') +
      '</div>';

    var deltaHtml;
    if (!an.hasPrev) {
      deltaHtml = '<p class="chart-note">上 ' + span + ' 天没有记录，攒几天就能看到涨跌。</p>';
    } else if (an.delta > 0) {
      deltaHtml = '<p class="chart-note">比上 ' + span + ' 天 <b class="up">↑ ' + an.delta + '</b> 个百分点</p>';
    } else if (an.delta < 0) {
      deltaHtml = '<p class="chart-note">比上 ' + span + ' 天 <b class="down">↓ ' + Math.abs(an.delta) + '</b> 个百分点</p>';
    } else {
      deltaHtml = '<p class="chart-note">和上 ' + span + ' 天持平</p>';
    }

    var trendCard = '<div class="card">' +
        '<div class="card-head"><span class="card-title">完成率趋势</span><span class="card-tag">近 ' + span + ' 天 · 折线图</span></div>' +
        trendChart(an.series) +
        '<div class="summary-grid" style="margin-top:12px">' +
          '<div><span>平均完成率</span><strong>' + an.pct + '%</strong></div>' +
          '<div><span>打卡天数</span><strong>' + an.activeDays + ' 天</strong></div>' +
          '<div><span>全勤</span><strong>' + an.perfectDays + ' 天</strong></div>' +
        '</div>' +
        deltaHtml +
      '</div>';

    var bestRows = rankRows(rank.best, false);
    var worstList = rank.worst.filter(function (p) { return p.pct < 80; });
    var worstRows = rankRows(worstList, true);

    var rankCard = '<div class="card">' +
        '<div class="card-title">什么完成得好、什么要补</div>' +
        '<p class="insight">' + esc(analysisSentence(an, rank, span)) + '</p>' +
        '<div class="rank-sub">完成得好</div>' +
        (bestRows || '<p class="muted-note">还没有计划。</p>') +
        '<div class="rank-sub">需要加强</div>' +
        (worstRows || '<p class="muted-note">没有掉队的计划，全部保持住了。</p>') +
      '</div>';

    var weekdayCard = '<div class="card">' +
        '<div class="card-title">一周里哪天最容易漏</div>' +
        weekdayChart(an.weekdays) +
        '<p class="muted-note">柱高 = 近 ' + span + ' 天里这一天所有计划的合计完成率。</p>' +
      '</div>';

    var periodTitle = ui.period === 'day' ? '每日明细 · 最近 14 天'
      : ui.period === 'week' ? '每周明细 · 最近 8 周'
      : '每月明细 · 最近 6 个月';

    var detailCard = '<div class="card" style="padding-top:14px">' +
        '<div class="card-title">' + periodTitle + '</div>' +
        detailSeg +
        '<div class="stat-list" style="margin-top:12px">' + rows + '</div>' +
      '</div>';

    return summary + spanSeg + trendCard + rankCard + weekdayCard + detailCard;
  }

  /* ---------------- 设置页 ---------------- */

  function settingsView() {
    var s = state.settings;
    var active = S.activePlans(state);

    var swatches = S.THEMES.map(function (t) {
      var on = s.accent.toLowerCase() === t.color.toLowerCase() ? ' is-active' : '';
      return '<button type="button" class="swatch' + on + '" style="--sw:' + t.color + '" data-action="theme" data-accent="' + t.color + '" aria-label="' + t.name + '"></button>';
    }).join('');

    var fonts = [['sm', '小'], ['md', '标准'], ['lg', '大']].map(function (f) {
      return '<button type="button" class="seg-btn' + (s.fontScale === f[0] ? ' is-active' : '') + '" data-action="font" data-scale="' + f[0] + '">' + f[1] + '</button>';
    }).join('');

    var planRows = active.map(function (p) {
      return '<div class="plan-manage">' +
          '<span class="check" style="--pc:' + p.color + '">' + (p.emoji ? esc(p.emoji) : '✓') + '</span>' +
          '<span class="plan-main"><span class="plan-name">' + esc(p.name) + '</span><span class="plan-sub">' + esc(planSub(p)) + '</span></span>' +
          '<span class="mg-actions"><button type="button" class="btn small ghost" data-action="edit-plan" data-plan="' + esc(p.id) + '">编辑</button></span>' +
        '</div>';
    }).join('');

    return '<div class="card">' +
        '<div class="card-title">外观</div>' +
        '<div class="wall-row">' +
          '<div class="wall-preview">' + (s.wallpaper ? '' : '默认纸色') + '</div>' +
          '<div class="wall-actions">' +
            '<button type="button" class="btn small ghost" data-action="pick-wall">上传壁纸</button>' +
            '<button type="button" class="btn small ghost" data-action="remove-wall"' + (s.wallpaper ? '' : ' hidden') + '>移除</button>' +
          '</div>' +
        '</div>' +
        '<p class="muted-note" style="margin:2px 0 10px">上传一张手机里的照片做壁纸，会自动压缩后存在本机。</p>' +
        '<div class="card-title" style="margin-top:6px">主题颜色</div>' +
        '<div class="swatches">' + swatches +
          '<label class="custom-color">自定义<input type="color" id="customAccent" value="' + esc(s.accent) + '" aria-label="自定义主题颜色"></label>' +
        '</div>' +
        '<div class="card-title" style="margin-top:16px">字体大小</div>' +
        '<div class="seg font-seg">' + fonts + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">每日结算</div>' +
        '<div class="set-row">' +
          '<span class="set-label">结算时间</span>' +
          '<input type="time" id="cutoffInput" class="time-input" value="' + esc(s.cutoff) + '" min="18:00" max="23:59" step="60">' +
        '</div>' +
        '<p class="muted-note">到点后当天不能再打卡，也不能补打过去的日子；第二天的计划表在次日首次打开时自动生成。改结算时间不会解锁已经结算的今天，新时间从明天生效。</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">计划管理</div>' +
        (planRows || '<p class="muted-note" style="margin-top:3px">还没有计划，点下面的按钮添加一个。</p>') +
        '<button type="button" class="btn ghost block" data-action="new-plan">＋ 添加计划</button>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">数据</div>' +
        '<div class="data-line"><span>计划</span><b>' + active.length + ' 个</b></div>' +
        '<div class="data-line"><span>有记录的天数</span><b>' + S.recordedDays(state) + ' 天</b></div>' +
        '<div class="data-line"><span>累计打卡</span><b>' + S.totalChecked(state) + ' 次</b></div>' +
        '<div class="btn-row" style="margin-top:12px">' +
          '<button type="button" class="btn small ghost" data-action="export">导出备份</button>' +
          '<button type="button" class="btn small ghost" data-action="import">导入备份</button>' +
        '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button type="button" class="btn small ghost danger" data-action="clear-days">清空打卡记录</button>' +
          '<button type="button" class="btn small ghost danger" data-action="reset-all">恢复默认</button>' +
        '</div>' +
        '<p class="muted-note">换手机、清理浏览器之前，先「导出备份」保存一个 JSON 文件。</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">关于</div>' +
        '<p class="about-text">小打卡是纯本地小工具：不注册、不联网、不上传，数据只保存在这台设备的浏览器里。' +
        '把它「添加到主屏幕」后，可以像 App 一样打开。</p>' +
      '</div>';
  }

  /* ---------------- 弹层 ---------------- */

  function renderEmoji() {
    var list = ['<button type="button" class="emoji-btn is-none' + (ui.draft.emoji ? '' : ' is-active') + '" data-action="set-emoji" data-emoji="" aria-label="无图标">无</button>'];
    S.EMOJIS.forEach(function (e) {
      var on = ui.draft.emoji === e ? ' is-active' : '';
      list.push('<button type="button" class="emoji-btn' + on + '" data-action="set-emoji" data-emoji="' + e + '">' + e + '</button>');
    });
    el.emojiGrid.innerHTML = list.join('');
  }

  function renderColors() {
    el.colorRow.innerHTML = S.PLAN_COLORS.map(function (c) {
      var on = ui.draft.color.toLowerCase() === c.toLowerCase() ? ' is-active' : '';
      return '<button type="button" class="color-dot' + on + '" style="--sw:' + c + '" data-action="set-color" data-color="' + c + '" aria-label="颜色 ' + c + '"></button>';
    }).join('');
  }

  function renderFreq() {
    Array.prototype.forEach.call(el.freqSeg.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-freq') === ui.draft.freq);
    });
    el.weekdayRow.hidden = ui.draft.freq !== 'weekly';
    el.weekdayRow.innerHTML = S.WEEK_LABELS.map(function (w, i) {
      var on = ui.draft.weekdays.indexOf(i) !== -1 ? ' is-active' : '';
      return '<button type="button" class="weekday-chip' + on + '" data-action="toggle-weekday" data-day="' + i + '">' + w + '</button>';
    }).join('');
  }

  function openSheet() {
    el.backdrop.hidden = false;
    requestAnimationFrame(function () {
      el.backdrop.classList.add('is-open');
      document.body.classList.add('sheet-open');
    });
  }

  function closeSheet() {
    el.backdrop.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    setTimeout(function () { el.backdrop.hidden = true; }, 220);
  }

  function openPlanSheet(planId) {
    ui.editing = planId || null;
    var plan = planId ? S.getPlan(state, planId) : null;
    ui.draft = {
      emoji: plan ? plan.emoji : '',
      color: plan ? plan.color : S.PLAN_COLORS[0],
      freq: plan ? plan.freq : 'daily',
      weekdays: plan ? plan.weekdays.slice() : [0, 1, 2, 3, 4, 5, 6]
    };
    el.sheetTitle.textContent = plan ? '编辑计划' : '添加计划';
    el.name.value = plan ? plan.name : '';
    el.del.hidden = !plan;
    el.error.hidden = true;
    renderEmoji();
    renderColors();
    renderFreq();
    openSheet();
    if (!plan) setTimeout(function () { el.name.focus(); }, 250);
  }

  function submitPlan() {
    var name = el.name.value.trim();
    if (!name) {
      el.error.textContent = '给这个计划起个名字吧';
      el.error.hidden = false;
      return;
    }
    if (ui.draft.freq === 'weekly' && !ui.draft.weekdays.length) {
      el.error.textContent = '选一下每周哪几天打卡';
      el.error.hidden = false;
      return;
    }
    var input = {
      name: name,
      emoji: ui.draft.emoji,
      color: ui.draft.color,
      freq: ui.draft.freq,
      weekdays: ui.draft.weekdays
    };
    var now = new Date();
    var res = ui.editing ? S.updatePlan(state, ui.editing, input, now) : S.addPlan(state, input, now);
    if (!res.ok) {
      el.error.textContent = res.reason === 'limit' ? '计划最多 ' + S.MAX_PLANS + ' 个，删掉几个再加吧' : '保存失败，请重试';
      el.error.hidden = false;
      return;
    }
    if (!ui.editing) {
      var todayKey = S.todayKey(now);
      toast(res.startDate > todayKey ? '已添加，新计划从明天开始' : '计划已添加，点圆圈打卡');
    } else {
      toast('已保存');
    }
    saveNow();
    closeSheet();
    render();
  }

  /* ---------------- 壁纸 ---------------- */

  function readAsDataUrl(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { cb(reader.result); };
    reader.onerror = function () { toast('读取图片失败，换一张试试'); };
    reader.readAsDataURL(file);
  }

  function handleWallFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    readAsDataUrl(file, function (dataUrl) {
      var img = new Image();
      img.onload = function () {
        var max = 1440;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var jpeg;
        try { jpeg = canvas.toDataURL('image/jpeg', 0.8); } catch (e) { jpeg = dataUrl; }
        var old = state.settings.wallpaper;
        state.settings.wallpaper = jpeg;
        if (!saveNow()) {
          state.settings.wallpaper = old;
          toast('照片太大，本机存储放不下，换张小一点的吧');
          return;
        }
        applyTheme();
        render();
        toast('壁纸换好了');
      };
      img.onerror = function () { toast('这张图片读不出来，换一张试试'); };
      img.src = dataUrl;
    });
  }

  /* ---------------- 备份 ---------------- */

  function exportBackup() {
    var text = S.exportData(state);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '小打卡备份-' + S.todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1200);
    toast('备份文件已导出');
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = S.importData(reader.result);
      if (!res.ok) {
        toast(res.reason === 'parse' ? '这个文件不是小打卡的备份' : '备份内容不完整');
        return;
      }
      var go = window.confirm('将用备份里的 ' + res.plans + ' 个计划和记录覆盖当前数据，确定吗？');
      if (!go) return;
      state = res.state;
      saveNow();
      applyTheme();
      ui.date = S.todayKey();
      render();
      toast('备份已恢复');
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* ---------------- 事件 ---------------- */

  function setTab(tab) {
    if (['today', 'calendar', 'stats', 'settings'].indexOf(tab) === -1) return;
    ui.tab = tab;
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '#' + tab);
      }
    } catch (e) { /* 本地文件打开时可能不允许改 hash，忽略 */ }
    render();
  }

  function handleAction(action, target) {
    switch (action) {
      case 'new-plan':
        openPlanSheet(null);
        break;
      case 'edit-plan':
        openPlanSheet(target.getAttribute('data-plan'));
        break;
      case 'toggle': {
        var res = S.toggleCheck(state, ui.date, target.getAttribute('data-plan'), new Date());
        if (!res.ok) {
          toast(res.reason === 'future' ? '还没到这一天，不能提前打卡' : '已经结算，不能再打卡了');
          return;
        }
        ui.justChecked = res.checked ? target.getAttribute('data-plan') : '';
        saveNow();
        render();
        if (res.checked) {
          if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
          var st = S.dayStats(state, ui.date);
          if (st.total > 0 && st.pct === 100) toast('今天全部完成，厉害！');
          setTimeout(function () { ui.justChecked = ''; }, 400);
        }
        break;
      }
      case 'day-prev':
        ui.date = S.addDays(ui.date, -1);
        render();
        break;
      case 'day-next':
        if (ui.date < S.todayKey()) {
          ui.date = S.addDays(ui.date, 1);
          render();
        }
        break;
      case 'day-today':
        ui.date = S.todayKey();
        render();
        break;
      case 'pick-day':
        ui.date = target.getAttribute('data-date');
        ui.tab = 'today';
        render();
        break;
      case 'cal-prev':
        ui.calMonth = shiftMonth(ui.calMonth, -1);
        render();
        break;
      case 'cal-next':
        if (ui.calMonth < S.todayKey().slice(0, 7)) {
          ui.calMonth = shiftMonth(ui.calMonth, 1);
          render();
        }
        break;
      case 'period':
        ui.period = target.getAttribute('data-period');
        render();
        break;
      case 'span':
        ui.span = +target.getAttribute('data-span') === 30 ? 30 : 7;
        render();
        break;
      case 'pick-wall':
        el.wallFile.click();
        break;
      case 'remove-wall':
        if (!state.settings.wallpaper) return;
        if (!window.confirm('移除当前壁纸？')) return;
        state.settings.wallpaper = '';
        saveNow();
        applyTheme();
        render();
        toast('壁纸已移除');
        break;
      case 'theme':
        state.settings.accent = target.getAttribute('data-accent');
        state.settings.accentId = '';
        saveNow();
        applyTheme();
        render();
        break;
      case 'font':
        state.settings.fontScale = target.getAttribute('data-scale');
        saveNow();
        applyTheme();
        render();
        break;
      case 'export':
        exportBackup();
        break;
      case 'import':
        el.importFile.click();
        break;
      case 'clear-days':
        if (!window.confirm('清空所有打卡记录和备忘录？计划会保留。')) return;
        S.clearDays(state);
        saveNow();
        ui.date = S.todayKey();
        render();
        toast('打卡记录已清空');
        break;
      case 'reset-all':
        if (!window.confirm('会删除所有计划、打卡记录和设置，恢复到刚打开时的样子。确定吗？')) return;
        state = S.reset();
        applyTheme();
        ui.date = S.todayKey();
        ui.tab = 'today';
        render();
        toast('已恢复默认');
        break;
      case 'close-sheet':
        closeSheet();
        break;
      case 'set-emoji':
        ui.draft.emoji = target.getAttribute('data-emoji');
        renderEmoji();
        break;
      case 'set-color':
        ui.draft.color = target.getAttribute('data-color');
        renderColors();
        break;
      case 'set-freq':
        ui.draft.freq = target.getAttribute('data-freq') === 'weekly' ? 'weekly' : 'daily';
        renderFreq();
        break;
      case 'toggle-weekday': {
        var day = Number(target.getAttribute('data-day'));
        var at = ui.draft.weekdays.indexOf(day);
        if (at === -1) ui.draft.weekdays.push(day);
        else ui.draft.weekdays.splice(at, 1);
        ui.draft.weekdays.sort();
        renderFreq();
        break;
      }
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tabBtn = t.closest('.tab-btn');
    if (tabBtn) {
      setTab(tabBtn.getAttribute('data-tab'));
      return;
    }
    var actionEl = t.closest('[data-action]');
    if (!actionEl) {
      if (t === el.backdrop) closeSheet();
      return;
    }
    e.preventDefault();
    handleAction(actionEl.getAttribute('data-action'), actionEl);
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'memoInput') {
      var val = S.setMemo(state, ui.date, e.target.value);
      var count = document.getElementById('memoCount');
      var st = document.getElementById('memoState');
      if (count) count.textContent = val.length + '/' + S.MAX_MEMO;
      if (st) st.textContent = '正在保存…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveNow();
        if (st) { st.textContent = '已保存'; }
      }, 350);
      return;
    }
    if (e.target.id === 'customAccent') {
      state.settings.accent = e.target.value;
      state.settings.accentId = '';
      saveNow();
      applyTheme();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'wallFile') {
      handleWallFile(e.target.files && e.target.files[0]);
      e.target.value = '';
      return;
    }
    if (e.target.id === 'importFile') {
      handleImportFile(e.target.files && e.target.files[0]);
      e.target.value = '';
      return;
    }
    if (e.target.id === 'cutoffInput') {
      var v = e.target.value;
      if (!/^\d{1,2}:\d{2}$/.test(v)) return;
      var parts = v.split(':');
      var mins = (+parts[0]) * 60 + (+parts[1]);
      if (mins < 18 * 60) v = '18:00';
      if (mins > 23 * 60 + 59) v = '23:59';
      var cutRes = S.setCutoff(state, v, new Date());
      saveNow();
      render();
      toast(cutRes.sealed ? '今天已结算，新时间从明天生效' : '结算时间改为 ' + v);
    }
  });

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitPlan();
  });

  el.del.addEventListener('click', function () {
    if (!ui.editing) return;
    if (!window.confirm('删除这个计划？已经打过的卡会保留在历史里。')) return;
    S.archivePlan(state, ui.editing, new Date());
    saveNow();
    closeSheet();
    render();
    toast('计划已删除');
  });

  el.backdrop.addEventListener('click', function (e) {
    if (e.target === el.backdrop) closeSheet();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.backdrop.hidden) closeSheet();
  });

  /* ---------------- 跨零点 / 结算时间 ---------------- */

  setInterval(function () {
    var nowKey = S.todayKey();
    if (nowKey !== ui.lastToday) {
      var wasToday = ui.date === ui.lastToday;
      ui.lastToday = nowKey;
      if (wasToday) ui.date = nowKey;
      if (ui.tab === 'today' || ui.tab === 'calendar') render();
      return;
    }
    if (ui.tab === 'today') {
      var locked = S.isLocked(ui.date, state.settings);
      if (locked !== ui.lastLock) {
        ui.lastLock = locked;
        render();
      }
    }
  }, 30000);

  /* ---------------- 启动 ---------------- */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var host = location.hostname;
    var ok = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
    if (!ok) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  applyTheme();
  render();
  registerSW();
})();
