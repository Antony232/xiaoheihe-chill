(() => {
  'use strict';

  const KEY = globalThis.XHH_KEY || 'xhh.settings.v1';
  const DEFAULTS = globalThis.XHH_DEFAULTS || {};
  const NUMERIC = new Set(['fontSize', 'width', 'imgMax']);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

  let settings = { ...DEFAULTS };

  function save(patch) {
    settings = { ...settings, ...patch };
    try {
      chrome.storage.sync.set({ [KEY]: settings });
    } catch (_) {
      /* 扩展重载中 */
    }
    // 直推当前标签页，不等 storage 广播，点了立即见效
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab || !tab.id) return;
        const p = chrome.tabs.sendMessage(tab.id, { type: 'xhh:settings', settings });
        if (p && p.catch) p.catch(() => {});
      });
    } catch (_) {
      /* 不在扩展环境 */
    }
    render();
  }

  function render() {
    document.documentElement.classList.toggle('off', !settings.on);
    $('#master').setAttribute('aria-checked', String(!!settings.on));
    $('#stateText').textContent = settings.on ? '只留帖子，其他都走开' : '已关闭，回到原版';

    $$('input[type="checkbox"][data-key]').forEach((input) => {
      input.checked = !!settings[input.dataset.key];
    });

    $$('.seg').forEach((seg) => {
      const key = seg.dataset.seg;
      $$('button', seg).forEach((btn) => {
        btn.classList.toggle('on', String(settings[key]) === btn.dataset.value);
      });
    });

    const words = $('#words');
    if (document.activeElement !== words) {
      words.value = (settings.blockWords || []).join('\n');
    }

    const users = $('#users');
    users.innerHTML = '';
    (settings.blockUsers || []).forEach((name) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = '取消屏蔽';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        save({ blockUsers: (settings.blockUsers || []).filter((n) => n !== name) });
      });
      chip.appendChild(remove);
      users.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------ 事件绑定 */

  $('#master').addEventListener('click', () => {
    save({ on: !settings.on });
  });

  $$('input[type="checkbox"][data-key]').forEach((input) => {
    input.addEventListener('change', () => {
      save({ [input.dataset.key]: input.checked });
    });
  });

  $$('.seg').forEach((seg) => {
    const key = seg.dataset.seg;
    $$('button', seg).forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.value;
        const patch = { [key]: NUMERIC.has(key) ? Number(raw) : raw };
        if (key === 'width') patch.__wChosen = true; // 用户主动选过宽度，迁移不再覆盖
        save(patch);
      });
    });
  });

  let wordTimer = 0;
  $('#words').addEventListener('input', (event) => {
    const list = event.target.value
      .split(/[,，\n]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    clearTimeout(wordTimer);
    wordTimer = setTimeout(() => {
      settings = { ...settings, blockWords: list };
      chrome.storage.sync.set({ [KEY]: settings });
    }, 260);
  });

  $('#reload').addEventListener('click', async () => {
    const btn = $('#reload');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && /xiaoheihe\.cn/.test(tab.url || '')) {
        await chrome.tabs.reload(tab.id, { bypassCache: false });
        btn.textContent = '已刷新';
      } else {
        btn.textContent = '先打开小黑盒';
      }
    } catch (_) {
      btn.textContent = '刷新失败';
    }
    setTimeout(() => (btn.textContent = '刷新页面'), 1400);
    // 刷新后弹窗使命已尽，主动关掉，别挡着页面
    setTimeout(() => window.close(), 600);
  });

  $('#clearRead').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'xhh:clear-read' });
        $('#clearRead').textContent = '已清除';
        setTimeout(() => ($('#clearRead').textContent = '清除已读'), 1400);
        return;
      }
    } catch (_) {
      /* 当前页不是小黑盒 */
    }
    $('#clearRead').textContent = '先打开小黑盒';
    setTimeout(() => ($('#clearRead').textContent = '清除已读'), 1400);
  });

  $('#reset').addEventListener('click', () => {
    settings = { ...DEFAULTS };
    chrome.storage.sync.set({ [KEY]: settings });
    render();
  });

  try {
    chrome.storage.sync.get(KEY, (result) => {
      if (result && result[KEY]) settings = { ...DEFAULTS, ...result[KEY] };
      render();
    });
  } catch (_) {
    /* 不在扩展环境（本地调试），直接用默认值渲染 */
    render();
  }
})();
