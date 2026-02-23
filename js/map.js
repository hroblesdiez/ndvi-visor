// ══════════════════════════════════════════════════════════
//  map.js — Leaflet map, draw control, AOI management
// ══════════════════════════════════════════════════════════

import { toast } from './ui.js';

let map, drawControl, drawnItems;
let previewLayer  = null;
let ndviLayer     = null;   // custom canvas overlay
let ndviTooltip   = null;   // hover tooltip div

// ── INIT ──────────────────────────────────────────────────
export function initMap(onBBoxDrawn) {
  map = L.map('map', { center: [20, 0], zoom: 3 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  drawnItems = new L.FeatureGroup().addTo(map);

  drawControl = new L.Control.Draw({
    draw: {
      rectangle: {
        shapeOptions: { color: '#1a6faf', weight: 2, opacity: .9, fillOpacity: .06, dashArray: '6 4' },
      },
      polyline: false, polygon: false, circle: false, circlemarker: false, marker: false,
    },
    edit: { featureGroup: drawnItems, remove: true },
  });
  map.addControl(drawControl);

  // Forward drawn rectangle to callback
  map.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    const b = e.layer.getBounds();
    const bbox = [
      +b.getWest().toFixed(6), +b.getSouth().toFixed(6),
      +b.getEast().toFixed(6), +b.getNorth().toFixed(6),
    ];
    map.fitBounds(e.layer.getBounds(), { padding: [40, 40] });
    onBBoxDrawn(bbox);
    toast('AOI defined — ready to search', 'success');
  });

  // Coordinate HUD
  map.on('mousemove', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('hud').textContent =
      `LAT ${lat.toFixed(5)}  ·  LON ${lng.toFixed(5)}`;
  });

  // Create persistent tooltip element
  ndviTooltip = document.createElement('div');
  ndviTooltip.id = 'ndvi-tooltip';
  ndviTooltip.style.display = 'none';
  document.getElementById('mapwrap').appendChild(ndviTooltip);
}

// ── DRAW TRIGGER ──────────────────────────────────────────
export function startDraw() {
  new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();
  toast('Drag a rectangle on the map', 'info');
}

// ── SCENE OUTLINE ─────────────────────────────────────────
export function highlightSceneBBox(bbox) {
  clearPreviewLayer();
  const [w, s, e, n] = bbox;
  previewLayer = L.rectangle([[s, w], [n, e]], {
    color: '#2e7d32', weight: 2, fillOpacity: .04, dashArray: '5 4',
  }).addTo(map);
}

// ── PREVIEW IMAGE ─────────────────────────────────────────
export function showPreviewImage(signedUrl, bbox) {
  clearPreviewLayer();
  const [w, s, e, n] = bbox;
  previewLayer = L.imageOverlay(signedUrl, [[s, w], [n, e]], {
    opacity: .8, interactive: false,
  }).addTo(map);
}

// ── NDVI OVERLAY WITH HOVER ───────────────────────────────
// ndviArray: Float32Array of NDVI values  [-1..1, or NaN]
// pixelW/pixelH: dimensions of that array
// bbox: [west, south, east, north] in WGS84
export function setNDVIOverlay(dataUrl, bbox, ndviArray, pixelW, pixelH) {
  // Remove old layer
  if (ndviLayer) { map.removeLayer(ndviLayer); ndviLayer = null; }

  const [west, south, east, north] = bbox;
  const bounds = L.latLngBounds([[south, west], [north, east]]);

  // Standard image overlay for rendering
  ndviLayer = L.imageOverlay(dataUrl, bounds, { opacity: 0.85, interactive: false });
  ndviLayer.addTo(map);

  // Invisible interaction layer on top for mouse events
  const hitLayer = L.rectangle(bounds, {
    fillOpacity: 0,
    opacity: 0,
    interactive: true,
  }).addTo(map);

  hitLayer.on('mousemove', (e) => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // Map lat/lng → pixel index in the ndviArray
    const col = Math.floor((lng - west)  / (east  - west)  * pixelW);
    const row = Math.floor((north - lat) / (north - south) * pixelH);

    if (col >= 0 && col < pixelW && row >= 0 && row < pixelH) {
      const val = ndviArray[row * pixelW + col];
      const tip = ndviTooltip;

      if (!isNaN(val)) {
        tip.textContent = `NDVI: ${val.toFixed(4)}`;
        tip.style.display = 'block';

        // Position relative to mapwrap
        const mapEl  = document.getElementById('mapwrap');
        const rect   = mapEl.getBoundingClientRect();
        const point  = map.latLngToContainerPoint(e.latlng);
        tip.style.left = (point.x + 14) + 'px';
        tip.style.top  = (point.y - 28) + 'px';
      } else {
        tip.style.display = 'none';
      }
    }
  });

  hitLayer.on('mouseout', () => {
    ndviTooltip.style.display = 'none';
  });

  // Store hitLayer ref so it gets removed on clear
  ndviLayer._hitLayer = hitLayer;
}

// ── CLEAR ─────────────────────────────────────────────────
function clearPreviewLayer() {
  if (previewLayer) { map.removeLayer(previewLayer); previewLayer = null; }
}

export function clearMapLayers() {
  drawnItems.clearLayers();
  clearPreviewLayer();
  if (ndviLayer) {
    if (ndviLayer._hitLayer) map.removeLayer(ndviLayer._hitLayer);
    map.removeLayer(ndviLayer);
    ndviLayer = null;
  }
  if (ndviTooltip) ndviTooltip.style.display = 'none';
}
