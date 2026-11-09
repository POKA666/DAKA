/* 小打卡 · 数据层（纯本地，无依赖）
 * localStorage 键：xiaodaka.v1
 * 规则：每天到了「结算时间」（默认 23:00）后，当天不能再打卡；
 *       第二天的计划表在首次打开时按计划历史生成；过去日期不能补打卡。
 */
(function (root, factory) {
  var api = factory(root);
  root.DakaStore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var KEY = 'xiaodaka.v1';
  var MAX_PLANS = 30;
  var MAX_MEMO = 300;
  var WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  var PLAN_COLORS = ['#2f6b4f', '#b1603f', '#3b5b8c', '#a84d63', '#a97a22', '#2f2b26', '#4f7d70', '#8a6a3f'];
  var EMOJIS = ['🌅', '💧', '📖', '🏃', '🧘', '💪', '🥗', '😴', '✍️', '🎸', '🧹', '🌱', '💊', '🦷', '📵', '🧠', '☀️', '🚶', '🚴', '🎯', '💻', '🍎', '🛌'];
  var THEMES = [
    { id: 'forest', name: '森林绿', color: '#2f6b4f' },
    { id: 'clay', name: '陶土橙', color: '#b1603f' },
    { id: 'indigo', name: '靛青', color: '#3b5b8c' },
    { id: 'rose', name: '玫瑰', color: '#a84d63' },
    { id: 'amber', name: '姜黄', color: '#a97a22' },
    { id: 'ink', name: '墨黑', color: '#2f2b26' }
  ];

  var memoryStorage = {};

  function storage() {
    try {
      if (root.localStorage) {
        root.localStorage.getItem(KEY);
        return root.localStorage;
      }
    } catch (e) {
      /* 隐私模式下 localStorage 可能抛错，退化成内存存储 */
    }
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(memoryStorage, k) ? memoryStorage[k] : null;
      },
      setItem: function (k, v) { memoryStorage[k] = String(v); },
      removeItem: function (k) { delete memoryStorage[k]; }
    };
  }

  /* ---------------- 日期工具 ---------------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayKey(now) { return dateKey(now || new Date()); }

  function isKey(key) { return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key); }

  function parseKey(key) {
    var p = String(key).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(key, n) {
    var d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  /* 0 = 周一 … 6 = 周日 */
  function weekdayMon(key) { return (parseKey(key).getDay() + 6) % 7; }

  function weekStartKey(key) { return addDays(key, -weekdayMon(key)); }

  function monthStartKey(key) { return String(key).slice(0, 7) + '-01'; }

  function monthEndKey(key) {
    var d = parseKey(monthStartKey(key));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return dateKey(d);
  }

  function daysInMonth(monthKey) {
    var d = parseKey(String(monthKey) + '-01');
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  /* ---------------- 默认数据 ---------------- */

  function defaultSettings() {
    return {
      accent: '#2f6b4f',
      accentId: 'forest',
      wallpaper: '',
      fontScale: 'md',
      cutoff: '23:00',
      sealedToday: ''
    };
  }

  function defaultState() {
    return {
      version: 1,
      plans: [],
      days: {},
      settings: defaultSettings(),
      createdAt: new Date().toISOString()
    };
  }

  function isColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  function makeId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function normalizeSettings(src) {
    var base = defaultSettings();
    if (!src || typeof src !== 'object') return base;
    if (isColor(src.accent)) base.accent = src.accent.toLowerCase();
    if (typeof src.accentId === 'string') base.accentId = src.accentId;
    if (typeof src.wallpaper === 'string') base.wallpaper = src.wallpaper;
    if (src.fontScale === 'sm' || src.fontScale === 'md' || src.fontScale === 'lg') base.fontScale = src.fontScale;
    if (typeof src.cutoff === 'string' && /^\d{1,2}:\d{2}$/.test(src.cutoff)) base.cutoff = src.cutoff;
    if (isKey(src.sealedToday)) base.sealedToday = src.sealedToday;
    return base;
  }

  function sanitizePlan(p) {
    if (!p || typeof p !== 'object') return null;
    var name = String(p.name == null ? '' : p.name).trim().slice(0, 12);
    if (!name) return null;
    var weekdays = Array.isArray(p.weekdays)
      ? p.weekdays.map(Number).filter(function (n) { return n >= 0 && n <= 6; }).sort()
      : [];
    weekdays = weekdays.filter(function (n, i) { return weekdays.indexOf(n) === i; });
    var freq = p.freq === 'weekly' && weekdays.length ? 'weekly' : 'daily';
    return {
      id: typeof p.id === 'string' && p.id ? p.id : makeId(),
      name: name,
      emoji: typeof p.emoji === 'string' ? p.emoji.slice(0, 8) : '',
      color: isColor(p.color) ? p.color : PLAN_COLORS[0],
      freq: freq,
      weekdays: freq === 'weekly' ? weekdays : [],
      startDate: isKey(p.startDate) ? p.startDate : todayKey(),
      archivedAt: isKey(p.archivedAt) ? p.archivedAt : null,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now()
    };
  }

  function sanitizeDays(src) {
    var out = {};
    if (!src || typeof src !== 'object') return out;
    Object.keys(src).forEach(function (key) {
      if (!isKey(key)) return;
      var raw = src[key];
      if (!raw || typeof raw !== 'object') return;
      var items = [];
      if (Array.isArray(raw.items)) {
        raw.items.forEach(function (it) {
          if (!it || typeof it.planId !== 'string') return;
          items.push({
            planId: it.planId,
            name: String(it.name == null ? '' : it.name).slice(0, 24),
            emoji: typeof it.emoji === 'string' ? it.emoji.slice(0, 8) : '',
            color: isColor(it.color) ? it.color : PLAN_COLORS[0]
          });
        });
      }
      var checked = {};
      if (raw.checked && typeof raw.checked === 'object') {
        items.forEach(function (it) {
          var t = raw.checked[it.planId];
          if (t) checked[it.planId] = typeof t === 'number' ? t : 1;
        });
      }
      out[key] = {
        items: items,
        checked: checked,
        memo: String(raw.memo == null ? '' : raw.memo).slice(0, MAX_MEMO),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
      };
    });
    return out;
  }

  function normalizeState(data) {
    var base = defaultState();
    if (!data || typeof data !== 'object') return base;
    if (data.createdAt) base.createdAt = data.createdAt;
    base.settings = normalizeSettings(data.settings);
    base.plans = Array.isArray(data.plans) ? data.plans.map(sanitizePlan).filter(Boolean) : [];
    base.days = sanitizeDays(data.days);
    return base;
  }

  /* ---------------- 读写 ---------------- */

  function load() {
    var raw = null;
    try { raw = storage().getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return defaultState();
    var data;
    try { data = JSON.parse(raw); } catch (e) { return defaultState(); }
    return normalizeState(data);
  }

  function save(state) {
    try {
      storage().setItem(KEY, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'quota' };
    }
  }

  function reset() {
    var fresh = defaultState();
    save(fresh);
    return fresh;
  }

  function clearDays(state) {
    state.days = {};
    return state;
  }

  function setSettings(state, patch) {
    var next = {};
    Object.keys(state.settings || {}).forEach(function (k) { next[k] = state.settings[k]; });
    Object.keys(patch || {}).forEach(function (k) { next[k] = patch[k]; });
    state.settings = normalizeSettings(next);
    return state.settings;
  }

  /* 改结算时间：如果今天已经按旧时间结算过，就把今天封住，新时间从明天生效，避免用改时间“补签”今天 */
  function setCutoff(state, value, now) {
    now = now || new Date();
    if (!/^\d{1,2}:\d{2}$/.test(String(value))) return { ok: false, reason: 'format' };
    var today = todayKey(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var wasSettled = nowMin >= cutoffMinutes(state.settings) || state.settings.sealedToday === today;
    var patch = {};
    Object.keys(state.settings || {}).forEach(function (k) { patch[k] = state.settings[k]; });
    patch.cutoff = String(value);
    patch.sealedToday = wasSettled ? today : (state.settings.sealedToday === today ? today : '');
    state.settings = normalizeSettings(patch);
    return { ok: true, cutoff: state.settings.cutoff, sealed: wasSettled };
  }

  /* ---------------- 结算与计划表生成 ---------------- */

  function cutoffMinutes(settings) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String((settings && settings.cutoff) || '23:00'));
    if (!m) return 23 * 60;
    var mins = (+m[1]) * 60 + (+m[2]);
    return Math.max(0, Math.min(23 * 60 + 59, mins));
  }

  function isLocked(key, settings, now) {
    now = now || new Date();
    var today = todayKey(now);
    if (key < today) return true;
    if (key > today) return true;
    /* 当天已按旧结算时间结算过、之后又改了结算时间：当天保持锁定，新时间从明天起生效 */
    if (settings && settings.sealedToday === today) return true;
    return now.getHours() * 60 + now.getMinutes() >= cutoffMinutes(settings);
  }

  function planApplies(plan, key) {
    if (plan.archivedAt && key >= plan.archivedAt) return false;
    if (key < plan.startDate) return false;
    if (plan.freq === 'weekly') {
      var days = plan.weekdays && plan.weekdays.length ? plan.weekdays : [0, 1, 2, 3, 4, 5, 6];
      return days.indexOf(weekdayMon(key)) !== -1;
    }
    return true;
  }

  function ensureDay(state, key, now) {
    if (state.days[key]) return state.days[key];
    var today = todayKey(now);
    var items = state.plans
      .filter(function (p) { return planApplies(p, key); })
      .map(function (p) {
        return { planId: p.id, name: p.name, emoji: p.emoji, color: p.color };
      });
    if (key > today) {
      return { items: items, checked: {}, memo: '', createdAt: 0 };
    }
    state.days[key] = { items: items, checked: {}, memo: '', createdAt: Date.now() };
    return state.days[key];
  }

  function ensureRange(state, startKey, endKey, now) {
    if (!isKey(startKey) || !isKey(endKey) || startKey > endKey) return;
    var today = todayKey(now);
    if (endKey > today) endKey = today;
    var key = startKey;
    var guard = 0;
    while (key <= endKey && guard++ < 4000) {
      ensureDay(state, key, now);
      key = addDays(key, 1);
    }
  }

  function getPlan(state, planId) {
    for (var i = 0; i < state.plans.length; i++) {
      if (state.plans[i].id === planId) return state.plans[i];
    }
    return null;
  }

  function activePlans(state) {
    return state.plans.filter(function (p) { return !p.archivedAt; });
  }

  function addPlan(state, input, now) {
    now = now || new Date();
    input = input || {};
    var name = String(input.name == null ? '' : input.name).trim().slice(0, 12);
    if (!name) return { ok: false, reason: 'name' };
    if (activePlans(state).length >= MAX_PLANS) return { ok: false, reason: 'limit' };

    var today = todayKey(now);
    var locked = isLocked(today, state.settings, now);
    var plan = sanitizePlan({
      id: makeId(),
      name: name,
      emoji: input.emoji,
      color: input.color,
      freq: input.freq,
      weekdays: input.weekdays,
      startDate: locked ? addDays(today, 1) : today,
      archivedAt: null,
      createdAt: now.getTime()
    });
    state.plans.push(plan);

    if (!locked && planApplies(plan, today)) {
      var day = ensureDay(state, today, now);
      var exists = false;
      for (var i = 0; i < day.items.length; i++) {
        if (day.items[i].planId === plan.id) { exists = true; break; }
      }
      if (!exists) {
        day.items.push({ planId: plan.id, name: plan.name, emoji: plan.emoji, color: plan.color });
      }
    }
    return { ok: true, plan: plan, startDate: plan.startDate };
  }

  function updatePlan(state, planId, input, now) {
    now = now || new Date();
    var plan = getPlan(state, planId);
    if (!plan) return { ok: false, reason: 'missing' };
    input = input || {};
    var name = String(input.name == null ? '' : input.name).trim().slice(0, 12);
    if (!name) return { ok: false, reason: 'name' };

    plan.name = name;
    plan.emoji = typeof input.emoji === 'string' ? input.emoji.slice(0, 8) : plan.emoji;
    plan.color = isColor(input.color) ? input.color : plan.color;
    var weekdays = Array.isArray(input.weekdays)
      ? input.weekdays.map(Number).filter(function (n) { return n >= 0 && n <= 6; })
      : plan.weekdays;
    weekdays = weekdays.filter(function (n, i) { return weekdays.indexOf(n) === i; }).sort();
    plan.freq = input.freq === 'weekly' && weekdays.length ? 'weekly' : 'daily';
    plan.weekdays = plan.freq === 'weekly' ? weekdays : [];

    var today = todayKey(now);
    var day = state.days[today];
    if (day && !isLocked(today, state.settings, now)) {
      var nextItems = [];
      var found = false;
      day.items.forEach(function (it) {
        if (it.planId !== planId) { nextItems.push(it); return; }
        found = true;
        if (planApplies(plan, today)) {
          nextItems.push({ planId: planId, name: plan.name, emoji: plan.emoji, color: plan.color });
        } else if (!day.checked[planId]) {
          /* 今天不再需要打卡，且还没打过 —— 从今天的表里去掉 */
        } else {
          nextItems.push(it);
        }
      });
      if (!found && planApplies(plan, today)) {
        nextItems.push({ planId: planId, name: plan.name, emoji: plan.emoji, color: plan.color });
      }
      day.items = nextItems;
    }
    return { ok: true, plan: plan };
  }

  function archivePlan(state, planId, now) {
    now = now || new Date();
    var plan = getPlan(state, planId);
    if (!plan) return { ok: false, reason: 'missing' };
    var today = todayKey(now);
    plan.archivedAt = today;
    var day = state.days[today];
    if (day) {
      day.items = day.items.filter(function (it) { return it.planId !== planId; });
      delete day.checked[planId];
    }
    return { ok: true };
  }

  /* ---------------- 单个日期 ---------------- */

  function dayStats(state, key, now) {
    var day = ensureDay(state, key, now);
    var total = day.items.length;
    var done = 0;
    day.items.forEach(function (it) {
      if (day.checked[it.planId]) done++;
    });
    return { total: total, done: done, pct: total ? Math.round(done * 100 / total) : 0 };
  }

  function toggleCheck(state, key, planId, now) {
    now = now || new Date();
    if (isLocked(key, state.settings, now)) {
      return { ok: false, reason: key > todayKey(now) ? 'future' : 'locked' };
    }
    var day = ensureDay(state, key, now);
    var exists = false;
    for (var i = 0; i < day.items.length; i++) {
      if (day.items[i].planId === planId) { exists = true; break; }
    }
    if (!exists) return { ok: false, reason: 'missing' };
    if (day.checked[planId]) delete day.checked[planId];
    else day.checked[planId] = now.getTime();
    return { ok: true, checked: !!day.checked[planId] };
  }

  function setMemo(state, key, memo, now) {
    var day = ensureDay(state, key, now);
    day.memo = String(memo == null ? '' : memo).slice(0, MAX_MEMO);
    return day.memo;
  }

  /* ---------------- 连续与统计 ---------------- */

  function earliestStart(state) {
    var min = null;
    state.plans.forEach(function (p) {
      if (!min || p.startDate < min) min = p.startDate;
    });
    return min;
  }

  function streak(state, refKey, now) {
    now = now || new Date();
    var start = earliestStart(state);
    if (!start) return 0;
    if (start > refKey) return 0;
    ensureRange(state, start, refKey, now);

    var key = refKey;
    var today = todayKey(now);
    var first = dayStats(state, key, now);
    if (first.total === 0 || first.pct < 100) {
      if (key !== today) return 0;
      key = addDays(key, -1);
    }
    var count = 0;
    var guard = 0;
    while (key >= start && guard++ < 4000) {
      var day = state.days[key];
      if (!day) break;
      var st = dayStats(state, key, now);
      if (st.total === 0 || st.pct < 100) break;
      count++;
      key = addDays(key, -1);
    }
    return count;
  }

  function planStreak(state, planId, refKey, now) {
    now = now || new Date();
    var plan = getPlan(state, planId);
    if (!plan || plan.archivedAt) return 0;
    if (plan.startDate > refKey) return 0;
    ensureRange(state, plan.startDate, refKey, now);

    var key = refKey;
    var today = todayKey(now);
    var count = 0;
    var guard = 0;
    while (key >= plan.startDate && guard++ < 4000) {
      if (planApplies(plan, key)) {
        var day = state.days[key];
        var hit = false;
        if (day) {
          for (var i = 0; i < day.items.length; i++) {
            if (day.items[i].planId === planId) { hit = true; break; }
          }
          if (hit && day.checked[planId]) count++;
          else if (key === today && key === refKey) { /* 今天还没打，不算断 */ }
          else break;
        } else {
          break;
        }
      }
      key = addDays(key, -1);
    }
    return count;
  }

  function bestStreak(state, now) {
    now = now || new Date();
    var keys = Object.keys(state.days).sort();
    var best = 0;
    var run = 0;
    var lastPerfect = null;
    keys.forEach(function (k) {
      var st = dayStats(state, k, now);
      if (st.total > 0 && st.pct === 100) {
        run = lastPerfect && addDays(lastPerfect, 1) === k ? run + 1 : 1;
        if (run > best) best = run;
        lastPerfect = k;
      } else {
        run = 0;
        lastPerfect = null;
      }
    });
    return best;
  }

  function rangeStats(state, startKey, endKey, now) {
    now = now || new Date();
    var today = todayKey(now);
    if (endKey > today) endKey = today;
    if (startKey > endKey) return { days: 0, perfect: 0, total: 0, done: 0, pct: 0 };
    ensureRange(state, startKey, endKey, now);
    var days = 0;
    var perfect = 0;
    var total = 0;
    var done = 0;
    var key = startKey;
    var guard = 0;
    while (key <= endKey && guard++ < 4000) {
      var st = dayStats(state, key, now);
      if (st.total > 0) {
        days++;
        total += st.total;
        done += st.done;
        if (st.pct === 100) perfect++;
      }
      key = addDays(key, 1);
    }
    return {
      days: days,
      perfect: perfect,
      total: total,
      done: done,
      pct: total ? Math.round(done * 100 / total) : 0
    };
  }

  function planStats(state, planId, startKey, endKey, now) {
    now = now || new Date();
    var today = todayKey(now);
    if (endKey > today) endKey = today;
    if (startKey > endKey) return { appearances: 0, done: 0, pct: 0 };
    ensureRange(state, startKey, endKey, now);
    var appearances = 0;
    var done = 0;
    var key = startKey;
    var guard = 0;
    while (key <= endKey && guard++ < 4000) {
      var day = state.days[key];
      if (day) {
        for (var i = 0; i < day.items.length; i++) {
          if (day.items[i].planId === planId) {
            appearances++;
            if (day.checked[planId]) done++;
            break;
          }
        }
      }
      key = addDays(key, 1);
    }
    return { appearances: appearances, done: done, pct: appearances ? Math.round(done * 100 / appearances) : 0 };
  }

  function totalChecked(state) {
    var total = 0;
    Object.keys(state.days).forEach(function (k) {
      total += Object.keys(state.days[k].checked || {}).length;
    });
    return total;
  }

  function recordedDays(state) {
    var count = 0;
    Object.keys(state.days).forEach(function (k) {
      if (state.days[k].items.length > 0) count++;
    });
    return count;
  }

  /* ---------------- 数据分析 ---------------- */

  /* 一段时间里每天的完成情况；当天没有计划的日子 pct 记为 null（折线图断开，不当作 0%） */
  function daySeries(state, startKey, endKey, now) {
    now = now || new Date();
    var today = todayKey(now);
    if (!isKey(startKey) || !isKey(endKey)) return [];
    if (endKey > today) endKey = today;
    if (startKey > endKey) return [];
    ensureRange(state, startKey, endKey, now);

    var out = [];
    var key = startKey;
    var guard = 0;
    while (key <= endKey && guard++ < 4000) {
      var day = state.days[key];
      var total = day ? day.items.length : 0;
      var done = 0;
      if (day) {
        day.items.forEach(function (it) {
          if (day.checked[it.planId]) done++;
        });
      }
      out.push({
        key: key,
        total: total,
        done: done,
        pct: total ? Math.round(done * 100 / total) : null
      });
      key = addDays(key, 1);
    }
    return out;
  }

  /* 近 N 天（含今天）的整体分析：完成率、全勤、每个计划、星期分布、与前 N 天对比 */
  function windowAnalysis(state, days, now) {
    now = now || new Date();
    days = Math.max(1, Math.min(90, Math.floor(days || 7)));
    var endKey = todayKey(now);
    var startKey = addDays(endKey, -(days - 1));
    var series = daySeries(state, startKey, endKey, now);

    var activeDays = 0;
    var perfectDays = 0;
    var total = 0;
    var done = 0;
    var planMap = {};
    var weekdayAgg = [];
    for (var w = 0; w < 7; w++) weekdayAgg.push({ total: 0, done: 0 });

    series.forEach(function (pt) {
      var day = state.days[pt.key];
      if (pt.total > 0) {
        activeDays++;
        total += pt.total;
        done += pt.done;
        if (pt.pct === 100) perfectDays++;
        var wi = weekdayMon(pt.key);
        weekdayAgg[wi].total += pt.total;
        weekdayAgg[wi].done += pt.done;
      }
      if (!day) return;
      day.items.forEach(function (it) {
        var e = planMap[it.planId];
        if (!e) {
          e = planMap[it.planId] = {
            id: it.planId,
            name: it.name,
            emoji: it.emoji,
            color: it.color,
            appearances: 0,
            done: 0
          };
        }
        e.appearances++;
        if (day.checked[it.planId]) e.done++;
      });
    });

    var plans = Object.keys(planMap).map(function (id) {
      var e = planMap[id];
      e.pct = e.appearances ? Math.round(e.done * 100 / e.appearances) : 0;
      return e;
    }).sort(function (a, b) {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return b.appearances - a.appearances;
    });

    var weekdays = weekdayAgg.map(function (agg, idx) {
      return {
        idx: idx,
        label: WEEK_LABELS[idx],
        total: agg.total,
        done: agg.done,
        pct: agg.total ? Math.round(agg.done * 100 / agg.total) : null
      };
    });

    var prev = rangeStats(state, addDays(startKey, -days), addDays(startKey, -1), now);
    var pct = total ? Math.round(done * 100 / total) : 0;

    return {
      days: days,
      startKey: startKey,
      endKey: endKey,
      series: series,
      activeDays: activeDays,
      perfectDays: perfectDays,
      total: total,
      done: done,
      pct: pct,
      plans: plans,
      weekdays: weekdays,
      prevPct: prev.pct,
      prevActiveDays: prev.days,
      hasPrev: prev.days > 0,
      delta: prev.days > 0 ? pct - prev.pct : null
    };
  }

  /* 最好的计划 / 最需要补的计划（至少出现 minTimes 次才参与比较） */
  function planRanking(analysis, minTimes) {
    var min = typeof minTimes === 'number' ? minTimes : 2;
    var eligible = analysis.plans.filter(function (p) { return p.appearances >= min; });
    if (!eligible.length) eligible = analysis.plans.slice();

    var sorted = eligible.slice().sort(function (a, b) {
      if (a.pct !== b.pct) return b.pct - a.pct;
      return b.appearances - a.appearances;
    });

    var n = sorted.length;
    if (!n) return { best: [], worst: [], eligible: [] };

    var kBest = Math.min(3, n <= 3 ? Math.max(1, Math.ceil(n / 2)) : 3);
    var best = sorted.slice(0, kBest);
    var rest = sorted.slice(kBest);
    var kWorst = Math.min(3, rest.length);
    var worst = kWorst ? rest.slice(-kWorst).reverse() : [];

    return { best: best, worst: worst, eligible: eligible };
  }

  /* ---------------- 备份 ---------------- */

  function exportData(state) {
    return JSON.stringify({
      app: 'xiaodaka',
      exportedAt: new Date().toISOString(),
      data: state
    }, null, 2);
  }

  function importData(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, reason: 'parse' }; }
    var data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.plans)) return { ok: false, reason: 'shape' };
    var state = normalizeState(data);
    return { ok: true, state: state, plans: state.plans.length };
  }

  /* ---------------- 对外 ---------------- */

  return {
    KEY: KEY,
    MAX_PLANS: MAX_PLANS,
    MAX_MEMO: MAX_MEMO,
    WEEK_LABELS: WEEK_LABELS,
    PLAN_COLORS: PLAN_COLORS,
    EMOJIS: EMOJIS,
    THEMES: THEMES,

    dateKey: dateKey,
    todayKey: todayKey,
    isKey: isKey,
    parseKey: parseKey,
    addDays: addDays,
    weekdayMon: weekdayMon,
    weekStartKey: weekStartKey,
    monthStartKey: monthStartKey,
    monthEndKey: monthEndKey,
    daysInMonth: daysInMonth,

    defaultState: defaultState,
    load: load,
    save: save,
    reset: reset,
    clearDays: clearDays,
    setSettings: setSettings,
    exportData: exportData,
    importData: importData,

    cutoffMinutes: cutoffMinutes,
    isLocked: isLocked,
    planApplies: planApplies,
    ensureDay: ensureDay,
    ensureRange: ensureRange,
    getPlan: getPlan,
    activePlans: activePlans,
    addPlan: addPlan,
    updatePlan: updatePlan,
    archivePlan: archivePlan,
    dayStats: dayStats,
    toggleCheck: toggleCheck,
    setMemo: setMemo,
    earliestStartKey: earliestStart,
    streak: streak,
    planStreak: planStreak,
    bestStreak: bestStreak,
    rangeStats: rangeStats,
    planStats: planStats,
    totalChecked: totalChecked,
    recordedDays: recordedDays,
    setCutoff: setCutoff,
    daySeries: daySeries,
    windowAnalysis: windowAnalysis,
    planRanking: planRanking
  };
});
