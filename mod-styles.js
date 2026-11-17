const modStyles = document.createElement('template');
const zenMarkers = document.createElement('div');
zenMarkers.hidden = true;
document.head.append(modStyles);
document.body.append(zenMarkers);

function applyModStyles(styles) {
  for (const old of document.head.querySelectorAll('style[data-essential-mod]')) old.remove();
  zenMarkers.replaceChildren();
  for (const sheet of styles) {
    const style = document.createElement('style');
    style.dataset.essentialMod = '';
    style.textContent = typeof sheet === 'string' ? sheet : sheet.css;
    modStyles.before(style);
    if (typeof sheet === 'string') continue;
    const marker = document.createElement('span');
    marker.id = sheet.marker;
    for (const [name, value] of Object.entries(sheet.attributes)) marker.setAttribute(name, String(value));
    zenMarkers.append(marker);
    const index = style.sheet.insertRule(':root {}', style.sheet.cssRules.length);
    for (const [name, value] of Object.entries(sheet.variables)) style.sheet.cssRules[index].style.setProperty('--' + name, value);
  }
}
