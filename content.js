/* 小黑盒 · 清净模式 —— 页面侧逻辑
   1) 极早地把设置写进 <html>，避免刷新时先闪一下原版界面
   2) 卡片级处理：已读、屏蔽词/作者、键盘光标
   3) 兜底：干掉悬浮的“下载/打开 APP”推广层
*/
(() => {
  'use strict';
  if (window.__xhhChill) return;
  window.__xhhChill = true;

  const KEY = globalThis.XHH_KEY || 'xhh.settings.v1';
  const DEFAULTS = globalThis.XHH_DEFAULTS || {};
  const READ_KEY = 'xhh.read.v1';
  const READ_MAX = 2500;
  const CARD_SEL = '.bbs-home__content-item';
  // 推广层关键词：先做字符串预筛，命中才去碰 getComputedStyle（贵）
  const NAG_RE = /下载|打开APP|打开App|扫码/;

  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  let settings = { ...DEFAULTS };

  /* ------------------------------------------------------------ 设置读取 */

  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cached && typeof cached === 'object') settings = mergeSettings(cached);
  } catch (_) {
    /* 忽略坏掉的缓存 */
  }

  function mergeSettings(stored) {
    const merged = { ...DEFAULTS, ...(stored || {}) };
    // v1.3.2 迁移：旧默认 680 且用户没在弹窗里主动选过宽度 → 升级为自适应
    if (merged.width === 680 && !merged.__wChosen) merged.width = DEFAULTS.width;
    return merged;
  }

  function effectiveTheme() {
    if (settings.theme === 'auto') return mq.matches ? 'dark' : 'light';
    return settings.theme;
  }

  function apply() {
    const root = document.documentElement;
    if (!root) return; // document_start 时极少数情况下 DOM 还没建好
    const on = !!settings.on;

    root.classList.toggle('xhh-on', on);

    const flags = {
      'xhh-hide-nav': settings.hideNav,
      'xhh-hide-search': settings.hideSearch,
      'xhh-hide-topics': settings.hideTopics,
      'xhh-hide-sidebar': settings.hideSidebar,
      'xhh-hide-actions': settings.hideActions,
      'xhh-hide-reply': settings.hideReply,
      'xhh-dim-read': settings.dimRead,
      'xhh-hide-read': settings.hideRead
    };
    for (const [cls, value] of Object.entries(flags)) {
      root.classList.toggle(cls, on && !!value);
    }

    root.dataset.xhhTheme = effectiveTheme();
    root.classList.toggle('xhh-no-imgcap', !settings.imgMax);

    const style = root.style;
    style.setProperty('--xhh-fs', `${Number(settings.fontSize) || 18}px`);
    style.setProperty('--xhh-lh', String(Number(settings.lineHeight) || 1.9));
    const w = Number(settings.width);
    style.setProperty('--xhh-w', w > 0 ? `${w}px` : 'min(calc(100vw - 48px), 960px)');
    style.setProperty('--xhh-img', settings.imgMax ? `${Number(settings.imgMax)}vh` : 'none');
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (_) {
      /* 存不下就算了 */
    }
    try {
      chrome.storage.sync.set({ [KEY]: settings });
    } catch (_) {
      /* 扩展上下文失效（更新中） */
    }
  }

  /* ------------------------------------------------------------ 已读记录 */

  let readCache = null;

  function readMap() {
    if (readCache) return readCache;
    try {
      readCache = JSON.parse(localStorage.getItem(READ_KEY) || '{}') || {};
    } catch (_) {
      readCache = {};
    }
    return readCache;
  }

  function markRead(id) {
    if (!id) return false;
    const map = readMap();
    if (map[id]) return false;
    map[id] = Date.now();
    const keys = Object.keys(map);
    if (keys.length > READ_MAX) {
      keys.sort((a, b) => map[a] - map[b]);
      keys.slice(0, keys.length - READ_MAX).forEach((k) => delete map[k]);
    }
    readCache = map;
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(map));
    } catch (_) {
      /* 空间满 */
    }
    return true;
  }

  /* ------------------------------------------------------------ 卡片处理 */

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  function postIdOf(el) {
    const link = el.matches('a[href*="/app/bbs/link/"]')
      ? el
      : el.querySelector('a[href*="/app/bbs/link/"]');
    if (!link) return '';
    const m = (link.getAttribute('href') || '').match(/\/link\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  let blockWords = [];
  let blockUsers = [];

  function refreshRules() {
    blockWords = (settings.blockWords || [])
      .map((w) => String(w).trim().toLowerCase())
      .filter(Boolean);
    blockUsers = (settings.blockUsers || []).map((u) => String(u).trim()).filter(Boolean);
  }

  /* 单张卡：已读标记 + 屏蔽判定。增量调用，只看这一张，不碰别人 */
  function applyCard(card) {
    const id = postIdOf(card);
    if (id && readMap()[id]) card.dataset.xhhRead = '1';
    else delete card.dataset.xhhRead;

    if (!settings.on) {
      delete card.dataset.xhhBlocked;
      return;
    }

    // 没有任何屏蔽规则时，别白读一遍标题正文
    if (!blockWords.length && !blockUsers.length) {
      delete card.dataset.xhhBlocked;
      return;
    }

    const author = text(card.querySelector('.list-content__username'));
    let blocked = blockUsers.includes(author);

    if (!blocked && blockWords.length) {
      const hay = `${text(card.querySelector('.bbs-content__title'))}\n${text(
        card.querySelector('.bbs-content__content')
      )}`.toLowerCase();
      blocked = blockWords.some((w) => hay.includes(w));
    }

    if (blocked) card.dataset.xhhBlocked = '1';
    else delete card.dataset.xhhBlocked;
  }

  /* 空时间线提示的计数：一次选择器拿完，逐卡统计太贵 */
  function updateEmptyNote() {
    if (!settings.on) {
      dropEmptyNote();
      return;
    }
    const total = document.querySelectorAll(CARD_SEL).length;
    const hiddenRead = settings.hideRead
      ? document.querySelectorAll(`${CARD_SEL}[data-xhh-read="1"]`).length
      : 0;
    const hiddenBlocked = document.querySelectorAll(`${CARD_SEL}[data-xhh-blocked="1"]`).length;
    renderEmptyNote(total, hiddenRead, hiddenBlocked);
  }

  function dropEmptyNote() {
    if (emptyNote) {
      emptyNote.remove();
      emptyNote = null;
    }
  }

  /* 全量扫描：设置变更 / 首次进入时才用 */
  function scan() {
    if (!document.body) return;
    refreshRules();
    document.querySelectorAll(CARD_SEL).forEach(applyCard);
    updateEmptyNote();
    markDetailRead();
  }

  /* 增量扫描：只处理新出现的节点，翻页时每张卡 O(1) */
  function scanNodes(nodes) {
    if (!settings.on && !settings.dimRead) {
      updateEmptyNote();
      return;
    }
    const cards = new Set();
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(CARD_SEL)) cards.add(node);
      else {
        node.querySelectorAll?.(CARD_SEL).forEach((c) => cards.add(c));
        // 卡片内部的内容变化：重新评估它所属的那张卡
        const owner = node.closest?.(CARD_SEL);
        if (owner) cards.add(owner);
      }
    }
    if (!cards.size) {
      updateEmptyNote();
      return;
    }
    cards.forEach(applyCard);
    updateEmptyNote();
  }

  function markDetailRead() {
    const m = location.pathname.match(/\/app\/bbs\/link\/([^/?#]+)/);
    if (m) markRead(m[1]);
  }

  /* ------------------------------------------------------ 空时间线提示 */

  let emptyNote = null;

  function renderEmptyNote(total, hiddenRead, hiddenBlocked) {
    const list = document.querySelector('.bbs-home__content-list');
    const need =
      settings.on &&
      total > 0 &&
      hiddenRead + hiddenBlocked === total &&
      (hiddenRead > 0 || hiddenBlocked > 0);

    if (!need) {
      if (emptyNote) {
        emptyNote.remove();
        emptyNote = null;
      }
      return;
    }

    if (!emptyNote || !emptyNote.isConnected) {
      emptyNote = document.createElement('div');
      emptyNote.className = 'xhh-empty-note';
      const msg = document.createElement('span');
      const peek = document.createElement('button');
      peek.type = 'button';
      peek.className = 'peek';
      peek.textContent = document.documentElement.classList.contains('xhh-peek')
        ? '收起来'
        : '暂时显示看过的';
      peek.addEventListener('click', () => {
        const on = document.documentElement.classList.toggle('xhh-peek');
        peek.textContent = on ? '收起来' : '暂时显示看过的';
      });
      emptyNote.append(msg, peek);
      list.appendChild(emptyNote);
    }

    emptyNote.querySelector('span').textContent =
      `时间线空了：${[
        hiddenRead ? `${hiddenRead} 条看过的` : '',
        hiddenBlocked ? `${hiddenBlocked} 条屏蔽的` : '',
      ]
        .filter(Boolean)
        .join('、')}都被收起来了。`;
  }

  /* ------------------------------------------------------------ 推广层兜底 */

  function looksLikeAppNag(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('#xhh-hud-host, #xhh-help-host, #xhh-topbar-host')) return false;
    // 先看文字：不命中关键词就根本不碰样式计算（getComputedStyle 会强制布局）
    const t = (el.innerText || '').replace(/\s+/g, '');
    if (!t || t.length > 60 || !NAG_RE.test(t)) return false;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 640 || rect.height > 300 || rect.width < 80) return false;
    return true;
  }

  /* 浅层扫：只看 body 的两层子代。推广浮层是页面级元素，不会埋在卡片深处，
     全表 querySelectorAll('div') 是纯浪费 */
  function sweepNags() {
    const body = document.body;
    if (!body) return;
    const check = (el) => {
      if (el.classList.contains('xhh-kill')) return;
      if (looksLikeAppNag(el)) el.classList.add('xhh-kill');
    };
    for (const el of body.children) {
      check(el);
      if (!el.children.length) continue;
      for (const child of el.children) check(child);
    }
  }

  /* 新节点进来时：只检查它本身和它的直属子代，不深挖 */
  function checkNag(node) {
    if (looksLikeAppNag(node)) {
      node.classList.add('xhh-kill');
      return;
    }
    if (!node.firstElementChild) return;
    for (const child of node.children) {
      if (looksLikeAppNag(child)) child.classList.add('xhh-kill');
    }
  }

  /* ------------------------------------------------------------ 轻提示 */

  let hudPill = null;
  let hudTimer = 0;
  let hudHost = null;

  function ensureHud() {
    if (hudHost) return hudPill;
    hudHost = document.createElement('div');
    hudHost.id = 'xhh-hud-host';
    hudHost.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483646;pointer-events:none;';
    const shadow = hudHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .pill{
          display:inline-block;padding:8px 15px;border-radius:999px;
          background:rgba(18,20,24,.92);color:#fff;font:500 12.5px/1.2 -apple-system,
          "PingFang SC","Hiragino Sans GB",sans-serif;letter-spacing:.02em;
          box-shadow:0 6px 24px rgba(0,0,0,.28);backdrop-filter:blur(10px);
          opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;
          white-space:nowrap;
        }
        .pill.on{opacity:1;transform:translateY(0)}
      </style>
      <div class="pill" role="status"></div>`;
    hudPill = shadow.querySelector('.pill');
    (document.documentElement || document.body).appendChild(hudHost);
    return hudPill;
  }


  function toast(message) {
    if (!settings.hud) return;
    const pill = ensureHud();
    pill.textContent = message;
    pill.classList.add('on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => pill.classList.remove('on'), 1600);
  }

  /* ------------------------------------------------------------ 自定义顶栏 */

  let topbarHost = null;

  function ensureTopbar() {
    if (topbarHost) return;
    topbarHost = document.createElement('div');
    topbarHost.id = 'xhh-topbar-host';
    const shadow = topbarHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial}
        .bar{
          position:fixed;top:0;left:0;right:0;height:44px;z-index:2147483000;
          display:flex;align-items:center;gap:6px;padding:0 22px;
          background:var(--xhh-topbar-bg, rgba(255,255,255,.82));
          border-bottom:1px solid var(--xhh-topbar-line, rgba(16,24,40,.07));
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
          font:500 13px/1 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;
          color:var(--xhh-topbar-fg,#2b2f34);letter-spacing:.03em;
        }
        .brand{display:flex;align-items:center;gap:7px;user-select:none}
        .dot{width:8px;height:8px;border-radius:50%;background:var(--xhh-accent,#ff5f4d);
          box-shadow:0 0 0 3px rgba(255,95,77,.18)}
        .spacer{flex:1}
        button{
          border:0;background:transparent;color:inherit;cursor:pointer;
          width:30px;height:30px;border-radius:8px;
          display:flex;align-items:center;justify-content:center;transition:background .14s ease;
        }
        button:hover{background:rgba(128,128,128,.14)}
        button:active{background:rgba(128,128,128,.22)}
        button:focus-visible{outline:2px solid var(--xhh-accent,#ff5f4d);outline-offset:2px}
        svg{width:16px;height:16px;display:block}
        .hint{font-size:11px;opacity:.55;user-select:none;margin-right:8px}
      </style>
      <div class="bar" role="toolbar" aria-label="清净模式控制">
        <span class="brand"><span class="dot"></span>清净</span>
        <span class="spacer"></span>
        <button data-k="top" title="回到顶部" aria-label="回到顶部">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 12.5V3.8M3.9 7.6 8 3.5l4.1 4.1"/>
          </svg>
        </button>
        <button data-k="reload" title="刷新页面" aria-label="刷新页面">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75"/>
            <path d="M13.4 2.3v2.9h-2.9"/>
          </svg>
        </button>
        <button data-k="theme" title="夜间 / 日间" aria-label="切换夜间或日间主题">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.7 5.7 0 1 0 7 7Z"/>
          </svg>
        </button>
        <button data-k="focus" title="回原版 / 开启清净" aria-label="开启或关闭清净模式">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 1.8v6M4.4 3.9a5.2 5.2 0 1 0 7.2 0"/>
          </svg>
        </button>
      </div>`;
    shadow.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.k;
        if (k === 'theme') toggleThemeMode();
        if (k === 'focus') toggleFocusMode();
        if (k === 'top') scrollTop();
        if (k === 'reload') reloadPage();
      });
    });
    (document.documentElement || document.body).appendChild(topbarHost);
  }

  /* 瀑布流翻久了要重开一局：先回到顶部再刷新，回来就是第一屏 */
  let reloading = false;

  function reloadPage() {
    if (reloading) return;
    reloading = true;
    toast('刷新中…');
    try {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (_) {
      window.scrollTo(0, 0);
    }
    setTimeout(() => location.reload(), 60);
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------ 事件 */

  // block: true 只加不删（x 键）；省略 = 切换（Alt+点击）
  function toggleBlockUser(name, block) {
    const list = (settings.blockUsers || []).slice();
    const index = list.indexOf(name);

    if (block && index >= 0) {
      toast(`已屏蔽过 ${name}`);
      return true;
    }
    const blocked = index < 0;
    if (blocked) list.push(name);
    else list.splice(index, 1);

    settings = { ...settings, blockUsers: list };
    persist();
    scan();
    toast(blocked ? `已屏蔽 ${name}` : `已取消屏蔽 ${name}`);
    return blocked;
  }

  function authorOfScope(scope) {
    return text(
      scope.querySelector(
        '.list-content__username, .link-user__username, .page-header__username'
      )
    );
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;

      // Alt + 点作者 = 屏蔽 / 取消屏蔽
      const userBox = target.closest?.(
        '.header__user, .link-user__user-wrapper, .page-header__user-wrapper'
      );
      if (event.altKey && userBox) {
        const name = authorOfScope(userBox);
        if (name) {
          event.preventDefault();
          event.stopPropagation();
          toggleBlockUser(name);
        }
        return;
      }

      // 点过的帖子记为已读
      const card = target.closest?.('.bbs-home__content-item');
      if (card) {
        const id = postIdOf(card);
        if (id) {
          markRead(id);
          if (settings.dimRead) card.dataset.xhhRead = '1';
        }
      }
    },
    true
  );

  function toggleFocusMode() {
    settings = { ...settings, on: !settings.on };
    persist();
    apply();
    scan();
    toast(settings.on ? '清净模式 开' : '清净模式 关');
  }

  function toggleThemeMode() {
    const dark = effectiveTheme() === 'dark';
    settings = { ...settings, theme: dark ? 'light' : 'dark' };
    persist();
    apply();
    toast(dark ? '日间' : '夜间');
  }

  /* ------------------------------------------------------------ 启动 */

  /* 观察者回调只负责收集，真正的处理合并成一次 rAF：
     一帧内插进来 20 张卡也只跑一轮，主线程不再被翻页切碎 */
  let pendingNodes = [];
  let flushScheduled = false;

  function flushPending() {
    flushScheduled = false;
    const nodes = pendingNodes;
    pendingNodes = [];
    if (!nodes.length) return;
    scanNodes(nodes);
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(flushPending);
  }

  function init() {
    apply();
    scan();

    // 调试 / 测试钩子（无副作用）
    window.__xhhScan = scan;
    window.__xhhMark = markRead;

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          pendingNodes.push(node);
          if (settings.on && !node.classList?.contains('xhh-kill')) checkNag(node);
        }
      }
      if (pendingNodes.length) scheduleFlush();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 首屏兜底扫一遍悬浮推广
    setTimeout(() => settings.on && sweepNags(), 1200);
  }

  function start() {
    apply();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  const bootTopbar = setInterval(() => {
    if (!document.documentElement || !document.body) return;
    clearInterval(bootTopbar);
    ensureTopbar();
  }, 20);

  if (document.documentElement) {
    start();
  } else {
    const boot = setInterval(() => {
      if (!document.documentElement) return;
      clearInterval(boot);
      start();
    }, 5);
  }

  mq.addEventListener('change', () => {
    if (settings.theme === 'auto') apply();
  });

  try {
    chrome.storage.sync.get(KEY, (result) => {
      if (result && result[KEY]) {
        settings = mergeSettings(result[KEY]);
        apply();
        scan();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[KEY]) return;
      settings = mergeSettings(changes[KEY].newValue);
      apply();
      scan();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === 'xhh:settings' && message.settings) {
        // popup 改设置后直推过来，即时生效（storage 广播只作兜底）
        settings = mergeSettings(message.settings);
        apply();
        scan();
      }
      if (message.type === 'xhh:toggle-focus') {
        toggleFocusMode();
      }
      if (message.type === 'xhh:clear-read') {
        readCache = null;
        try {
          localStorage.removeItem(READ_KEY);
        } catch (_) {
          /* ignore */
        }
        document.documentElement.classList.remove('xhh-peek');
        scan();
        toast('已读记录清空');
      }
    });
  } catch (_) {
    /* 不在扩展环境里（比如本地打开 HTML 调试） */
  }
})();
