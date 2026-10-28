/* 共享常量：content script 与 popup 都用这一份，避免两边默认值漂移 */
(function (g) {
  const KEY = 'xhh.settings.v1';

  const DEFAULTS = {
    on: true,

    // 布局
    hideNav: true,
    hideSearch: true,
    hideTopics: true,
    hideSidebar: true,
    hideActions: true,
    hideReply: true,

    // 阅读
    width: 0, // 0 = 自适应 min(100vw-48px, 960px)
    fontSize: 18,
    lineHeight: 1.9,
    theme: 'auto', // auto | light | dark | sepia
    imgMax: 70, // vh，0 = 不限

    // 屏蔽与标记
    dimRead: true,
    hideRead: false,
    blockWords: [],
    blockUsers: [],

    // 交互
    hud: true
  };

  if (g) {
    g.XHH_KEY = KEY;
    g.XHH_DEFAULTS = DEFAULTS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
