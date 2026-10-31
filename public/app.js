'use strict';
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.copy);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1500);
  });
});

// Research progress: poll the status API and update the bar; swap in the finished page without a full reload.
const progressBox = document.querySelector('[data-research-progress]');
if (progressBox) {
  const bar = progressBox.querySelector('progress');
  const label = progressBox.querySelector('[data-step]');
  const showResults = async () => {
    try {
      const r = await fetch(window.location.href, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const next = doc.querySelector('main');
      if (!next) throw new Error('no main');
      document.querySelector('main').replaceWith(next);
    } catch {
      window.location.reload();
    }
  };
  const tick = async () => {
    try {
      const r = await fetch(progressBox.dataset.researchProgress, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (r.ok) {
        const p = await r.json();
        if (p.state !== 'running') return showResults();
        if (p.total) { bar.max = p.total; bar.value = p.done; }
        if (p.step) label.textContent = `${p.step}…`;
      }
    } catch { /* retry on the next tick */ }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1000);
}
