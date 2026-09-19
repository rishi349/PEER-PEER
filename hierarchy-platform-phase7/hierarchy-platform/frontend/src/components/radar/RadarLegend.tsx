import "./RadarLegend.css";

export function RadarLegend() {
  return (
    <div className="radar-legend">
      <span className="radar-legend__item">
        <span className="radar-legend__dot" style={{ background: "var(--role-root)" }} />
        Root leader
      </span>
      <span className="radar-legend__item">
        <span className="radar-legend__dot" style={{ background: "var(--role-leader)" }} />
        Leader
      </span>
      <span className="radar-legend__item">
        <span className="radar-legend__dot" style={{ background: "var(--role-peer)" }} />
        Peer
      </span>
      <span className="radar-legend__item">
        <span className="radar-legend__dot radar-legend__dot--dim" />
        Offline / stale
      </span>
    </div>
  );
}
