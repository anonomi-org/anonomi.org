import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MERCATOR_LAT,
  MAX_ZOOM,
  TILE_PROVIDERS,
  bboxAreaKm2,
  buildTileUrl,
  clampLat,
  clampZoomPair,
  countTilesForZooms,
  lat2tileY,
  lon2tileX,
  normalizeName,
  pickSubdomain,
  tileJobsForBbox,
  tileRangeForBbox,
  wrapTileX,
  zoomRange,
} from "./tiles.ts";

// --- URL templates ----------------------------------------------------------

test("buildTileUrl substitutes every placeholder", () => {
  assert.equal(
    buildTileUrl("https://{s}.example.com/{z}/{x}/{y}{r}.png", {
      z: 4,
      x: 2,
      y: 3,
      s: "b",
      r: "@2x",
    }),
    "https://b.example.com/4/2/3@2x.png",
  );
});

test("buildTileUrl asks for standard-resolution tiles by default", () => {
  // {r} defaults to "" rather than "@2x": the size estimate is built on
  // standard tiles, and retina ones are roughly four times the bytes.
  assert.equal(
    buildTileUrl("https://a.example.com/{z}/{x}/{y}{r}.png", {
      z: 1,
      x: 0,
      y: 0,
    }),
    "https://a.example.com/1/0/0.png",
  );
});

test("buildTileUrl replaces repeated placeholders, not just the first", () => {
  assert.equal(
    buildTileUrl("https://e.com/{z}/{x}/{y}?retry={z}", { z: 7, x: 1, y: 2 }),
    "https://e.com/7/1/2?retry=7",
  );
});

test("no shipped provider template survives with a placeholder left in it", () => {
  // The exporter once handled {s}/{z}/{x}/{y} but not {r}, so every CARTO Dark
  // Matter tile 404'd while the Leaflet preview rendered fine.
  for (const provider of Object.values(TILE_PROVIDERS)) {
    if (provider.url === "") continue; // google/custom are not fetchable

    const url = buildTileUrl(provider.url, {
      z: 12,
      x: 2045,
      y: 1362,
      s: pickSubdomain(provider.subdomains ?? [], 2045, 1362),
    });

    assert.ok(
      !url.includes("{") && !url.includes("}"),
      `${provider.id} left a placeholder behind: ${url}`,
    );
    assert.doesNotThrow(() => new URL(url), `${provider.id} built a bad URL`);
  }
});

test("pickSubdomain cycles through the list and copes with no subdomains", () => {
  assert.equal(pickSubdomain(["a", "b", "c"], 0, 0), "a");
  assert.equal(pickSubdomain(["a", "b", "c"], 1, 0), "b");
  assert.equal(pickSubdomain(["a", "b", "c"], 1, 1), "c");
  assert.equal(pickSubdomain([], 5, 7), "");
});

// --- coordinates ------------------------------------------------------------

test("lon2tileX maps the world onto the tile grid", () => {
  assert.equal(lon2tileX(-180, 0), 0);
  assert.equal(lon2tileX(0, 1), 1);
  assert.equal(lon2tileX(-180, 4), 0);
  assert.equal(lon2tileX(179.9, 4), 15);
});

test("lat2tileY never returns a row past the edge of the world", () => {
  // The south edge of Mercator lands on n exactly, which is one row too far.
  for (const z of [0, 1, 8, MAX_ZOOM]) {
    const n = 2 ** z;
    assert.ok(lat2tileY(MAX_MERCATOR_LAT, z) >= 0);
    assert.equal(lat2tileY(-MAX_MERCATOR_LAT, z), n - 1);
    assert.equal(lat2tileY(-90, z), n - 1);
    assert.equal(lat2tileY(90, z), 0);
  }
});

test("clampLat holds latitudes inside the Mercator range", () => {
  assert.equal(clampLat(90), MAX_MERCATOR_LAT);
  assert.equal(clampLat(-90), -MAX_MERCATOR_LAT);
  assert.equal(clampLat(12.5), 12.5);
});

test("wrapTileX brings columns from either side back into the world", () => {
  assert.equal(wrapTileX(-1, 2), 3);
  assert.equal(wrapTileX(4, 2), 0);
  assert.equal(wrapTileX(-9, 3), 7);
  assert.equal(wrapTileX(2, 4), 2);
});

// --- bbox -> tiles ----------------------------------------------------------

const ALGARVE = { south: 37.0, west: -8.7, north: 37.3, east: -8.4 };
// Leaflet reports unwrapped longitudes, so a view over the Pacific date line
// comes back as east > 180 rather than as a wrapped pair.
const DATE_LINE = { south: -18.5, west: 176.0, north: -17.5, east: 183.0 };
const WHOLE_WORLD = { south: -85, west: -180, north: 85, east: 180 };
const MULTI_WORLD = { south: -60, west: -400, north: 60, east: 400 };

test("tileRangeForBbox caps a view that spans more than one world", () => {
  for (const z of [0, 1, 4, 8]) {
    assert.equal(tileRangeForBbox(MULTI_WORLD, z).xCount, 2 ** z);
  }
});

test("every job is a real tile coordinate, even across the date line", () => {
  // A negative or oversized column used to reach fetch() as-is, producing
  // requests to hosts like https://.basemaps.cartocdn.com/.
  for (const bbox of [ALGARVE, DATE_LINE, WHOLE_WORLD, MULTI_WORLD]) {
    for (const job of tileJobsForBbox(bbox, zoomRange(0, 6))) {
      const n = 2 ** job.z;
      assert.ok(
        Number.isInteger(job.x) && job.x >= 0 && job.x < n,
        `x ${job.x} out of range at z${job.z}`,
      );
      assert.ok(
        Number.isInteger(job.y) && job.y >= 0 && job.y < n,
        `y ${job.y} out of range at z${job.z}`,
      );
    }
  }
});

test("the job list is exactly as long as the estimate said it would be", () => {
  // The progress bar divides by the estimate, so the two must not drift.
  const zooms = zoomRange(0, 8);
  for (const bbox of [ALGARVE, DATE_LINE, WHOLE_WORLD, MULTI_WORLD]) {
    assert.equal(
      tileJobsForBbox(bbox, zooms).length,
      countTilesForZooms(bbox, zooms),
    );
  }
});

test("a date-line view costs about the same as the view beside it", () => {
  // 7 degrees of longitude is 7 degrees whether or not it crosses 180, so the
  // column counts should differ only by where the tile grid happens to fall -
  // never by the whole world, which is what an unwrapped range would cost.
  const shifted = { south: -18.5, west: 166.0, north: -17.5, east: 173.0 };
  for (const z of zoomRange(0, 12)) {
    const crossing = tileRangeForBbox(DATE_LINE, z).xCount;
    const beside = tileRangeForBbox(shifted, z).xCount;
    assert.ok(
      Math.abs(crossing - beside) <= 1,
      `z${z}: ${crossing} columns crossing vs ${beside} beside`,
    );
  }
});

test("zoom 0 is a single tile for any view", () => {
  for (const bbox of [ALGARVE, DATE_LINE, WHOLE_WORLD, MULTI_WORLD]) {
    assert.deepEqual(tileJobsForBbox(bbox, [0]), [{ z: 0, x: 0, y: 0 }]);
  }
});

// --- estimates --------------------------------------------------------------

test("bboxAreaKm2 gets the whole world about right", () => {
  const area = bboxAreaKm2(WHOLE_WORLD);
  assert.ok(area > 4.9e8 && area < 5.2e8, `got ${area}`);
});

test("bboxAreaKm2 stops at one Earth however far the view is panned", () => {
  assert.ok(bboxAreaKm2(MULTI_WORLD) <= bboxAreaKm2(WHOLE_WORLD) * 1.01);
});

test("bboxAreaKm2 measures a small bbox", () => {
  // ~0.3 deg either way off the Algarve coast: order of a thousand km².
  const area = bboxAreaKm2(ALGARVE);
  assert.ok(area > 500 && area < 2000, `got ${area}`);
});

// --- zoom levels ------------------------------------------------------------

test("clampZoomPair orders the pair and holds it in range", () => {
  assert.deepEqual(clampZoomPair(14, 12), [12, 14]);
  assert.deepEqual(clampZoomPair(-3, 99), [0, MAX_ZOOM]);
  assert.deepEqual(clampZoomPair(5, 5), [5, 5]);
});

test("zoomRange is inclusive at both ends", () => {
  assert.deepEqual(zoomRange(2, 5), [2, 3, 4, 5]);
  assert.deepEqual(zoomRange(3, 3), [3]);
});

// --- pack names -------------------------------------------------------------

test("normalizeName strips accents and collapses punctuation", () => {
  assert.equal(normalizeName("Faro, Algarve"), "Faro_Algarve");
  assert.equal(normalizeName("São Brás"), "Sao_Bras");
  assert.equal(normalizeName("  spaced  out  "), "spaced_out");
  assert.equal(normalizeName("Maps z0–16"), "Maps_z0_16");
});

test("normalizeName returns empty when nothing usable is left", () => {
  // The caller has to supply a fallback rather than save a file called ".zip".
  assert.equal(normalizeName("🎉🎉"), "");
  assert.equal(normalizeName("___"), "");
});
