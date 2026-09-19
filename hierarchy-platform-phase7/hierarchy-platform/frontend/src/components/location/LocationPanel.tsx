import { useEffect } from "react";
import { useLocationSharing } from "../../hooks/useLocationSharing";
import { useLocationStore } from "../../state/locationStore";
import "./LocationPanel.css";

// Minimal slice only, per PHASE6_PLAN.md §2d/§3: a toggle for the opt-in
// preference and the send-loop status. No distance, no bearing, no map —
// that's Phase 7's radar component tree (master spec §38), which this
// panel produces clean backend data for but does not attempt to
// visualize itself.

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function LocationPanel() {
  const {
    sharingEnabled,
    isLoadingPreference,
    isSendingUpdate,
    lastUpdatedAt,
    error,
    fetchSharingPreference,
    toggleSharing,
    clearError,
  } = useLocationStore();

  useEffect(() => {
    fetchSharingPreference();
  }, [fetchSharingPreference]);

  // Gated on the confirmed server preference, not a local optimistic
  // toggle state — sharingEnabled only flips once toggleSharing's PATCH
  // call actually succeeds (locationStore.ts), so this hook never fires
  // navigator.geolocation ahead of what the backend has on record.
  useLocationSharing(sharingEnabled);

  async function handleToggle() {
    clearError();
    await toggleSharing(!sharingEnabled);
  }

  return (
    <section className="location-panel">
      <div className="location-panel__header">
        <p className="dashboard__section-heading">Location sharing</p>
        <button
          className={`location-toggle ${sharingEnabled ? "location-toggle--on" : ""}`}
          type="button"
          role="switch"
          aria-checked={sharingEnabled}
          aria-label="Toggle location sharing"
          disabled={isLoadingPreference}
          onClick={handleToggle}
        >
          <span className="location-toggle__thumb" />
        </button>
      </div>

      <p className="location-panel__desc">
        {sharingEnabled
          ? "Your position is visible to your direct parent and your authorized subgroup only — never just because someone is nearby."
          : "Off by default. Nobody can see your position until you turn this on."}
      </p>

      {sharingEnabled && (
        <div className="location-panel__status">
          <span className={`location-panel__dot ${isSendingUpdate ? "location-panel__dot--pulse" : ""}`} />
          Last sent {timeAgo(lastUpdatedAt)}
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
