import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Point, ZoneInfo } from "../data";

/** Zone maps are 3:2. Game coordinates run 0-100 on both axes, from the top left. */
const WIDTH = 150;
const HEIGHT = 100;
const BOUNDS: L.LatLngBoundsExpression = [
  [-HEIGHT, 0],
  [0, WIDTH],
];
const at = (p: Point): L.LatLngExpression => [-p[1], (p[0] * WIDTH) / 100];
const toPoint = (ll: L.LatLng): Point => [(ll.lng * 100) / WIDTH, -ll.lat];

/**
 * Where zone map images come from, tried in order: this site's own
 * `maps/<zone id>.jpg`, then VITE_MAP_URL (a template with `{id}`), if set.
 * Without an image the map still works on a plain grid.
 */
function mapSources(zone: ZoneInfo): string[] {
  const remote = import.meta.env.VITE_MAP_URL as string | undefined;
  return [`${import.meta.env.BASE_URL}maps/${zone.id}.jpg`, ...(remote ? [remote.replace("{id}", String(zone.id))] : [])];
}

export interface Pin {
  key: string;
  point: Point;
  kind: "available" | "start" | "end" | "objective" | "service";
  label: string;
  onClick?: () => void;
}

export interface RouteStop {
  index: number;
  point: Point;
  label: string;
}

interface Props {
  zone: ZoneInfo;
  pins: Pin[];
  stops: RouteStop[];
  selectedStop: number | null;
  placing: boolean;
  onSelectStop: (index: number) => void;
  onPlace: (point: Point) => void;
}

const GLYPH: Record<Pin["kind"], string> = { available: "!", start: "!", end: "?", objective: "", service: "" };

export function MapView({ zone, pins, stops, selectedStop, placing, onSelectStop, onPlace }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ image?: L.ImageOverlay; pins: L.LayerGroup; route: L.LayerGroup } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hasImage, setHasImage] = useState(true);
  const handlers = useRef({ onPlace, onSelectStop, placing });
  handlers.current = { onPlace, onSelectStop, placing };

  useEffect(() => {
    const m = L.map(el.current!, {
      crs: L.CRS.Simple,
      minZoom: 1,
      maxZoom: 6,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      maxBounds: [
        [-HEIGHT - 30, -30],
        [30, WIDTH + 30],
      ],
      attributionControl: false,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    m.fitBounds(BOUNDS);
    layers.current = { pins: L.layerGroup().addTo(m), route: L.layerGroup().addTo(m) };
    m.on("mousemove", (e) => {
      const p = toPoint(e.latlng);
      setCursor(p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= 100 ? p : null);
    });
    m.on("mouseout", () => setCursor(null));
    m.on("click", (e) => {
      const p = toPoint(e.latlng);
      if (handlers.current.placing && p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= 100) handlers.current.onPlace(p);
    });
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current!);
    map.current = m;
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // the zone's image
  useEffect(() => {
    const m = map.current!;
    const sources = mapSources(zone);
    let cancelled = false;
    layers.current!.image?.remove();
    layers.current!.image = undefined;
    setHasImage(true);
    const attempt = (i: number) => {
      const url = sources[i];
      if (!url) return setHasImage(false);
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        layers.current!.image = L.imageOverlay(url, BOUNDS, { className: "zone-image" }).addTo(m).bringToBack();
      };
      img.onerror = () => !cancelled && attempt(i + 1);
      img.src = url;
    };
    attempt(0);
    m.fitBounds(BOUNDS, { animate: false });
    return () => {
      cancelled = true;
    };
  }, [zone]);

  useEffect(() => {
    const group = layers.current!.pins;
    group.clearLayers();
    for (const pin of pins) {
      const size = pin.kind === "objective" ? 10 : pin.kind === "available" ? 18 : 24;
      const marker = L.marker(at(pin.point), {
        icon: L.divIcon({ className: "", html: `<span class="pin pin-${pin.kind}">${GLYPH[pin.kind]}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: pin.kind === "available" ? 0 : pin.kind === "objective" ? 100 : 300,
        keyboard: false,
      });
      marker.bindTooltip(pin.label, { direction: "top", offset: [0, -size / 2], className: "map-tip" });
      if (pin.onClick) marker.on("click", pin.onClick);
      marker.addTo(group);
    }
  }, [pins]);

  useEffect(() => {
    const group = layers.current!.route;
    group.clearLayers();
    if (stops.length > 1) {
      L.polyline(stops.map((s) => at(s.point)), { className: "route-line-shadow", interactive: false }).addTo(group);
      L.polyline(stops.map((s) => at(s.point)), { className: "route-line", interactive: false }).addTo(group);
    }
    for (const stop of stops) {
      const selected = stop.index === selectedStop;
      L.marker(at(stop.point), {
        icon: L.divIcon({ className: "", html: `<span class="stop${selected ? " stop-selected" : ""}">${stop.index + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        zIndexOffset: selected ? 1000 : 500,
        keyboard: false,
      })
        .bindTooltip(stop.label, { direction: "top", offset: [0, -13], className: "map-tip" })
        .on("click", () => handlers.current.onSelectStop(stop.index))
        .addTo(group);
    }
  }, [stops, selectedStop]);

  // bring the selected stop into view
  useEffect(() => {
    const stop = stops.find((s) => s.index === selectedStop);
    const m = map.current!;
    if (stop && !m.getBounds().pad(-0.15).contains(at(stop.point))) m.panTo(at(stop.point));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStop]);

  return (
    <div className={`map-wrap${placing ? " placing" : ""}${hasImage ? "" : " no-image"}`}>
      <div ref={el} className="map" />
      <div className="map-title">
        <strong>{zone.name}</strong>
        {zone.levels && <span>Levels {zone.levels[0] === zone.levels[1] ? zone.levels[0] : `${zone.levels[0]}-${zone.levels[1]}`}</span>}
      </div>
      {cursor && (
        <div className="map-coords">
          {cursor[0].toFixed(1)}, {cursor[1].toFixed(1)}
        </div>
      )}
      {placing && <div className="map-hint">Click the map to place a waypoint</div>}
    </div>
  );
}
