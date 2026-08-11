import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import JSZip from "jszip";
import { saveAs } from "file-saver";

import {
  MAX_ZOOM,
  TILE_PROVIDERS,
  type TileProviderId,
  bboxAreaKm2,
  buildTileUrl,
  clampZoomPair,
  countTilesForZooms,
  normalizeName,
  pickSubdomain,
  tileJobsForBbox,
  zoomRange,
} from "../../lib/tiles";

type DetailLevel = "Low" | "Medium" | "High";

export type MapsExporterStrings = {
  howItWorks: string;
  howItWorksDesc: string;
  mapSelection: string;
  clientSideOnly: string;
  bboxExplanation: string;
  selectMapSource: string;
  noTileRequestsBefore: string;
  exportSettings: string;
  mapSource: string;
  noRequestsUntilChoice: string;
  tileUrlTemplate: string;
  tileUrlHelp: string;
  attributionOptional: string;
  reloadMap: string;
  loadMap: string;
  googleMapsLink: string;
  zoom: string;
  detailLevel: string;
  detailLow: string;
  detailMedium: string;
  detailHigh: string;
  detailHint: string;
  advanced: string;
  customZoomLevels: string;
  zoomFrom: string;
  zoomTo: string;
  zoomTip: string;
  selectedZooms: string;
  packName: string;
  packNameHint: string;
  estimate: string;
  area: string;
  estimatedPackSize: string;
  keepTabOpen: string;
  exportZip: string;
  exporting: string;
  downloadedTiles: string;
  failed: string;
  statusPaused: string;
  statusRunning: string;
  statusDone: string;
  statusIdle: string;
  startedOn: string;
  duration: string;
  totalDownloaded: string;
  continue: string;
  pause: string;
  stopAndPack: string;
  cancel: string;
  completed: string;
  cancelled: string;
  exportCancelled: string;
  exportFailed: string;
};

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

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return null;
}

// Reports the opening viewport once the map is up.
//
// onBounds has to keep a stable identity. getBounds() returns a fresh object
// every call, so a callback that changed each render would re-run this effect,
// set new state, and re-render for as long as the map stayed open.
function MapInitializer({ onBounds }: { onBounds: (b: LatLngBounds) => void }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    onBounds(map.getBounds());
  }, [map, onBounds]);

  return null;
}

export default function MapsExporterApp({ strings: s }: { strings: MapsExporterStrings }) {
  // Simple mode
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("Medium");

  // Advanced mode (hidden by default)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [zoomFrom, setZoomFrom] = useState(12);
  const [zoomTo, setZoomTo] = useState(14);

  // Map bbox state
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);

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

  // Stable across renders on purpose - see MapInitializer.
  const handleBounds = useCallback((b: LatLngBounds) => setBounds(b), []);

  const detailLabels: Record<DetailLevel, string> = {
    Low: s.detailLow,
    Medium: s.detailMedium,
    High: s.detailHigh,
  };

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
      return zoomRange(a, b);
    }

    if (detailLevel === "Low") return zoomRange(0, 8);
    if (detailLevel === "Medium") return zoomRange(0, 12);
    return zoomRange(0, 16); // High
  }, [detailLevel, showAdvanced, zoomFrom, zoomTo]);

  const bbox = useMemo(
    () =>
      bounds
        ? {
            south: bounds.getSouth(),
            west: bounds.getWest(),
            north: bounds.getNorth(),
            east: bounds.getEast(),
          }
        : null,
    [bounds],
  );

  const estimate = useMemo(() => {
    if (!bbox)
      return {
        areaKm2: null as number | null,
        tiles: null as number | null,
        sizeMB: null as number | null,
      };

    // Same maths the download loop uses, so the progress bar cannot disagree
    // with the estimate the user agreed to.
    const tiles = countTilesForZooms(bbox, effectiveZooms);

    // Rough average ~8.5 KB/tile based on real-world exports
    // (low-zoom tiles are tiny, vector-style providers like CARTO average 5-15 KB)
    const avgKBPerTile = 8.5;

    return {
      areaKm2: bboxAreaKm2(bbox),
      tiles,
      sizeMB: (tiles * avgKBPerTile) / 1024,
    };
  }, [bbox, effectiveZooms]);

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
    setExportError(s.cancelled);
  }

  async function exportZip() {
    if (!bbox) return;

    setExportError(null);
    setIsExporting(true);
    // Show the panel straight away, so a failure before the first tile still
    // has somewhere to appear.
    setProgress({ done: 0, total: 0 });
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
      const regionName = packName.trim() || `Maps z${effectiveZooms[0]}–${effectiveZooms[effectiveZooms.length - 1]}`;
      // A name of nothing but emoji normalises away to "", which would save
      // the pack as ".zip".
      const placeName = normalizeName(regionName) || "AnonMapsCache";

      const zip = new JSZip();
      const root = zip.folder("AnonMapsCache")!;
      const meta = {
        region: regionName,
        bbox,
        zooms: effectiveZooms,
        createdAt: new Date().toISOString(),
        tileSource: tileTemplate,
      };

      // Precompute all tile jobs (so we can show a real progress bar)
      const jobs = tileJobsForBbox(bbox, effectiveZooms);

      setProgress({ done: 0, total: jobs.length });

      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;
      const PROGRESS_EVERY = 25;

      let done = 0;
      let fetched = 0;
      let failed = 0;
      let bytes = 0;

      // Counters live in locals and are published on the same beat as the
      // progress bar; one render per tile would swamp a large export.
      const publish = () => {
        setProgress({ done, total: jobs.length });
        setFailedTiles(failed);
        setDownloadedBytes(bytes);
      };

      for (const job of jobs) {
        await waitWhilePaused();

        if (packNowRef.current) break;

        const ctrl = abortRef.current;
        if (!ctrl) throw new Error(s.exportCancelled);

        const url = buildTileUrl(tileTemplate, {
          ...job,
          s: pickSubdomain(tileSubdomains, job.x, job.y),
        });

        let ok = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            // No referrerPolicy override here: OSM's tile policy rejects
            // requests without a Referer, and the browser default already
            // keeps cross-origin referrers down to the bare origin.
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const arr = await res.arrayBuffer();

            bytes += arr.byteLength;
            root.file(`${job.z}/${job.x}/${job.y}.png`, arr);
            ok = true;
            break;
          } catch (err: any) {
            // Abort signal means user cancelled — propagate immediately
            if (err?.name === "AbortError") throw err;
            // Stopping to pack should not sit out the remaining backoff.
            if (packNowRef.current) break;
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            }
          }
        }

        if (ok) fetched++;
        else failed++;

        done++;
        if (done % PROGRESS_EVERY === 0 || done === jobs.length) {
          publish();
          await new Promise((r) => setTimeout(r, 0)); // yield to UI
        }
      }

      publish();

      // Every single tile failed - a dead source, or one whose URL template we
      // cannot fill. Say so instead of handing over an empty pack.
      if (jobs.length > 0 && fetched === 0) {
        setExportError(s.exportFailed);
        return;
      }

      // metadata file beside tile folders
      root.file("export.amd", JSON.stringify(meta, null, 2));

      const outBlob = await zip.generateAsync({ type: "blob" });

      saveAs(outBlob, `${placeName}.zip`);
    } catch (e: any) {
      // Cancelling aborts the in-flight fetch, and the browser's own wording
      // for that is not something to show the user.
      setExportError(
        e?.name === "AbortError" ? s.cancelled : (e?.message ?? s.exportFailed),
      );
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
        <div className="text-sm font-semibold text-zinc-200">{s.howItWorks}</div>
        <p className="mt-2 text-sm text-zinc-400">
          {s.howItWorksDesc}
        </p>
      </div>

      {/* Main layout: Map first on mobile */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Map selection (first on mobile) */}
        <div className="order-1 lg:order-none lg:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-zinc-200">
              {s.mapSelection}
            </div>
            <div className="text-xs text-zinc-500">{s.clientSideOnly}</div>
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            {s.bboxExplanation}
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
                    {s.selectMapSource}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {s.noTileRequestsBefore}
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
                  subdomains={tileSubdomains}
                />
                <BboxTracker onBounds={handleBounds} />
                <MapInitializer onBounds={handleBounds} />
              </MapContainer>
            )}
          </div>
        </div>

        {/* Export settings */}
        <div className="order-2 lg:order-none rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-zinc-200">
            {s.exportSettings}
          </div>

          {/* Tile source */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">
              {s.mapSource}
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              {s.noRequestsUntilChoice}
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
                  <div className="text-xs text-zinc-400">{s.tileUrlTemplate}</div>
                  <input
                    value={customTileUrl}
                    onChange={(e) => setCustomTileUrl(e.target.value)}
                    placeholder="https://example.com/tiles/{z}/{x}/{y}.png"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    {s.tileUrlHelp}
                  </p>
                </label>

                <label className="block">
                  <div className="text-xs text-zinc-400">
                    {s.attributionOptional}
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
                  {customUrlApplied ? s.reloadMap : s.loadMap}
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
                {s.googleMapsLink}
                <span aria-hidden="true">→</span>
              </a>
            )}
          </div>

          {/* Zoom section */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">{s.zoom}</div>

            <div className="mt-3">
              <div className="text-xs font-medium tracking-wide text-zinc-400">
                {s.detailLevel}
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
                    {detailLabels[lvl]}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-xs text-zinc-500">
                {s.detailHint}
              </div>
            </div>

            {/* Advanced toggle */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
              >
                {s.advanced}
                <span className="text-zinc-500">
                  {showAdvanced ? "▲" : "▼"}
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs font-medium tracking-wide text-zinc-400">
                    {s.customZoomLevels}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-xs text-zinc-400">{s.zoomFrom}</div>
                      <select
                        value={zoomFrom}
                        onChange={(e) => setZoomFrom(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                      >
                        {Array.from({ length: MAX_ZOOM + 1 }, (_, i) => i).map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <div className="text-xs text-zinc-400">{s.zoomTo}</div>
                      <select
                        value={zoomTo}
                        onChange={(e) => setZoomTo(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none"
                      >
                        {Array.from({ length: MAX_ZOOM + 1 }, (_, i) => i).map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <p className="mt-3 text-xs text-zinc-500">
                    {s.zoomTip}
                  </p>
                </div>
              )}
            </div>

            {/* Selected zooms */}
            <div className="mt-4 text-xs text-zinc-400">
              {s.selectedZooms}{" "}
              <span className="font-mono text-zinc-200">
                {effectiveZooms.join(" ")}
              </span>
            </div>
          </div>

          {/* Pack name */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold text-zinc-200">
              {s.packName}
            </div>
            <input
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              placeholder={`Maps z${effectiveZooms[0]}–${effectiveZooms[effectiveZooms.length - 1]}`}
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <p className="mt-2 text-xs text-zinc-500">
              {s.packNameHint}
            </p>
          </div>

          {/* Estimate + warnings (after zoom) */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-zinc-200">{s.estimate}</div>

            <div className="mt-2 text-sm text-zinc-400">
              <div>
                {s.area} <span className="text-zinc-200">{estimatedAreaText}</span>
              </div>
              <div className="mt-1">
                {s.estimatedPackSize}{" "}
                <span className="text-zinc-200">{estimatedSizeText}</span>
              </div>
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              {s.keepTabOpen}
            </p>
          </div>

          {/* Export */}
          <button
            type="button"
            disabled={!bounds || !isTileSourceSelected || isExporting}
            onClick={exportZip}
            className={[
              "mt-4 w-full rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-white/10",
              !bounds || !isTileSourceSelected || isExporting
                ? "bg-white/10 text-zinc-300 opacity-60"
                : "bg-white/15 text-white hover:bg-white/20",
            ].join(" ")}
          >
            {isExporting ? s.exporting : s.exportZip}
          </button>
        </div>
      </div>

      {progress && (
        <div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
            <div className="flex items-center justify-between gap-3">
              <div className="text-zinc-400">
                <span className="text-zinc-200">
                  {Math.floor(
                    (progress.done / Math.max(1, progress.total)) * 100,
                  )}
                  %
                </span>{" "}
                — {s.downloadedTiles}{" "}
                <span className="text-zinc-200">{progress.done}</span> /{" "}
                {progress.total}
                {failedTiles > 0 && (
                  <>
                    {" "}— {s.failed}{" "}
                    <span className="text-red-300">{failedTiles}</span>
                  </>
                )}
              </div>

              <div className="text-zinc-500">
                {isPaused ? s.statusPaused : isExporting ? s.statusRunning : endedAt ? s.statusDone : s.statusIdle}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-1 text-zinc-400">
              <div>
                {s.startedOn}{" "}
                <span className="text-zinc-200">
                  {startedAt ? fmtTime(startedAt) : "—"}
                </span>
              </div>
              <div>
                {s.duration}{" "}
                <span className="text-zinc-200">
                  {startedAt
                    ? fmtDuration((endedAt ?? new Date()).getTime() - startedAt.getTime())
                    : "—"}
                </span>
              </div>
              <div>
                {s.totalDownloaded}{" "}
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
                {isPaused ? s.continue : s.pause}
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
                {s.stopAndPack}
              </button>

              {isExporting ? (
                <button
                  type="button"
                  onClick={cancelExport}
                  className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-medium text-red-100 ring-1 ring-red-500/30 hover:bg-red-500/20"
                >
                  {s.cancel}
                </button>
              ) : exportError ? (
                <div className="flex items-center justify-center rounded-xl bg-red-500/10 px-3 py-2 text-center text-xs font-semibold text-red-200 ring-1 ring-red-500/30">
                  {exportError}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/30">
                  {s.completed}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
