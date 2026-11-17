const strip = document.getElementById('ctrlTab-previews');
const previews = new Map();

function picture(container, source) {
  if (!source) return;
  const image = new Image();
  image.alt = '';
  image.src = source;
  container.replaceChildren(image);
}

function select(index) {
  const card = strip.children[index];
  card?.focus({ preventScroll: true });
  card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

ctrlTabPanel.onOpen(({ cards, selected, styles, light }) => {
  document.documentElement.classList.toggle('light', light);
  applyModStyles(styles);
  previews.clear();
  strip.replaceChildren(...cards.map((card) => {
    const button = document.createElement('button');
    button.className = 'ctrlTab-preview';
    button.innerHTML = '<span class="ctrlTab-preview-inner"><span class="ctrlTab-canvas"><span class="fallback"></span></span><span class="ctrlTab-caption"><span class="ctrlTab-favicon-container"></span><span class="ctrlTab-label"></span></span></span>';
    const canvas = button.querySelector('.ctrlTab-canvas');
    button.querySelector('.fallback').textContent = (card.title || '?')[0].toUpperCase();
    button.querySelector('.ctrlTab-label').textContent = card.title;
    button.title = card.title;
    const icon = button.querySelector('.ctrlTab-favicon-container');
    if (card.url || card.favicon) icon.append(loadFavicon(new Image(), card.url, card.favicon, () => icon.replaceChildren()));
    picture(canvas, card.preview);
    previews.set(card.id, canvas);
    button.addEventListener('click', () => ctrlTabPanel.choose(card.id));
    return button;
  }));
  select(selected);
});
ctrlTabPanel.onSelection(select);
ctrlTabPanel.onPreview((id, source) => { if (previews.has(id)) picture(previews.get(id), source); });
document.addEventListener('keyup', (event) => {
  if ((event.key === 'Control' || event.key === 'Meta') && document.activeElement?.matches('.ctrlTab-preview')) {
    document.activeElement.click();
  }
});
document.body.addEventListener('mousedown', (event) => {
  if (!event.target.closest('#ctrlTab-panel')) ctrlTabPanel.choose(null);
});
