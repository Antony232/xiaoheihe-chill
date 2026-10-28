// 徽标状态：开着显示「净」，关了清空。只做这一件事。
const KEY = 'xhh.settings.v1';

function paint(settings) {
  const on = !settings || settings.on !== false;
  chrome.action.setBadgeText({ text: on ? '净' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff5f4d' });
}

chrome.storage.sync.get(KEY, (result) => paint(result && result[KEY]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[KEY]) paint(changes[KEY].newValue);
});
