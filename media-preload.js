// Подставляет выбранные в настройках микрофон и камеру в getUserMedia сайтов.
// Chromium сам системного «устройства по умолчанию для браузера» не знает, а deviceId у каждого сайта свой,
// поэтому ищем устройство по названию. Названия сайт видит только после первого разрешения доступа.
const { ipcRenderer, webFrame } = require('electron');

function patch(prefs) {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  const pick = async (kind, label, c) => {
    if (!label || !c) return c;
    if (typeof c === 'object' && c.deviceId) return c; // сайт сам выбрал устройство
    const dev = (await md.enumerateDevices()).find((d) => d.kind === kind && d.label === label);
    if (!dev) return c;
    return { ...(typeof c === 'object' ? c : {}), deviceId: { ideal: dev.deviceId } };
  };
  md.getUserMedia = async (constraints = {}) => {
    const c = { ...constraints };
    c.audio = await pick('audioinput', prefs.mic, c.audio);
    c.video = await pick('videoinput', prefs.cam, c.video);
    return original(c);
  };
}

if (/^https?:$/.test(location.protocol)) {
  const prefs = ipcRenderer.sendSync('media:prefs');
  if (prefs.mic || prefs.cam) webFrame.executeJavaScript(`(${patch})(${JSON.stringify(prefs)})`);
}
