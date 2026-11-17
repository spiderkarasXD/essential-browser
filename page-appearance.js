const TRANSPARENT_ATTRIBUTE = 'data-essential-transparent-page';
const rootSelector = `:root[${TRANSPARENT_ATTRIBUTE}]`;
const PAGE_BACKGROUND = `${rootSelector}, ${rootSelector} body { background-color: transparent !important; background-image: none !important; }`;

function attach(view, enabled) {
  const wc = view.webContents;
  let generation = 0;
  let injected = false;
  let queue = Promise.resolve();
  const refresh = () => {
    if (wc.isDestroyed()) return;
    const current = generation;
    const transparent = () => enabled() && /^https?:\/\//i.test(wc.getURL());
    view.setBackgroundColor(transparent() ? '#00000000' : '#ffffff');
    queue = queue.then(async () => {
      if (wc.isDestroyed() || current !== generation) return;
      if (transparent() && !injected) {
        await wc.insertCSS(PAGE_BACKGROUND, { cssOrigin: 'user' });
        if (current !== generation) return;
        injected = true;
      }
      if (!injected) return;
      // Electron 45 cannot remove user-origin sheets. Scope the sheet to this marker.
      await wc.executeJavaScriptInIsolatedWorld(991, [{
        code: `document.documentElement?.toggleAttribute('${TRANSPARENT_ATTRIBUTE}', ${transparent()})`,
      }]);
    }).catch(() => {});
  };
  wc.on('dom-ready', () => {
    generation++;
    injected = false;
    refresh();
  });
  refresh();
  return refresh;
}

module.exports = { attach };
