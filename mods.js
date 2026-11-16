const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const zenMods = require('./zen-mods');

const options = {
  side: { label: 'Боковая панель', value: 'left', choices: { left: 'Слева', right: 'Справа' } },
  width: { label: 'Ширина панели', value: 264, min: 180, max: 360, step: 4 },
  gap: { label: 'Поля страницы', value: 8, min: 4, max: 24, step: 1 },
  radius: { label: 'Скругление страницы', value: 10, min: 0, max: 24, step: 1 },
  dense: { label: 'Плотные вкладки', value: false },
  accent: { label: 'Цветная отметка активной вкладки', value: false },
  monochrome: { label: 'Монохромные значки сайтов', value: false },
  still: { label: 'Убрать анимации вкладок и панелей', value: false },
};
const limit = 128 * 1024;
const maxMods = 24;

function normalize(raw) {
  const layout = Object.fromEntries(Object.entries(options).map(([key, spec]) => {
    const value = raw?.layout?.[key];
    if (spec.choices) return [key, Object.hasOwn(spec.choices, value) ? value : spec.value];
    if (typeof spec.value === 'boolean') return [key, typeof value === 'boolean' ? value : spec.value];
    return [key, Number.isFinite(value) ? Math.max(spec.min, Math.min(spec.max, Math.round(value))) : spec.value];
  }));
  const items = Array.isArray(raw?.items) ? raw.items.filter((item) =>
    item && typeof item.id === 'string' && /^[0-9a-f-]{36}$/.test(item.id) &&
    typeof item.name === 'string' && typeof item.css === 'string' && item.css.length <= limit
  ).slice(0, maxMods) : [];
  return { layout, items: items.map(({ id, name, css, enabled, zen }) => ({
    id, name: name.trim().slice(0, 80) || 'CSS-мод', css, enabled: enabled === true, zen: zenMods.normalize(zen),
  })) };
}

function save(mods, input) {
  if (typeof input?.name !== 'string' || !input.name.trim() || typeof input.css !== 'string' || !input.css.trim()) {
    throw new Error('Укажите название и добавьте CSS.');
  }
  if (input.css.length > limit) throw new Error('Размер CSS превышает 128 КБ.');
  const index = mods.items.findIndex((item) => item.id === input.id);
  if (input.id && index < 0) throw new Error('Мод уже удалён.');
  if (index < 0 && mods.items.length >= maxMods) throw new Error('Достигнут лимит в 24 CSS-мода.');
  const item = { id: input.id || randomUUID(), name: input.name.trim().slice(0, 80), css: input.css, enabled: true };
  const items = [...mods.items];
  if (index < 0) items.push(item);
  else {
    const previous = items[index];
    const zen = previous.zen && {
      ...previous.zen,
      values: zenMods.values(previous.zen.fields, input.zen?.values ?? previous.zen.values),
    };
    items[index] = { ...item, enabled: previous.enabled, zen };
  }
  return { ...mods, items };
}

function installZen(mods, downloaded) {
  const previous = mods.items.find((item) => item.zen?.id === downloaded.zen.id);
  const next = save(mods, { ...downloaded, id: previous?.id });
  const item = previous ? next.items.find((entry) => entry.id === previous.id) : next.items.at(-1);
  item.zen = { ...downloaded.zen, values: zenMods.values(downloaded.zen.fields, previous?.zen.values) };
  return next;
}

async function readFile(file) {
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(bytes, { offset: 0, length: bytes.length });
    if (bytesRead > limit) throw new Error('Размер файла превышает 128 КБ.');
    return { name: path.basename(file, path.extname(file)), css: bytes.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '') };
  } finally {
    await handle.close();
  }
}

module.exports = { options, normalize, save, installZen, readFile };
