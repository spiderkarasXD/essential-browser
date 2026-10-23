// В настоящем Chrome у страниц есть window.chrome с app, loadTimes() и csi(), а в Electron его нет.
// Вход в аккаунт Google проверяет chrome.app и без него пишет «Возможно, этот браузер небезопасен»,
// поэтому до скриптов страницы добавляем эти объекты в том же виде, что и в Chrome.
const { contextBridge } = require('electron');

function installChrome() {
  if (window.chrome && window.chrome.app) return;
  // функции должны выглядеть встроенными: toString() у Proxy даёт «[native code]»
  const native = (fn) => new Proxy(fn, {});
  const perf = performance;
  const nav = () => perf.getEntriesByType('navigation')[0] || {};
  const paint = () => perf.getEntriesByType('paint').find((p) => p.name === 'first-paint');
  const sec = (ms) => (perf.timeOrigin + ms) / 1000;

  const app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: native(function getDetails() { return null; }),
    getIsInstalled: native(function getIsInstalled() { return false; }),
    installState: native(function installState(cb) { if (typeof cb === 'function') setTimeout(() => cb('not_installed')); }),
    runningState: native(function runningState() { return 'cannot_run'; }),
  };

  const loadTimes = native(function loadTimes() {
    const n = nav();
    const proto = n.nextHopProtocol || 'http/1.1';
    return {
      requestTime: sec(n.startTime || 0),
      startLoadTime: sec(n.startTime || 0),
      commitLoadTime: sec(n.responseStart || 0),
      finishDocumentLoadTime: n.domContentLoadedEventEnd ? sec(n.domContentLoadedEventEnd) : 0,
      finishLoadTime: n.loadEventEnd ? sec(n.loadEventEnd) : 0,
      firstPaintTime: paint() ? sec(paint().startTime) : 0,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: ['h2', 'h3'].includes(proto),
      wasNpnNegotiated: ['h2', 'h3'].includes(proto),
      npnNegotiatedProtocol: ['h2', 'h3'].includes(proto) ? proto : 'unknown',
      wasAlternateProtocolAvailable: false,
      connectionInfo: proto,
    };
  });

  const csi = native(function csi() {
    const n = nav();
    return {
      onloadT: Math.round(perf.timeOrigin + (n.domContentLoadedEventEnd || 0)),
      startE: Math.round(perf.timeOrigin),
      pageT: perf.now(),
      tran: 15,
    };
  });

  const chrome = window.chrome || {};
  for (const [key, value] of [['loadTimes', loadTimes], ['csi', csi], ['app', app]]) {
    if (!(key in chrome)) Object.defineProperty(chrome, key, { value, writable: true, enumerable: true, configurable: true });
  }
  if (!window.chrome) Object.defineProperty(window, 'chrome', { value: chrome, writable: true, enumerable: true, configurable: false });
}

if (/^https?:$/.test(location.protocol)) {
  try { contextBridge.executeInMainWorld({ func: installChrome }); } catch {}
}
