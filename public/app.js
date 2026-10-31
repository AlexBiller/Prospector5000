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

// Live sections: research progress and running Devin builds update in place; the finished page is swapped in without a full reload.
async function swapMain() {
  try {
    const r = await fetch(window.location.href, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    const next = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('main');
    if (!next) throw new Error('no main');
    document.querySelector('main').replaceWith(next);
    initLive();
  } catch {
    window.location.reload();
  }
}

async function getJson(url) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  return r.ok ? r.json() : null;
}

function fmtElapsed(fromIso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}h ${String(m).padStart(2, '0')}m ${sec}s` : `${m}m ${sec}s`;
}

let liveTimers = [];
function initLive() {
  liveTimers.forEach(clearTimeout);
  liveTimers = [];
  const later = (fn, ms) => liveTimers.push(setTimeout(fn, ms));

  const progressBox = document.querySelector('[data-research-progress]');
  if (progressBox) {
    const bar = progressBox.querySelector('progress');
    const label = progressBox.querySelector('[data-step]');
    const tick = async () => {
      try {
        const p = await getJson(progressBox.dataset.researchProgress);
        if (p && p.state !== 'running') return swapMain();
        if (p && p.total) { bar.max = p.total; bar.value = p.done; }
        if (p && p.step) label.textContent = `${p.step}…`;
      } catch { /* retry on the next tick */ }
      later(tick, 1500);
    };
    later(tick, 1000);
  }

  const build = document.querySelector('[data-build-live]');
  if (build) {
    const elapsed = () => {
      document.querySelectorAll('[data-elapsed-since]').forEach((el) => { el.textContent = fmtElapsed(el.dataset.elapsedSince); });
      later(elapsed, 1000);
    };
    elapsed();
    const poll = async () => {
      try {
        const b = await getJson(build.dataset.buildLive);
        if (b && b.status !== 'building') return swapMain();
        if (b) {
          const set = (sel, v) => { const el = build.querySelector(sel); if (el && v) el.textContent = v; };
          set('[data-build-status]', b.devin_status && `${b.devin_status}${b.devin_status_detail ? ` (${b.devin_status_detail})` : ''}`);
          set('[data-build-step]', b.step);
          if (b.acus_consumed != null) set('[data-build-acus]', Number(b.acus_consumed).toFixed(2));
          const since = build.querySelector('[data-elapsed-since]');
          if (since && b.started_at) since.dataset.elapsedSince = b.started_at;
        }
      } catch { /* retry on the next poll */ }
      later(poll, 10000);
    };
    poll();
  }
}
initLive();
