const q = document.getElementById('q');
const count = document.getElementById('count');

const search = (opts = {}) => finder.query({ text: q.value, ...opts });
const close = () => {
  document.body.classList.remove('open');
  finder.close();
};

finder.onOpen(({ text, color }) => {
  if (color) document.documentElement.style.setProperty('--ws', color);
  if (text && !q.value) q.value = text;
  document.body.classList.add('open');
  q.focus();
  q.select();
  if (q.value) search();
});

finder.onResult(({ active, total }) => {
  count.textContent = q.value ? `${active}/${total}` : '';
  count.classList.toggle('none', !!q.value && !total);
});

q.addEventListener('input', () => search());
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search({ next: true, forward: !e.shiftKey });
  else if (e.key === 'Escape') close();
  else if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyG')) {
    e.preventDefault();
    search({ next: true, forward: !e.shiftKey });
  }
});
document.getElementById('next').onclick = () => search({ next: true, forward: true });
document.getElementById('prev').onclick = () => search({ next: true, forward: false });
document.getElementById('close').onclick = close;
