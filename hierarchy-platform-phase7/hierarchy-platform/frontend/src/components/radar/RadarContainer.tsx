import { useEffect } from "react";
import { useRadarStore } from "../../state/radarStore";
import { RadarCanvas } from "./RadarCanvas";
import { RadarControls } from "./RadarControls";
import { RadarLegend } from "./RadarLegend";
import { RadarRangeControl } from "./RadarRangeControl";
import { RadarUserDetails } from "./RadarUserDetails";
import "./RadarContainer.css";

// PHASE6_PLAN.md §4 open question 2, resolved for Phase 7 (see
// radarStore.ts's own comment): poll on this cadence while the radar
// screen is mounted, rather than building a push (Socket.IO) layer on
// top of location's pull-only endpoint. 5s is deliberately shorter than
// location's own ~20s update cadence and presence's 30s TTL — it's
// fast enough that a stale/offline transition or a role/hierarchy
// change feels near-real-time without needing a live socket, and cheap
// enough for a screen a user is actively looking at (unlike, e.g.,
// location's own background-tab cadence, which favors battery life).
// A guess, not a measurement — same standing caveat every interval
// constant in this project carries; tune once this is used against a
// live stack.
const POLL_INTERVAL_MS = 5000;

export function RadarContainer() {
  const {
    filter,
    rangeMeters,
    snapshot,
    selectedUserId,
    isLoading,
    error,
    setFilter,
    setRange,
    selectUser,
    fetchSnapshot,
  } = useRadarStore();

  useEffect(() => {
    void fetchSnapshot();
    const interval = window.setInterval(() => void fetchSnapshot(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // Intentionally only on mount — filter changes call fetchSnapshot
    // themselves (radarStore.ts's setFilter), so this effect doesn't
    // need `filter` as a dependency; re-adding it would just restart
    // the poll interval on every filter change for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const users = snapshot?.users ?? [];
  const offRadar = users.filter((u) => !u.location.available);
  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div className="radar-container">
      <div className="radar-container__toolbar">
        <RadarControls filter={filter} onChange={setFilter} />
        <RadarRangeControl rangeMeters={rangeMeters} onChange={setRange} />
      </div>

      {error && <div className="form-error radar-container__error">{error}</div>}

      <div className="radar-container__layout">
        <RadarCanvas
          users={users}
          rangeMeters={rangeMeters}
          selectedUserId={selectedUserId}
          onSelectUser={selectUser}
        />

        <div className="radar-container__side">
          <RadarUserDetails user={selectedUser} />

          {offRadar.length > 0 && (
            <div className="radar-container__off-radar">
              <p className="radar-container__off-radar-heading">Off radar ({offRadar.length})</p>
              <ul className="radar-container__off-radar-list">
                {offRadar.map((u) => (
                  <li
                    key={u.id}
                    className={selectedUserId === u.id ? "radar-container__off-radar-item--selected" : ""}
                    onClick={() => selectUser(u.id)}
                  >
                    {u.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <RadarLegend />

      {isLoading && !snapshot && <p className="radar-container__loading">Loading radar…</p>}
      {snapshot && users.length === 0 && (
        <p className="radar-container__empty">Nobody is currently visible for this filter.</p>
      )}
    </div>
  );
}
