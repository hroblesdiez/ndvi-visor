// ══════════════════════════════════════════════════════════
//  stac.js — Planetary Computer STAC search + URL signing
// ══════════════════════════════════════════════════════════

const STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const SIGN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';
const COLLECTION = 'landsat-c2-l2';

// ── SEARCH ────────────────────────────────────────────────
export async function searchScenes({ bbox, dateStart, dateEnd, cloudCover, limit = 20 }) {
  const body = {
    collections: [COLLECTION],
    bbox,
    datetime: `${dateStart}T00:00:00Z/${dateEnd}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: cloudCover } },
    limit,
    sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
  };

  const res = await fetch(`${STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`STAC search failed — HTTP ${res.status}`);
  const data = await res.json();
  return data.features || [];
}

// ── SIGN URL ──────────────────────────────────────────────
// Retries up to 4 times with backoff on 429 (rate limit).
// Throws on failure — never silently returns an unsigned URL,
// because unsigned Azure Blob Storage URLs return 409.
export async function signUrl(href) {
  const MAX_RETRIES = 4;
  let delay = 800; // ms

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `${SIGN_URL}?href=${encodeURIComponent(href)}`
      );

      if (res.ok) {
        const data = await res.json();
        return data.href;
      }

      if (res.status === 429) {
        // Rate limited — wait and retry
        console.warn(`[STAC] Sign rate limited (429), retrying in ${delay}ms… (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        delay *= 2; // exponential backoff: 800 → 1600 → 3200 → 6400ms
        continue;
      }

      // Any other HTTP error — not worth retrying
      throw new Error(`URL signing failed: HTTP ${res.status}`);

    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      console.warn(`[STAC] Sign error (attempt ${attempt}): ${e.message}`);
      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error(`URL signing failed after ${MAX_RETRIES} attempts (rate limited). Wait a moment and try again.`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── RESOLVE BAND KEYS ─────────────────────────────────────
// Planetary Computer uses common-name keys: "red", "nir08"
// Fallbacks cover older catalog versions or alternate naming
function findKey(assets, candidates) {
  for (const key of candidates) {
    if (assets[key]) return key;
  }
  return null;
}

export function resolveBandKeys(assets) {
  console.info('[STAC] Available asset keys:', Object.keys(assets));

  const redKey = findKey(assets, ['red', 'SR_B4', 'sr_b4', 'SR_B3', 'sr_b3', 'B4', 'B3']);

  let nirKey = findKey(assets, ['nir08', 'nir', 'SR_B5', 'sr_b5', 'SR_B4', 'sr_b4', 'B5', 'B4']);

  // Guard: both must differ
  if (nirKey && nirKey === redKey) {
    nirKey = findKey(assets,
      Object.keys(assets).filter(k => k !== redKey && (
        k.toLowerCase().includes('nir') ||
        k.toLowerCase().includes('b5') ||
        k.toLowerCase().includes('b4')
      ))
    );
  }

  console.info(`[STAC] RED="${redKey}"  NIR="${nirKey}"`);
  return { redKey, nirKey };
}
