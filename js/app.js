// ══════════════════════════════════════════════════════════
//  app.js — Main entry point, wires all modules together
// ══════════════════════════════════════════════════════════

import { initMap, startDraw, clearMapLayers, setNDVIOverlay } from './map.js';
import { searchScenes, signUrl, resolveBandKeys }             from './stac.js';
import { readCOGWindow, computeNDVIArray, renderNDVIToCanvas, applyColormap } from './ndvi.js';
import { renderScenes, handleSceneSelect }                     from './scenes.js';
import {
  setStatus, showLoader, hideLoader, setProgress, toast, updateNDVIStats,
} from './ui.js';

// ── APP STATE ─────────────────────────────────────────────
let bbox     = null;   // [west, south, east, north]
let scenes   = [];
let selected = null;   // currently selected STAC feature

// ── INIT ──────────────────────────────────────────────────
function init() {
  initMap(onBBoxDrawn);
  setDefaultDates();

  // Expose button handlers to HTML onclick attributes
  window.onClickDraw    = () => startDraw();
  window.onClickClear   = () => clearAll();
  window.onClickSearch  = () => doSearch();
  window.onClickNDVI    = () => doNDVI();
  window.onCloseNDVI    = () => closeNDVI();
}

// ── DEFAULT DATES ─────────────────────────────────────────
function setDefaultDates() {
  const now  = new Date();
  const prev = new Date(now);
  prev.setFullYear(prev.getFullYear() - 1);
  document.getElementById('d1').value = now.toISOString().slice(0, 10);
  document.getElementById('d0').value = prev.toISOString().slice(0, 10);
}

// ── AOI DRAWN ─────────────────────────────────────────────
function onBBoxDrawn(newBBox) {
  bbox = newBBox;
  const [w, s, e, n] = bbox;
  const el = document.getElementById('bbox-box');
  el.classList.remove('empty');
  el.textContent = `W: ${w}°  E: ${e}°\nS: ${s}°  N: ${n}°`;
  document.getElementById('btn-search').disabled = false;
  document.getElementById('hint').classList.add('gone');
}

// ── CLEAR ALL ─────────────────────────────────────────────
function clearAll() {
  bbox = null; scenes = []; selected = null;
  clearMapLayers();

  document.getElementById('bbox-box').textContent = 'Draw a rectangle on the map\nto define your AOI';
  document.getElementById('bbox-box').classList.add('empty');
  document.getElementById('btn-search').disabled = true;
  document.getElementById('btn-ndvi').disabled   = true;
  document.getElementById('scount').textContent  = '';
  document.getElementById('scenes-wrap').innerHTML =
    `<div class="empty-msg"><div class="ico">🛰</div>No scenes loaded.<br/>Define AOI and search.</div>`;
  document.getElementById('hint').classList.remove('gone');
  document.getElementById('ndvi-legend').style.display = 'none';

  setStatus('READY', 'ok');
}

// ── SEARCH ────────────────────────────────────────────────
async function doSearch() {
  if (!bbox) return;

  setStatus('SEARCHING…', 'busy');
  showLoader('QUERYING PLANETARY COMPUTER STAC…');

  try {
    scenes = await searchScenes({
      bbox,
      dateStart:   document.getElementById('d0').value,
      dateEnd:     document.getElementById('d1').value,
      cloudCover:  +document.getElementById('cloud').value,
    });

    renderScenes(scenes, onSceneSelected);
    setStatus(`${scenes.length} SCENES FOUND`, 'ok');
    toast(`Found ${scenes.length} scenes`, scenes.length > 0 ? 'success' : 'info');
  } catch (e) {
    setStatus('ERROR', 'error');
    toast(e.message, 'error');
    console.error(e);
  } finally {
    hideLoader();
  }
}

// ── SCENE SELECTED ────────────────────────────────────────
async function onSceneSelected(feature) {
  selected = feature;
  document.getElementById('btn-ndvi').disabled = false;
  await handleSceneSelect(feature);
}

// ── COMPUTE NDVI ──────────────────────────────────────────
async function doNDVI() {
  if (!selected || !bbox) return;

  setStatus('LOADING BANDS…', 'busy');
  showLoader('SIGNING ASSET URLS…');
  setProgress(0);

  try {
    const assets = selected.assets;
    const { redKey, nirKey } = resolveBandKeys(assets);

    if (!redKey || !nirKey) {
      throw new Error(
        `Could not find Red/NIR assets.\nAvailable: ${Object.keys(assets).join(', ')}`
      );
    }

    // Sign band URLs sequentially — parallel requests trigger 429 rate limit
    showLoader('SIGNING RED BAND URL…');
    const redUrl = await signUrl(assets[redKey].href);

    showLoader('SIGNING NIR BAND URL…');
    const nirUrl = await signUrl(assets[nirKey].href);

    console.info('[NDVI] Signed URLs ready — downloading COG windows…');

    // Download COG windows
    setProgress(15);
    showLoader('DOWNLOADING RED BAND (COG)…');
    const redData = await readCOGWindow(redUrl, bbox);
    if (!redData) throw new Error('AOI does not intersect the selected scene. Try a different scene or AOI.');

    setProgress(50);
    showLoader('DOWNLOADING NIR BAND (COG)…');
    const nirData = await readCOGWindow(nirUrl, bbox);
    if (!nirData) throw new Error('NIR band window read returned empty. Try a different scene or AOI.');

    // Compute
    setProgress(80);
    showLoader('COMPUTING NDVI…');
    const { ndvi, width, height, stats } = computeNDVIArray(redData, nirData);

    // Render to canvas (still used for the data URL)
    const canvas = document.getElementById('ndvi-canvas');
    const cmap   = document.getElementById('cmap').value;
    renderNDVIToCanvas(canvas, ndvi, width, height, cmap);

    // Update stats panel
    updateNDVIStats(stats);

    // Overlay on map — pass raw ndvi array so hover can read values
    const dataUrl = canvas.toDataURL('image/png');
    setNDVIOverlay(dataUrl, bbox, ndvi, width, height);

    // Build legend
    buildLegend(cmap);

    setProgress(100);
    setStatus('NDVI READY', 'ok');
    toast('NDVI generated — hover the image to read values', 'success');

  } catch (e) {
    setStatus('ERROR', 'error');
    toast('NDVI error: ' + e.message, 'error');
    console.error(e);
  } finally {
    setTimeout(() => setProgress(0), 600);
    hideLoader();
  }
}

// ── LEGEND ────────────────────────────────────────────────
function buildLegend(cmapName) {
  const legend = document.getElementById('ndvi-legend');
  const bar    = document.getElementById('legend-bar');
  const ctx    = bar.getContext('2d');
  const W      = bar.width;

  // Draw gradient from NDVI -1 → 1
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);              // 0→1
    const [r, g, b] = applyColormap(t, cmapName);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, bar.height);
  }

  legend.style.display = 'flex';
}

// ── BOOT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
