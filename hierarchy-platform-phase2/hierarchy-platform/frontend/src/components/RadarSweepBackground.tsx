import "./RadarSweepBackground.css";

// The one deliberate flourish in this UI (per design guidance: spend the
// boldness in one place). It foreshadows the actual Radar feature
// (master spec §17-19) long before Phase 7 builds it — three range
// rings and a slow rotating sweep, entirely decorative here, behind the
// auth card.
export function RadarSweepBackground() {
  return (
    <div className="radar-bg" aria-hidden="true">
      <svg viewBox="0 0 600 600" className="radar-bg__svg">
        <circle cx="300" cy="300" r="120" className="radar-bg__ring" />
        <circle cx="300" cy="300" r="220" className="radar-bg__ring" />
        <circle cx="300" cy="300" r="300" className="radar-bg__ring radar-bg__ring--faint" />
        <line x1="300" y1="0" x2="300" y2="600" className="radar-bg__crosshair" />
        <line x1="0" y1="300" x2="600" y2="300" className="radar-bg__crosshair" />
        <g className="radar-bg__sweep-group">
          <path
            d="M 300 300 L 300 0 A 300 300 0 0 1 559.8 152.5 Z"
            className="radar-bg__sweep"
          />
        </g>
      </svg>
    </div>
  );
}
