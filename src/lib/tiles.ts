// Slippy-map tile maths for the offline maps exporter.
//
// The estimate and the download loop used to carry separate copies of this
// and had drifted apart, so both now come from here.

export type Bbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type TileCoords = {
  z: number;
  x: number;
  y: number;
  s?: string;
  r?: string;
};

export type TileJob = { z: number; x: number; y: number };

// Web Mercator stops just short of the poles.
export const MAX_MERCATOR_LAT = 85.05112878;

export const MAX_ZOOM = 18;

// --- sources ----------------------------------------------------------------

export type TileProviderId =
  | "none"
  | "carto_dark"
  | "osm"
  | "opentopo"
  | "carto"
  | "google"
  | "custom";

export type TileProvider = {
  id: TileProviderId;
  label: string;
  /** Leaflet template: .../{z}/{x}/{y}.png, may include {s} and {r}. Empty
   *  means the entry is a UI affordance, not something we can fetch. */
  url: string;
  attribution: string;
  subdomains?: string[];
};

export const TILE_PROVIDERS: Record<
  Exclude<TileProviderId, "none">,
  TileProvider
> = {
  osm: {
    id: "osm",
    label: "OpenStreetMap (test)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    subdomains: ["a", "b", "c"],
  },
  opentopo: {
    id: "opentopo",
    label: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      "&copy; OpenTopoMap (CC-BY-SA) &copy; OpenStreetMap contributors",
    subdomains: ["a", "b", "c"],
  },
  carto_dark: {
    id: "carto_dark",
    label: "CARTO • Dark Matter (dark)",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  carto: {
    id: "carto",
    label: "CARTO Positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    subdomains: ["a", "b", "c", "d"],
  },
  google: {
    id: "google",
    label: "Google Maps",
    url: "", // not fetchable - the UI links to the docs instead
    attribution: "",
  },
  custom: {
    id: "custom",
    label: "Custom",
    url: "", // filled in by the user
    attribution: "",
  },
};

export function clampLat(lat: number) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

// --- URL templates ----------------------------------------------------------

/**
 * Fill a Leaflet URL template.
 *
 * Every placeholder is replaced globally. {r} resolves to "" so exports always
 * ask for standard-resolution tiles: Leaflet substitutes it with "@2x" on retina
 * screens, which would quadruple the pack size the estimate promised.
 */
export function buildTileUrl(
  template: string,
  { z, x, y, s = "", r = "" }: TileCoords,
) {
  return template
    .replace(/\{s\}/g, s)
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{r\}/g, r);
}

/** Pick a subdomain for a tile, or "" when the source does not use {s}. */
export function pickSubdomain(subdomains: string[], x: number, y: number) {
  if (subdomains.length === 0) return "";
  return subdomains[Math.abs(x + y) % subdomains.length]!;
}

// --- coordinates ------------------------------------------------------------

export function lon2tileX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function lat2tileY(lat: number, z: number) {
  const n = 2 ** z;
  const rad = (clampLat(lat) * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  const y = Math.floor(((1 - merc / Math.PI) / 2) * n);
  // The southern edge lands on n exactly, one row past the last real tile.
  return Math.min(n - 1, Math.max(0, y));
}

/**
 * Bring a tile column back into [0, n).
 *
 * Leaflet reports unwrapped longitudes — pan past the antimeridian and west
 * keeps counting up past 180, or down past -180 — so a column index can land
 * outside the world before it reaches a URL.
 */
export function wrapTileX(x: number, z: number) {
  const n = 2 ** z;
  return ((x % n) + n) % n;
}

// --- bbox -> tiles ----------------------------------------------------------

export type TileRange = {
  /** May sit outside [0, n). Wrap each column before putting it in a URL. */
  xStart: number;
  xCount: number;
  yStart: number;
  yCount: number;
};

export function tileRangeForBbox(bbox: Bbox, z: number): TileRange {
  const n = 2 ** z;

  const xStart = lon2tileX(Math.min(bbox.west, bbox.east), z);
  const xEnd = lon2tileX(Math.max(bbox.west, bbox.east), z);
  // A zoomed-out view can span more than one copy of the world; past that
  // point we would just be fetching the same columns again.
  const xCount = Math.min(n, xEnd - xStart + 1);

  // North is the smaller y.
  const yStart = lat2tileY(Math.max(bbox.north, bbox.south), z);
  const yEnd = lat2tileY(Math.min(bbox.north, bbox.south), z);

  return { xStart, xCount, yStart, yCount: yEnd - yStart + 1 };
}

export function countTilesForBbox(bbox: Bbox, z: number) {
  const { xCount, yCount } = tileRangeForBbox(bbox, z);
  return xCount * yCount;
}

export function countTilesForZooms(bbox: Bbox, zooms: number[]) {
  return zooms.reduce((total, z) => total + countTilesForBbox(bbox, z), 0);
}

/** The exact list the download loop walks. Its length is countTilesForZooms. */
export function tileJobsForBbox(bbox: Bbox, zooms: number[]): TileJob[] {
  const jobs: TileJob[] = [];

  for (const z of zooms) {
    const { xStart, xCount, yStart, yCount } = tileRangeForBbox(bbox, z);

    for (let i = 0; i < xCount; i++) {
      const x = wrapTileX(xStart + i, z);
      for (let j = 0; j < yCount; j++) {
        jobs.push({ z, x, y: yStart + j });
      }
    }
  }

  return jobs;
}

// --- estimates --------------------------------------------------------------

/** Spherical area of the bbox, in km². */
export function bboxAreaKm2(bbox: Bbox) {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;

  // Unwrapped longitudes can span the globe more than once; one Earth is the
  // most a bbox can actually cover.
  const dLon = toRad(Math.min(360, Math.abs(bbox.east - bbox.west)));
  const lat1 = toRad(clampLat(bbox.south));
  const lat2 = toRad(clampLat(bbox.north));

  return Math.abs(R * R * dLon * (Math.sin(lat2) - Math.sin(lat1)));
}

// --- zoom levels ------------------------------------------------------------

export function clampZoomPair(from: number, to: number) {
  let a = Math.max(0, Math.min(MAX_ZOOM, from));
  let b = Math.max(0, Math.min(MAX_ZOOM, to));
  if (a > b) [a, b] = [b, a];
  return [a, b] as const;
}

export function zoomRange(from: number, to: number) {
  const out: number[] = [];
  for (let z = from; z <= to; z++) out.push(z);
  return out;
}

// --- pack names -------------------------------------------------------------

export function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
