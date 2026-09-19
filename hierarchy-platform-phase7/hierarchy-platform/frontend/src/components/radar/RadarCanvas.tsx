import type { RadarVisibleUser } from "../../api/radar";
import { getRadarPosition } from "./radarMath";
import { RadarUserMarker } from "./RadarUserMarker";
import "./RadarCanvas.css";

const VIEWBOX_SIZE = 400;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS_PX = 170;

/**
 * No device-compass input exists yet (master spec §39 lists
 * "orientation" as a radar UI control) — every marker in this phase is
 * placed as if the radar face is fixed north-up. Kept as an explicit
 * constant rather than removing the parameter from getRadarPosition
 * entirely, so wiring up a real orientation source later (compass,
 * manual rotation control) only means changing this one value, not
 * radarMath.ts's signature.
 */
const ORIENTATION_DEGREES = 0;

interface RadarCanvasProps {
  users: RadarVisibleUser[];
  rangeMeters: number;
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
}

export function RadarCanvas({ users, rangeMeters, selectedUserId, onSelectUser }: RadarCanvasProps) {
  // Only users with an actual available location result can be placed
  // spatially at all (master spec §17: no coordinates, no position).
  // Everyone else — sharing off, no recent reading, requester hasn't
  // shared their own location yet — is surfaced separately by
  // RadarContainer's "off radar" list, not silently dropped.
  const positionable = users.filter((u) => u.location.available);

  return (
    <div className="radar-canvas">
      <svg viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} className="radar-canvas__svg">
        <g transform={`translate(${CENTER}, ${CENTER})`}>
          <circle r={RADIUS_PX} className="radar-canvas__ring" />
          <circle r={(RADIUS_PX * 2) / 3} className="radar-canvas__ring radar-canvas__ring--dim" />
          <circle r={RADIUS_PX / 3} className="radar-canvas__ring radar-canvas__ring--dim" />
          <line x1={0} y1={-RADIUS_PX} x2={0} y2={RADIUS_PX} className="radar-canvas__crosshair" />
          <line x1={-RADIUS_PX} y1={0} x2={RADIUS_PX} y2={0} className="radar-canvas__crosshair" />

          <g className="radar-canvas__sweep-group">
            <path
              d={`M 0 0 L 0 ${-RADIUS_PX} A ${RADIUS_PX} ${RADIUS_PX} 0 0 1 ${(
                RADIUS_PX * Math.sin((60 * Math.PI) / 180)
              ).toFixed(1)} ${(-RADIUS_PX * Math.cos((60 * Math.PI) / 180)).toFixed(1)} Z`}
              className="radar-canvas__sweep"
            />
          </g>

          {positionable.map((user) => {
            const location = user.location;
            if (!location.available) return null; // narrows the type; filtered above already
            const position = getRadarPosition(
              location.distanceMeters,
              location.bearingDegrees,
              rangeMeters,
              ORIENTATION_DEGREES,
              RADIUS_PX
            );
            return (
              <RadarUserMarker
                key={user.id}
                user={user}
                position={position}
                selected={selectedUserId === user.id}
                onSelect={onSelectUser}
              />
            );
          })}

          <circle r={7} className="radar-canvas__you-ring" fill="none" />
          <circle r={4} className="radar-canvas__you-dot" />
          <text y={20} textAnchor="middle" className="radar-canvas__you-label">
            YOU
          </text>
        </g>
      </svg>
    </div>
  );
}
