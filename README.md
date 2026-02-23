# NDVI Explorer

A browser-based tool to explore Landsat satellite imagery and compute NDVI over any area of interest.

https://ndvi-visor.netlify.app/
---

## How to use

1. Draw a rectangle on the map to define your area of interest
2. Set a date range and maximum cloud cover percentage
3. Click "Search Scenes" — it queries the Planetary Computer STAC catalog and lists available Landsat scenes sorted by cloud cover
4. Click a scene to preview it on the map
5. Click "Generate NDVI" — it downloads only the red and NIR bands for your drawn area and computes the index in the browser
6. Hover over the NDVI image to read values at any pixel

The legend at the bottom shows the color scale from -1 to 1 along with min, mean, max and vegetation cover percentage for the selected area.

---

## Technologies

- Leaflet
- GeoTIFF.js
- proj4js
- Planetary Computer STAC API
- Landsat Collection 2 Level-2
- Vanilla JS with ES modules
