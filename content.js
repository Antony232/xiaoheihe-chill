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

  function scan() {
    if (!document.body) return;

    const words = (settings.blockWords || []).map((w) => String(w).trim()).filter(Boolean);
    const users = (settings.blockUsers || []).map((u) => String(u).trim()).filter(Boolean);
    const read = settings.dimRead || settings.hideRead ? readMap() : {};

    let hiddenRead = 0;
    let hiddenBlocked = 0;
    let total = 0;

    document.querySelectorAll('.bbs-home__content-item').forEach((card) => {
      total += 1;
      const id = postIdOf(card);
      if (id && read[id]) card.dataset.xhhRead = '1';
      else delete card.dataset.xhhRead;

      if (!settings.on) {
        delete card.dataset.xhhBlocked;
        return;
      }

      const title = text(card.querySelector('.bbs-content__title'));
      const body = text(card.querySelector('.bbs-content__content'));
      const author = text(card.querySelector('.list-content__username'));

      const hay = `${title}\n${body}`.toLowerCase();
      const blocked =
        users.includes(author) || words.some((w) => hay.includes(w.toLowerCase()));

      if (blocked) {
        card.dataset.xhhBlocked = '1';
        hiddenBlocked += 1;
      } else {
        delete card.dataset.xhhBlocked;
        if (settings.hideRead && id && read[id]) hiddenRead += 1;
      }
    });

    renderEmptyNote(total, hiddenRead, hiddenBlocked);

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
    if (el.closest('#xhh-hud-host, #xhh-help-host')) return false;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 640 || rect.height > 300 || rect.width < 80) return false;
    const t = (el.innerText || '').replace(/\s+/g, '');
    if (!t || t.length > 60) return false;
    if (!/下载|打开APP|打开App|扫码/.test(t)) return false;
    return true;
  }

  function sweepNags(scope) {
    const nodes = scope ? scope.querySelectorAll('*') : document.querySelectorAll('div');
    nodes.forEach((el) => {
      if (looksLikeAppNag(el)) el.classList.add('xhh-kill');
    });
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
          width:30px;height:30px;border-radius:8px;font-size:14px;line-height:1;
          display:flex;align-items:center;justify-content:center;transition:background .14s ease;
        }
        button:hover{background:rgba(128,128,128,.14)}
        button:focus-visible{outline:2px solid var(--xhh-accent,#ff5f4d);outline-offset:2px}
        .hint{font-size:11px;opacity:.55;user-select:none;margin-right:8px}
      </style>
      <div class="bar" role="toolbar" aria-label="清净模式控制">
        <span class="brand"><span class="dot"></span>清净</span>
        <span class="spacer"></span>
        <button data-k="theme" title="夜间 / 日间" aria-label="切换夜间或日间主题">🌙</button>
        <button data-k="focus" title="回原版 / 开启清净" aria-label="开启或关闭清净模式">⏻</button>
      </div>`;
    shadow.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.k === 'theme') toggleThemeMode();
        if (btn.dataset.k === 'focus') toggleFocusMode();
      });
    });
    (document.documentElement || document.body).appendChild(topbarHost);
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

  let scanPending = false;
  function scheduleScan() {
    if (scanPending) return;
    scanPending = true;
    setTimeout(() => {
      scanPending = false;
      scan();
    }, 120);
  }

  function init() {
    apply();
    scan();

    // 调试 / 测试钩子（无副作用）
    window.__xhhScan = scan;
    window.__xhhMark = markRead;

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.classList?.contains('bbs-home__content-item')) {
              const id = postIdOf(node);
              if (id && readMap()[id]) node.dataset.xhhRead = '1';
            }
            if (settings.on) {
              if (looksLikeAppNag(node)) node.classList.add('xhh-kill');
              else if (node.querySelector) sweepNags(node);
            }
          }
        });
      }
      scheduleScan();
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
