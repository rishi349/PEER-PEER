import type { RadarFilter } from "../../api/radar";
import "./RadarControls.css";

const FILTERS: RadarFilter[] = ["LEADERS", "PEERS", "ALL"];

interface RadarControlsProps {
  filter: RadarFilter;
  onChange: (filter: RadarFilter) => void;
}

// Master spec §18/§39: "Show: [ Leaders | Peers | All ]". The filter
// itself is applied server-side (radar.service.ts's matchesFilter) —
// this component only reflects/requests the choice, it never filters
// `users` client-side (master spec §41: the frontend is never
// authoritative).
export function RadarControls({ filter, onChange }: RadarControlsProps) {
  return (
    <div className="radar-controls" role="tablist" aria-label="Radar role filter">
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={filter === f}
          className={`radar-controls__button ${filter === f ? "radar-controls__button--active" : ""}`}
          onClick={() => onChange(f)}
        >
          {label(f)}
        </button>
      ))}
    </div>
  );
}

function label(f: RadarFilter): string {
  if (f === "LEADERS") return "Leaders";
  if (f === "PEERS") return "Peers";
  return "All";
}
