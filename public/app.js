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
