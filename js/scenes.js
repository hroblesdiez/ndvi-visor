// ══════════════════════════════════════════════════════════
//  scenes.js — Scene list rendering and selection
// ══════════════════════════════════════════════════════════

import { toast } from './ui.js';
import { highlightSceneBBox, showPreviewImage } from './map.js';
import { signUrl } from './stac.js';

// ── RENDER LIST ───────────────────────────────────────────
export function renderScenes(scenes, onSelect) {
  const wrap = document.getElementById('scenes-wrap');
  document.getElementById('scount').textContent = `(${scenes.length})`;

  if (!scenes.length) {
    wrap.innerHTML = `
      <div class="empty-msg">
        <div class="ico">🌫</div>
        No scenes found.<br/>Try a wider date range or higher cloud limit.
      </div>`;
    return;
  }

  wrap.innerHTML = '';

  scenes.forEach((feature, i) => {
    const p      = feature.properties;
    const date   = (p.datetime || '').split('T')[0];
    const cloud  = +(p['eo:cloud_cover'] || 0).toFixed(1);
    const platf  = (p.platform || '').toUpperCase();
    const shortId = feature.id.length > 36
      ? feature.id.slice(0, 36) + '…'
      : feature.id;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.idx = i;
    card.innerHTML = `
      <div class="cid" title="${feature.id}">${shortId}</div>
      <div class="cmeta">
        <span>📅 ${date}</span>
        <span class="ccloud ${cloud < 15 ? 'ok' : ''}">☁ ${cloud}%</span>
      </div>
      <div class="cmeta" style="margin-top:3px">
        <span>${platf}</span>
      </div>`;

    card.addEventListener('click', () => {
      document.querySelectorAll('.card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      onSelect(feature);
    });

    wrap.appendChild(card);
  });
}

// ── HANDLE SELECTION ──────────────────────────────────────
export async function handleSceneSelect(feature) {
  // Debug info
  console.info('[Scene] ID:', feature.id);
  console.info('[Scene] Platform:', feature.properties.platform);
  console.info('[Scene] Asset keys:', Object.keys(feature.assets));

  // Draw scene footprint on map
  highlightSceneBBox(feature.bbox);

  // Try to show signed preview tile
  const prevAsset = feature.assets?.rendered_preview;
  if (prevAsset) {
    try {
      const signedUrl = await signUrl(prevAsset.href);
      showPreviewImage(signedUrl, feature.bbox);
    } catch (_) { /* preview is optional */ }
  }

  toast(`Selected: ${feature.id.slice(0, 22)}…`, 'info');
}
