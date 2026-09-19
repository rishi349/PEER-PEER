import { useEffect, useRef } from "react";
import { useLocationStore } from "../state/locationStore";

// PHASE6_PLAN.md §2c: send roughly every 20s while sharing is enabled —
// not on every watchPosition callback (fires far more often, wasteful),
// and not only on "significant movement" (simpler to implement
// correctly, avoids having to define what counts as significant). A
// plain setInterval + getCurrentPosition is the simplest thing that's
// correct, so that's what this does rather than watchPosition.
const UPDATE_INTERVAL_MS = 20_000;

/**
 * Wires navigator.geolocation into locationStore's sendLocationUpdate,
 * entirely gated on `enabled`. Deliberately does not call any browser
 * geolocation API at all while `enabled` is false — both for privacy and
 * because most browsers prompt for permission on the first call, which
 * should only ever happen after explicit opt-in (PHASE6_PLAN.md §3),
 * never on page load or before the real server-confirmed preference has
 * loaded. Callers should pass the *confirmed* `sharingEnabled` value from
 * locationStore, not a local optimistic guess — see LocationPanel.tsx.
 */
export function useLocationSharing(enabled: boolean): void {
  const sendLocationUpdate = useLocationStore((s) => s.sendLocationUpdate);
  const setGeolocationError = useLocationStore((s) => s.setGeolocationError);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    function stop() {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    if (!enabled) {
      stop();
      return;
    }

    if (!("geolocation" in navigator)) {
      setGeolocationError("This browser does not support location sharing.");
      return;
    }

    function captureAndSend() {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void sendLocationUpdate({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (err) => {
          setGeolocationError(err.message || "Could not read your current location.");
        },
        { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 }
      );
    }

    captureAndSend(); // first reading immediately, not after a full 20s wait
    intervalRef.current = window.setInterval(captureAndSend, UPDATE_INTERVAL_MS);

    return stop;
  }, [enabled, sendLocationUpdate, setGeolocationError]);
}
