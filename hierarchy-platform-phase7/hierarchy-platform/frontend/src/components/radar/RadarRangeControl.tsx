import { formatDistance } from "./radarMath";
import "./RadarRangeControl.css";

const MIN_METERS = 100;
const MAX_METERS = 2000;
const STEP_METERS = 100;

interface RadarRangeControlProps {
  rangeMeters: number;
  onChange: (rangeMeters: number) => void;
}

// Master spec §39: "Range: 500m" — a purely client-side display setting
// (radarStore.ts's own comment explains why the backend is never told
// about this). Widening/narrowing range only rescales where markers
// land on the face and which ones render as clipped (radarMath.ts's
// getRadarPosition), never which users are in the response at all.
export function RadarRangeControl({ rangeMeters, onChange }: RadarRangeControlProps) {
  return (
    <div className="radar-range">
      <span className="radar-range__label">Range: {formatDistance(rangeMeters)}</span>
      <input
        type="range"
        min={MIN_METERS}
        max={MAX_METERS}
        step={STEP_METERS}
        value={rangeMeters}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Radar range"
      />
    </div>
  );
}
