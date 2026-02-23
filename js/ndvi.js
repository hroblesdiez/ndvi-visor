// ══════════════════════════════════════════════════════════
//  ndvi.js — COG reader (GeoTIFF.js) + NDVI computation
//            + canvas rendering + colormaps
// ══════════════════════════════════════════════════════════

// ── COG WINDOW READER ─────────────────────────────────────
// Strategy:
//   1. Open COG, read image metadata (geotransform + CRS)
//   2. Reproject WGS84 AOI corners → image CRS (UTM) with proj4
//   3. Convert UTM coords → pixel row/col using the geotransform
//   4. Clamp pixel window to image bounds
//   5. Read ONLY those pixels with readRasters({ window })
//
// This guarantees the raster data is exactly the AOI — nothing more.
export async function readCOGWindow(url, bboxWGS84) {
  const tiff  = await GeoTIFF.fromUrl(url, { allowFullFile: false });
  const image = await tiff.getImage();

  // ── Geotransform ──────────────────────────────────────────
  // getTiePoints / getResolution give us the affine transform:
  //   X_geo = originX + col * xRes
  //   Y_geo = originY + row * yRes   (yRes is negative — top-down)
  const [originX, originY] = image.getOrigin();
  const [xRes, yRes]       = image.getResolution();  // yRes < 0
  const fullW = image.getWidth();
  const fullH = image.getHeight();
  const epsg  = getEPSG(image);

  console.info(`[COG] EPSG:${epsg} | origin:(${originX.toFixed(0)},${originY.toFixed(0)}) | res:(${xRes.toFixed(1)},${yRes.toFixed(1)}) | size:${fullW}×${fullH}`);

  // ── Reproject AOI from WGS84 → image CRS ─────────────────
  const [west, south, east, north] = bboxWGS84;
  let utmCoords;

  if (epsg === 4326) {
    // Image already in degrees
    utmCoords = { xmin: west, ymin: south, xmax: east, ymax: north };
  } else {
    const from = 'EPSG:4326';
    const to   = `EPSG:${epsg}`;
    // Project all 4 corners to handle non-rectangular distortion
    const pts = [
      proj4(from, to, [west,  south]),
      proj4(from, to, [east,  south]),
      proj4(from, to, [east,  north]),
      proj4(from, to, [west,  north]),
    ];
    utmCoords = {
      xmin: Math.min(...pts.map(p => p[0])),
      ymin: Math.min(...pts.map(p => p[1])),
      xmax: Math.max(...pts.map(p => p[0])),
      ymax: Math.max(...pts.map(p => p[1])),
    };
  }

  console.info(`[COG] AOI in EPSG:${epsg}: xmin=${utmCoords.xmin.toFixed(0)} ymin=${utmCoords.ymin.toFixed(0)} xmax=${utmCoords.xmax.toFixed(0)} ymax=${utmCoords.ymax.toFixed(0)}`);

  // ── Convert UTM coords → pixel col/row ────────────────────
  // col = (X - originX) / xRes
  // row = (Y - originY) / yRes   (yRes negative → larger Y = smaller row)
  let col0 = Math.floor((utmCoords.xmin - originX) / xRes);
  let row0 = Math.floor((utmCoords.ymax - originY) / yRes);   // north → top row
  let col1 = Math.ceil( (utmCoords.xmax - originX) / xRes);
  let row1 = Math.ceil( (utmCoords.ymin - originY) / yRes);   // south → bottom row

  console.info(`[COG] Raw pixel window: col ${col0}→${col1}  row ${row0}→${row1}`);

  // ── Clamp to image bounds ─────────────────────────────────
  col0 = Math.max(0, col0);
  row0 = Math.max(0, row0);
  col1 = Math.min(fullW, col1);
  row1 = Math.min(fullH, row1);

  if (col1 <= col0 || row1 <= row0) {
    console.warn('[COG] AOI does not intersect this image tile.');
    return null;   // caller must handle null
  }

  console.info(`[COG] Clamped pixel window: col ${col0}→${col1}  row ${row0}→${row1}  (${col1-col0}×${row1-row0} px)`);

  // ── Compute output size (cap at 1024, preserve aspect) ────
  const winW  = col1 - col0;
  const winH  = row1 - row0;
  const scale = Math.min(1, 1024 / Math.max(winW, winH));
  const outW  = Math.max(1, Math.round(winW * scale));
  const outH  = Math.max(1, Math.round(winH * scale));

  console.info(`[COG] Output size: ${outW}×${outH}`);

  // ── Read ONLY the pixel window ────────────────────────────
  // `window` is [left, top, right, bottom] in pixel coordinates
  const rasters = await image.readRasters({
    window:      [col0, row0, col1, row1],
    width:       outW,
    height:      outH,
    interleave:  false,
  });

  return { data: rasters[0], width: outW, height: outH };
}

// ── EXTRACT EPSG FROM GEOTIFF GEOKEYS ────────────────────
function getEPSG(image) {
  try {
    const geoKeys = image.fileDirectory.GeoKeyDirectory || [];
    for (let i = 4; i < geoKeys.length; i += 4) {
      const keyId = geoKeys[i];
      const val   = geoKeys[i + 3];
      if (keyId === 3072 && val > 0) return val;  // ProjectedCSTypeGeoKey
      if (keyId === 2048 && val > 0) return val;  // GeographicTypeGeoKey
    }
  } catch (_) {}
  return 32601; // safe fallback (UTM zone 1N) — proj4 will handle it
}

// ── NDVI COMPUTATION ──────────────────────────────────────
// Applies Landsat C2L2 scale factor and computes NDVI
// Returns Float32Array + statistics
export function computeNDVIArray(redData, nirData) {
  const width  = Math.min(redData.width,  nirData.width);
  const height = Math.min(redData.height, nirData.height);
  const red = redData.data;
  const nir = nirData.data;

  // Landsat Collection 2 Level-2 reflectance scale
  const SCALE = 0.0000275;
  const OFFSET = -0.2;

  const ndvi = new Float32Array(width * height);
  let sum = 0, cnt = 0, veg = 0;
  let minV =  Infinity;
  let maxV = -Infinity;

  for (let i = 0; i < width * height; i++) {
    const r = Math.max(0, Math.min(1, red[i] * SCALE + OFFSET));
    const n = Math.max(0, Math.min(1, nir[i] * SCALE + OFFSET));
    const denom = n + r;
    const v = denom > 0 ? (n - r) / denom : NaN;
    ndvi[i] = v;

    if (!isNaN(v)) {
      sum += v; cnt++;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      if (v > 0.3)  veg++;
    }
  }

  const mean   = cnt > 0 ? sum / cnt : 0;
  const vegPct = cnt > 0 ? (veg / cnt * 100) : 0;

  return {
    ndvi, width, height,
    stats: { min: minV, mean, max: maxV, vegPct },
  };
}

// ── CANVAS RENDERER ───────────────────────────────────────
// Paints NDVI Float32Array onto a <canvas> element
export function renderNDVIToCanvas(canvasEl, ndvi, width, height, colormapName) {
  canvasEl.width  = width;
  canvasEl.height = height;
  const ctx     = canvasEl.getContext('2d');
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const v = ndvi[i];
    let r = 30, g = 30, b = 30, a = 255;
    if (!isNaN(v)) {
      // Normalize NDVI [-1, 1] → [0, 1]
      const t = Math.max(0, Math.min(1, (v + 1) / 2));
      [r, g, b] = applyColormap(t, colormapName);
    } else {
      a = 0; // transparent for nodata pixels
    }
    imgData.data[i * 4 + 0] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = a;
  }

  ctx.putImageData(imgData, 0, 0);
}

// ── COLORMAPS (exported for legend) ───────────────────────
export function applyColormap(t, name) {
  switch (name) {
    case 'greens':
      return interp(t, [[247,252,245],[0,109,44]]);
    case 'viridis':
      return interp(t, [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]]);
    case 'spectral':
      return interp(t, [[158,1,66],[213,62,79],[253,174,97],[255,255,191],[171,221,164],[43,131,186],[94,79,162]]);
    case 'ylgn':
      return interp(t, [[255,255,229],[120,198,121],[0,104,55]]);
    case 'rdylgn':
    default:
      return interp(t, [[165,0,38],[215,48,39],[244,109,67],[253,174,97],[254,224,139],[255,255,191],[217,239,139],[166,217,106],[102,189,99],[26,152,80],[0,104,55]]);
  }
}

function interp(t, stops) {
  const n   = stops.length - 1;
  const pos = t * n;
  const i   = Math.min(Math.floor(pos), n - 1);
  const f   = pos - i;
  const a   = stops[i];
  const b   = stops[i + 1] || stops[n];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}
