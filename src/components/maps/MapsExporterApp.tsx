import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import JSZip from "jszip";
import { saveAs } from "file-saver";

type DetailLevel = "Low" | "Medium" | "High";

type TileProviderId =
  | "none"
  | "carto_dark"
  | "osm"
  | "opentopo"
  | "carto"
  | "google"
  | "custom";

type TileProvider = {
  id: TileProviderId;
  label: string;
  url: string; // Leaflet template: .../{z}/{x}/{y}.png (may include {s})
  attribution: string;
  subdomains?: string[];
};

const TILE_PROVIDERS: Record<Exclude<TileProviderId, "none">, TileProvider> = {
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
    url: "", // Not used - redirects to docs
    attribution: "",
  },
  custom: {
    id: "custom",
    label: "Custom",
    url: "",
    attribution: "",
  },
};

function buildTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
  s?: string,
) {
  return template
    .replace("{s}", s ?? "")
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

function clampZoomPair(from: number, to: number) {
  let a = Math.max(0, Math.min(18, from));
  let b = Math.max(0, Math.min(18, to));
  if (a > b) [a, b] = [b, a];
  return [a, b] as const;
}

function range(from: number, to: number) {
  const out: number[] = [];
  for (let z = from; z <= to; z++) out.push(z);
  return out;
}

// --- simple geodesic-ish area estimate (spherical)
// bbox: [south, west] [north, east] in degrees
function bboxAreaKm2(south: number, west: number, north: number, east: number) {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(south);
  const lat2 = toRad(north);
  const dLon = toRad(east - west);
  const area = Math.abs(R * R * dLon * (Math.sin(lat2) - Math.sin(lat1)));
  return area;
}

function tilesForBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  z: number,
) {
  const n = 2 ** z;
  const lon2x = (lon: number) => ((lon + 180) / 360) * n;

  const lat2y = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    return ((1 - merc / Math.PI) / 2) * n;
  };

  const clampLatLocal = (lat: number) =>
    Math.max(-85.05112878, Math.min(85.05112878, lat));

  const y1 = lat2y(clampLatLocal(north));
  const y2 = lat2y(clampLatLocal(south));
  const x1 = lon2x(west);
  const x2 = lon2x(east);

  const xmin = Math.floor(Math.min(x1, x2));
  const xmax = Math.floor(Math.max(x1, x2));
  const ymin = Math.floor(Math.min(y1, y2));
  const ymax = Math.floor(Math.max(y1, y2));

  const w = Math.max(0, xmax - xmin + 1);
  const h = Math.max(0, ymax - ymin + 1);
  return w * h;
}

function lon2tileX(lon: number, z: number) {
  const n = 2 ** z;
  return Math.floor(((lon + 180) / 360) * n);
}

function lat2tileY(lat: number, z: number) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return Math.floor(((1 - merc / Math.PI) / 2) * n);
}

function clampLat(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function BboxTracker({ onBounds }: { onBounds: (b: LatLngBounds) => void }) {
  const raf = useRef<number | null>(null);

  useMapEvents({
    move: (e) => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => onBounds(e.target.getBounds()));
    },
    zoom: (e) => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => onBounds(e.target.getBounds()));
    },
  });

  return null;
}

function MapInitializer({
  mapRef,
  onBounds,
}: {
  mapRef: React.MutableRefObject<L.Map | null>;
  onBounds: (b: LatLngBounds) => void;
}) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    map.invalidateSize();
    onBounds(map.getBounds());
  }, [map, mapRef, onBounds]);

  return null;
}

export default function MapsExporterApp() {
  // Simple mode
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("Medium");

  // Advanced mode (hidden by default)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [zoomFrom, setZoomFrom] = useState(12);
  const [zoomTo, setZoomTo] = useState(14);

  // Map bbox state
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const [tileProviderId, setTileProviderId] = useState<TileProviderId>("none");
  const [customTileUrl, setCustomTileUrl] = useState("");
  const [customAttribution, setCustomAttribution] = useState("");
  const [customUrlApplied, setCustomUrlApplied] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [packName, setPackName] = useState("");

  const [failedTiles, setFailedTiles] = useState(0);

  const [isPaused, setIsPaused] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [endedAt, setEndedAt] = useState<Date | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);

  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const packNowRef = useRef(false);

  const tileTemplate =
    tileProviderId === "custom"
      ? customTileUrl.trim()
      : tileProviderId === "none"
        ? ""
        : TILE_PROVIDERS[tileProviderId].url;

  const tileAttribution =
    tileProviderId === "custom"
      ? customAttribution.trim()
      : tileProviderId === "none"
        ? ""
        : TILE_PROVIDERS[tileProviderId].attribution;

  const tileSubdomains =
    tileProviderId === "custom"
      ? tileTemplate.includes("{s}")
        ? ["a", "b", "c"]
        : []
      : tileProviderId === "none"
        ? []
        : (TILE_PROVIDERS[tileProviderId].subdomains ?? []);

  // For custom mode, only consider selected when URL has required placeholders AND user clicked "Load"
  const isValidCustomUrl =
    tileProviderId === "custom" &&
    customTileUrl.includes("{z}") &&
    customTileUrl.includes("{x}") &&
    customTileUrl.includes("{y}");

  const isTileSourceSelected =
    tileProviderId === "custom"
      ? isValidCustomUrl && customUrlApplied
      : tileTemplate.length > 0;

  // When not in advanced, detail level implies a zoom range.
  const effectiveZooms = useMemo(() => {
    if (showAdvanced) {
      const [a, b] = clampZoomPair(zoomFrom, zoomTo);
      return range(a, b);
    }

    if (detailLevel === "Low") return range(0, 8);
    if (detailLevel === "Medium") return range(0, 12);
    return range(0, 16); // High
  }, [detailLevel, showAdvanced, zoomFrom, zoomTo]);

  const estimate = useMemo(() => {
    if (!bounds)
      return {
        areaKm2: null as number | null,
        tiles: null as number | null,
        sizeMB: null as number | null,
      };

    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    const areaKm2 = bboxAreaKm2(south, west, north, east);

    // tiles across all chosen zooms
    let tiles = 0;
    for (const z of effectiveZooms)
      tiles += tilesForBbox(south, west, north, east, z);

    // Rough average ~8.5 KB/tile based on real-world exports
    // (low-zoom tiles are tiny, vector-style providers like CARTO average 5-15 KB)
    const avgKBPerTile = 8.5;
    const sizeMB = (tiles * avgKBPerTile) / 1024;

    return { areaKm2, tiles, sizeMB };
  }, [bounds, effectiveZooms]);

  const estimatedAreaText =
    estimate.areaKm2 == null
      ? "—"
      : estimate.areaKm2 < 1
        ? `${(estimate.areaKm2 * 1_000_000).toFixed(0)} m²`
        : `${estimate.areaKm2.toFixed(2)} km²`;

  const estimatedSizeText =
    estimate.sizeMB == null
      ? "—"
      : estimate.sizeMB < 1024
        ? `~${estimate.sizeMB.toFixed(0)} MB`
        : `~${(estimate.sizeMB / 1024).toFixed(2)} GB`;

  function fmtTime(d: Date) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function fmtDuration(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  }

  function fmtBytes(bytes: number) {
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    if (kb >= 1) return `${kb.toFixed(0)} KB`;
    return `${bytes} B`;
  }

  async function waitWhilePaused() {
    while (pauseRef.current) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  function togglePause() {
    const next = !pauseRef.current;
    pauseRef.current = next;
    setIsPaused(next);
  }

  function stopAndPack() {
    // stop fetching new tiles, but still zip what we have
    packNowRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
  }

  function cancelExport() {
    // hard cancel: abort fetch + reset UI
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = null;

    packNowRef.current = false;
    pauseRef.current = false;

    setIsPaused(false);
    setIsExporting(false);
    setEndedAt(new Date());
    setExportError("Cancelled.");
  }

  async function exportZip() {
    if (!bounds) return;

    setExportError(null);
    setIsExporting(true);
    setProgress(null);
    setFailedTiles(0);

    setIsPaused(false);
    pauseRef.current = false;
    packNowRef.current = false;

    const started = new Date();
    setStartedAt(started);
    setEndedAt(null);
    setDownloadedBytes(0);

    abortRef.current = new AbortController();

    try {
      const south = bounds.getSouth();
      const west = bounds.getWest();
      const north = bounds.getNorth();
      const east = bounds.getEast();

      const regionName = packName.trim() || `Maps z${effectiveZooms[0]}–${effectiveZooms[effectiveZooms.length - 1]}`;
      const placeName = normalizeName(regionName);

      const zip = new JSZip();
      const root = zip.folder("AnonMapsCache")!;
      const meta = {
        region: regionName,
        bbox: { south, west, north, east },
        zooms: effectiveZooms,
        createdAt: new Date().toISOString(),
        tileSource: tileTemplate,
      };

      // Precompute all tile jobs (so we can show a real progress bar)
      const jobs: Array<{ z: number; x: number; y: number }> = [];
      for (const z of effectiveZooms) {
        const nLat = clampLat(north);
        const sLat = clampLat(south);

        const xMin = Math.min(lon2tileX(west, z), lon2tileX(east, z));
        const xMax = Math.max(lon2tileX(west, z), lon2tileX(east, z));
        const yMin = Math.min(lat2tileY(nLat, z), lat2tileY(sLat, z));
        const yMax = Math.max(lat2tileY(nLat, z), lat2tileY(sLat, z));

        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
            jobs.push({ z, x, y });
          }
        }
      }

      setProgress({ done: 0, total: jobs.length });

      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;

      let done = 0;
      for (const job of jobs) {
        const subs =
          tileSubdomains ??
          (tileTemplate.includes("{s}") ? ["a", "b", "c"] : [""]);
        const s = subs[(job.x + job.y) % subs.length];
        const url = buildTileUrl(tileTemplate, job.z, job.x, job.y, s);

        await waitWhilePaused();

        if (packNowRef.current) break;

        const ctrl = abortRef.current;
        if (!ctrl) throw new Error("Export cancelled");

        let fetched = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const blob = await res.blob();
            const arr = await blob.arrayBuffer();

            setDownloadedBytes((b) => b + arr.byteLength);
            root.file(`${job.z}/${job.x}/${job.y}.png`, arr);
            fetched = true;
            break;
          } catch (err: any) {
            // Abort signal means user cancelled — propagate immediately
            if (err?.name === "AbortError") throw err;
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            }
          }
        }

        if (!fetched) {
          setFailedTiles((n) => n + 1);
        }

        done++;
        if (done % 25 === 0 || done === jobs.length) {
          setProgress({ done, total: jobs.length });
          await new Promise((r) => setTimeout(r, 0)); // yield to UI
        }
      }

      // metadata file beside tile folders
      root.file("export.amd", JSON.stringify(meta, null, 2));

      const outBlob = await zip.generateAsync({ type: "blob" });

      saveAs(outBlob, `${placeName}.zip`);
    } catch (e: any) {
      setExportError(e?.message ?? "Export failed");
    } finally {
      setIsExporting(false);
      setEndedAt(new Date());
      abortRef.current = null;
      packNowRef.current = false;
      pauseRef.current = false;
    }
  }

  return (
    <div className="space-y-4">
      {/* Small explanation (first thing user reads) */}
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold text-zinc-200">How it works</div>
        <p className="mt-2 text-sm text-zinc-400">
          Move the map until the area inside the selection frame matches what
          you want. Then pick the zoom detail and export locally. No uploads. No
          accounts.
        </p>
      </div>

      {/* Main layout: Map first on mobile */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Map selection (first on mobile) */}
        <div className="order-1 lg:order-none lg:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-zinc-200">
              Map selection
            </div>
            <div className="text-xs text-zinc-500">Client-side only</div>
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            The visible area inside the frame is the export boundary (bbox).
          </p>

          <div
            className="relative mt-4 h-[420px] rounded-xl border border-white/10 overflow-hidden"
            style={{ touchAction: "none" }}
          >
            {/* Map */}
            {!isTileSourceSelected ? (
              <div className="flex h-full w-full items-center justify-center p-6 text-center">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">
                    Select a map source to load the map
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    This avoids any external tile requests before user input.
                  </p>
                </div>
              </div>
            ) : (
              <MapContainer
                key={tileProviderId} // remount when source changes (but not on every keystroke for custom)
                center={[37.138, -8.536] as [number, number]}
                zoom={12}
                className="h-full w-full"
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  url={tileTemplate}
                  attribution={tileAttribution}
                  subdomains={tileSubdomains as any}
                />
                <BboxTracker onBounds={(b) => setBounds(b)} />
                <MapInitializer
                  mapRef={mapRef}
                  onBounds={(b) => setBounds(b)}
                />
              </MapContainer>
            )}
          </div>
        </div>

        {/* Export settings */}
        <div className="order-2 lg:order-none rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-zinc-200">
            Export settings
          </div>

          {/* Tile source */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">
              Map source
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              No map network requests are made until you choose a source.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  "carto_dark",
                  "carto",
                  "osm",
                  "opentopo",
                  "google",
                  "custom",
                ] as const
              ).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    // switching sources should reset map-derived state
                    setTileProviderId(id);
                    setBounds(null);
                    mapRef.current = null;
                    setCustomUrlApplied(false);
                  }}
                  className={[
                    "rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-white/10",
                    tileProviderId === id
                      ? "bg-white/15 text-white"
                      : "bg-black/20 text-zinc-300 hover:bg-white/10",
                  ].join(" ")}
                >
                  {TILE_PROVIDERS[id].label}
                </button>
              ))}
            </div>

            {tileProviderId === "custom" && (
              <div className="mt-3 space-y-2">
                <label className="block">
                  <div className="text-xs text-zinc-400">Tile URL template</div>
                  <input
                    value={customTileUrl}
                    onChange={(e) => setCustomTileUrl(e.target.value)}
                    placeholder="https://example.com/tiles/{z}/{x}/{y}.png"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Use <span className="font-mono">{`{z}`}</span>,{" "}
                    <span className="font-mono">{`{x}`}</span>,{" "}
                    <span className="font-mono">{`{y}`}</span>. Optional{" "}
                    <span className="font-mono">{`{s}`}</span> for subdomains.
                  </p>
                </label>

                <label className="block">
                  <div className="text-xs text-zinc-400">
                    Attribution (optional)
                  </div>
                  <input
                    value={customAttribution}
                    onChange={(e) => setCustomAttribution(e.target.value)}
                    placeholder="&copy; …"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                  />
                </label>

                <button
                  type="button"
                  disabled={!isValidCustomUrl}
                  onClick={() => setCustomUrlApplied(true)}
                  className={[
                    "mt-2 w-full rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-white/10",
                    isValidCustomUrl
                      ? "bg-white/15 text-white hover:bg-white/20"
                      : "bg-white/5 text-zinc-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  {customUrlApplied ? "Reload map" : "Load map"}
                </button>
              </div>
            )}

            {tileProviderId === "google" && (
              <a
                href="/docs/maps-exporter#using-google-maps-as-source"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-fuchsia-400 hover:text-fuchsia-300"
              >
                Learn more about Google Maps as source
                <span aria-hidden="true">→</span>
              </a>
            )}
          </div>

          {/* Zoom section */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">Zoom</div>

            <div className="mt-3">
              <div className="text-xs font-medium tracking-wide text-zinc-400">
                Detail level
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["Low", "Medium", "High"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setDetailLevel(lvl)}
                    className={[
                      "rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-white/10",
                      !showAdvanced && detailLevel === lvl
                        ? "bg-white/15 text-white"
                        : "bg-black/20 text-zinc-300 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-xs text-zinc-500">
                Low detail is safer and faster. High detail can produce very
                large downloads.
              </div>
            </div>

            {/* Advanced toggle */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
              >
                Advanced
                <span className="text-zinc-500">
                  {showAdvanced ? "▲" : "▼"}
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs font-medium tracking-wide text-zinc-400">
                    Set custom zoom levels
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-xs text-zinc-400">Zoom from</div>
                      <select
                        value={zoomFrom}
                        onChange={(e) => setZoomFrom(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                      >
                        {Array.from({ length: 19 }, (_, i) => i).map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <div className="text-xs text-zinc-400">Zoom to</div>
                      <select
                        value={zoomTo}
                        onChange={(e) => setZoomTo(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                      >
                        {Array.from({ length: 19 }, (_, i) => i).map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <p className="mt-3 text-xs text-zinc-500">
                    Tip: mobile storage and memory are limited — avoid max zoom
                    unless necessary.
                  </p>
                </div>
              )}
            </div>

            {/* Selected zooms */}
            <div className="mt-4 text-xs text-zinc-400">
              Selected zooms:{" "}
              <span className="font-mono text-zinc-200">
                {effectiveZooms.join(" ")}
              </span>
            </div>
          </div>

          {/* Pack name */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">
              Pack name
            </div>
            <input
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              placeholder={`Maps z${effectiveZooms[0]}–${effectiveZooms[effectiveZooms.length - 1]}`}
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <p className="mt-2 text-xs text-zinc-500">
              Shown in the app after import. Leave empty for a default name.
            </p>
          </div>

          {/* Estimate + warnings (after zoom) */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-zinc-200">Estimate</div>

            <div className="mt-2 text-sm text-zinc-400">
              <div>
                Area: <span className="text-zinc-200">{estimatedAreaText}</span>
              </div>
              <div className="mt-1">
                Estimated pack size:{" "}
                <span className="text-zinc-200">{estimatedSizeText}</span>
              </div>
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              Keep this tab open during export. Mobile browsers may pause
              background work.
            </p>
          </div>

          {/* Export */}
          <button
            type="button"
            disabled={!bounds || !isTileSourceSelected || isExporting}
            onClick={exportZip}
            className={[
              "mt-4 w-full rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-white/10",
              !bounds || isExporting
                ? "bg-white/10 text-zinc-300 opacity-60"
                : "bg-white/15 text-white hover:bg-white/20",
            ].join(" ")}
          >
            {isExporting ? "Exporting…" : "Export zip"}
          </button>
        </div>
      </div>

      {progress && (
        <div className="order-3 lg:order-none lg:col-start-3 lg:row-start-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
            <div className="flex items-center justify-between gap-3">
              <div className="text-zinc-400">
                <span className="text-zinc-200">
                  {Math.floor(
                    (progress.done / Math.max(1, progress.total)) * 100,
                  )}
                  %
                </span>{" "}
                — Downloaded tiles:{" "}
                <span className="text-zinc-200">{progress.done}</span> /{" "}
                {progress.total}
                {failedTiles > 0 && (
                  <>
                    {" "}— Failed:{" "}
                    <span className="text-red-300">{failedTiles}</span>
                  </>
                )}
              </div>

              <div className="text-zinc-500">
                {isPaused ? "Paused" : isExporting ? "Running" : endedAt ? "Done" : "Idle"}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-1 text-zinc-400">
              <div>
                Started on:{" "}
                <span className="text-zinc-200">
                  {startedAt ? fmtTime(startedAt) : "—"}
                </span>
              </div>
              <div>
                Duration:{" "}
                <span className="text-zinc-200">
                  {startedAt
                    ? fmtDuration((endedAt ?? new Date()).getTime() - startedAt.getTime())
                    : "—"}
                </span>
              </div>
              <div>
                Total downloaded:{" "}
                <span className="text-zinc-200">
                  {fmtBytes(downloadedBytes)}
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={togglePause}
                disabled={!isExporting}
                className={[
                  "rounded-xl px-3 py-2 text-xs font-medium ring-1 ring-white/10",
                  !isExporting
                    ? "bg-white/10 text-zinc-400 opacity-60"
                    : "bg-white/15 text-white hover:bg-white/20",
                ].join(" ")}
              >
                {isPaused ? "Continue" : "Pause"}
              </button>

              <button
                type="button"
                onClick={stopAndPack}
                disabled={!isExporting}
                className={[
                  "rounded-xl px-3 py-2 text-xs font-medium ring-1 ring-white/10",
                  !isExporting
                    ? "bg-white/10 text-zinc-400 opacity-60"
                    : "bg-white/15 text-white hover:bg-white/20",
                ].join(" ")}
              >
                Stop and pack what we have
              </button>

              {isExporting ? (
                <button
                  type="button"
                  onClick={cancelExport}
                  className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-medium text-red-100 ring-1 ring-red-500/30 hover:bg-red-500/20"
                >
                  Cancel
                </button>
              ) : (
                <div className="flex items-center justify-center rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/30">
                  Completed
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
