// Общий для интерфейса и настроек расчёт фона темы (градиент как в Zen + зерно)
const GRAIN_URL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function themeBackground(t) {
  const [c1, c2, c3, c4] = t.colors;
  const s = t.strength;
  const light = t.mode === 'light';
  const baseA = light ? '#f4f3f8' : '#121218';
  const baseB = light ? '#e8e7ee' : '#0d0d12';
  const layers = [
    `radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, ${c1} ${s}%, transparent), transparent 70%)`,
    `radial-gradient(100% 90% at 100% 100%, color-mix(in srgb, ${c2 || c1} ${c2 ? s : Math.round(s * 0.55)}%, transparent), transparent 70%)`,
  ];
  if (c3) layers.push(`radial-gradient(80% 70% at 100% 0%, color-mix(in srgb, ${c3} ${Math.round(s * 0.9)}%, transparent), transparent 70%)`);
  if (c4) layers.push(`radial-gradient(80% 70% at 0% 100%, color-mix(in srgb, ${c4} ${Math.round(s * 0.9)}%, transparent), transparent 70%)`);
  layers.push(`linear-gradient(160deg, color-mix(in srgb, ${c1} ${light ? 12 : 18}%, ${baseA}), ${baseB})`);
  return layers.join(', ');
}

function applyGrain(el, t) {
  el.style.backgroundImage = GRAIN_URL;
  el.style.opacity = String((t.grain / 100) * 0.55);
  el.style.mixBlendMode = 'overlay';
}
