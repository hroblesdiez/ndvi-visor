// ══════════════════════════════════════════════════════════
//  ui.js — Toast, Loader, Status bar, Progress bar
// ══════════════════════════════════════════════════════════

export function setStatus(txt, state) {
  document.getElementById('stxt').textContent = txt;
  const d = document.getElementById('sdot');
  d.className = state === 'busy' ? 'busy' : state === 'error' ? 'error' : '';
}

export function showLoader(txt = 'LOADING…') {
  document.getElementById('ltxt').textContent = txt;
  document.getElementById('loader').classList.add('on');
}

export function hideLoader() {
  document.getElementById('loader').classList.remove('on');
}

export function setProgress(pct) {
  document.getElementById('progress-bar').style.width = pct + '%';
}

let _toastTimer;
export function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

export function updateNDVIStats({ min, mean, max, vegPct }) {
  document.getElementById('s-min').textContent  = min.toFixed(3);
  document.getElementById('s-mean').textContent = mean.toFixed(3);
  document.getElementById('s-max').textContent  = max.toFixed(3);
  document.getElementById('s-veg').textContent  = vegPct.toFixed(1) + '%';
}
