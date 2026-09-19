import type { RadarVisibleUser } from "../../api/radar";
import type { RadarPosition } from "./radarMath";

const ROLE_VAR: Record<string, string> = {
  ROOT_LEADER: "var(--role-root)",
  LEADER: "var(--role-leader)",
  PEER: "var(--role-peer)",
};

interface RadarUserMarkerProps {
  user: RadarVisibleUser;
  position: RadarPosition;
  selected: boolean;
  onSelect: (userId: string) => void;
}

/**
 * Purely presentational — every number it draws (`position.x/y`) was
 * already computed by radarMath.ts's getRadarPosition. This component
 * makes zero distance/bearing/authorization decisions of its own
 * (master spec §38: "keep calculations independent from rendering").
 */
export function RadarUserMarker({ user, position, selected, onSelect }: RadarUserMarkerProps) {
  const dimmed = user.presence.status === "OFFLINE" || user.stale;
  const color = ROLE_VAR[user.role] ?? "var(--signal)";

  return (
    <g
      className={`radar-marker ${selected ? "radar-marker--selected" : ""}`}
      transform={`translate(${position.x}, ${position.y})`}
      onClick={() => onSelect(user.id)}
      role="button"
      tabIndex={0}
      aria-label={`${user.name}, ${user.role}, ${formatMarkerState(user)}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(user.id);
      }}
    >
      {selected && <circle className="radar-marker__ring" r={11} fill="none" />}
      <circle
        className="radar-marker__dot"
        r={6}
        fill={color}
        opacity={dimmed ? 0.4 : 1}
        stroke={position.clipped ? "var(--text-tertiary)" : "none"}
        strokeDasharray={position.clipped ? "2 2" : undefined}
      />
      <text className="radar-marker__label" y={-12} textAnchor="middle">
        {user.name}
      </text>
    </g>
  );
}

function formatMarkerState(user: RadarVisibleUser): string {
  if (user.presence.status === "OFFLINE") return "offline";
  if (user.stale) return "stale position";
  return "online";
}
