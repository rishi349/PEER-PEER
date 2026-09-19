import type { RadarVisibleUser } from "../../api/radar";
import { RolePill } from "../RolePill";
import { bearingToCompass, formatDistance } from "./radarMath";
import "./RadarUserDetails.css";

interface RadarUserDetailsProps {
  user: RadarVisibleUser | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function locationReasonText(reason: "REQUESTER_LOCATION_UNAVAILABLE" | "TARGET_LOCATION_UNAVAILABLE"): string {
  // Same two reasons location.service.ts's getDistanceAndBearing can
  // return (master spec §17/§19, PHASE6_PLAN.md §2b) — surfaced here
  // exactly as-is rather than the frontend inventing its own wording
  // for a server-decided fact (master spec §41: frontend is never
  // authoritative).
  if (reason === "REQUESTER_LOCATION_UNAVAILABLE") {
    return "Turn on your own location sharing to see this.";
  }
  return "This person isn't currently sharing their location.";
}

export function RadarUserDetails({ user }: RadarUserDetailsProps) {
  if (!user) {
    return (
      <div className="radar-details radar-details--empty">
        Select a marker for details.
      </div>
    );
  }

  return (
    <div className="radar-details">
      <div className="radar-details__header">
        <span className="radar-details__name">{user.name}</span>
        <RolePill role={user.role} />
      </div>

      <div className="radar-details__row">
        <span className="radar-details__label">Relation</span>
        <span className="radar-details__value">
          {user.relation === "ANCESTOR" ? "Your leader" : "In your subgroup"}
        </span>
      </div>

      <div className="radar-details__row">
        <span className="radar-details__label">Connection</span>
        <span className="radar-details__value">
          <span
            className={`radar-details__dot ${
              user.presence.status === "ONLINE" ? "radar-details__dot--online" : ""
            }`}
          />
          {user.presence.status === "ONLINE" ? "Online" : `Offline (last seen ${timeAgo(user.presence.lastSeen)})`}
        </span>
      </div>

      <div className="radar-details__row">
        <span className="radar-details__label">Position</span>
        <span className="radar-details__value">
          {user.location.available ? (
            <>
              {formatDistance(user.location.distanceMeters)} {bearingToCompass(user.location.bearingDegrees)}
              {user.stale && <span className="radar-details__stale">stale</span>}
            </>
          ) : (
            locationReasonText(user.location.reason)
          )}
        </span>
      </div>
    </div>
  );
}
