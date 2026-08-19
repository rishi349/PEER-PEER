import { redis } from "../../config/redis";
import * as presenceService from "./presence.service";
import { PRESENCE_KEY_PREFIX } from "./presence.repository";

// The Redis DB index config/redis.ts's client connects to — it passes no
// `db` option, so this is ioredis's (and Redis's) default index 0. If
// that ever changes, this channel name must change with it.
const REDIS_DB_INDEX = 0;
const EXPIRED_CHANNEL = `__keyevent@${REDIS_DB_INDEX}__:expired`;

let started = false;

/**
 * Master spec §22: "If the heartbeat expires: TTL expires -> presence
 * becomes stale/offline -> event generated ... Do not rely only on
 * clean disconnect events." Redis keyspace notifications are the
 * mechanism for that "event generated" step: a dedicated subscriber
 * connection (subscriber mode occupies a connection exclusively, hence
 * `.duplicate()` rather than reusing the shared client) listens for
 * `expired` key events and forwards any `presence:*` key to
 * presenceService.handleTTLExpiry, which broadcasts the OFFLINE
 * transition the same way a clean disconnect would.
 *
 * `notify-keyspace-events` is a server-wide Redis setting, off by
 * default. This function attempts to turn it on via CONFIG SET at
 * startup — best-effort: some managed Redis providers disable CONFIG
 * SET entirely (it throws in that case), in which case this logs a
 * warning and the app keeps running. **If that happens, TTL-expiry
 * *push* events will not fire in real time — but correctness is not
 * lost**: presence.service.ts's getSnapshotForActor (used by both
 * GET /presence and the connect-time snapshot) reads an expired key as
 * simply absent = OFFLINE regardless of whether this listener is
 * running. Only the proactive "tell already-connected clients someone
 * just went stale" push depends on this succeeding. Verified locally
 * against the project's own `redis:7-alpine` docker-compose service,
 * where CONFIG SET is unrestricted — not verified against any managed
 * Redis provider.
 */
export async function startPresenceExpiryListener(): Promise<void> {
  if (started) return;
  started = true;

  try {
    await redis.config("SET", "notify-keyspace-events", "Ex");
  } catch (err) {
    console.warn(
      "[presence] could not enable Redis keyspace notifications (CONFIG SET may be restricted on this Redis instance) — TTL-expiry push events will not fire; GET /presence and connect-time snapshots remain correct regardless:",
      (err as Error).message
    );
  }

  try {
    const subscriber = redis.duplicate();
    subscriber.on("error", (err) => {
      console.error("[presence] keyspace subscriber connection error:", err.message);
    });

    await subscriber.subscribe(EXPIRED_CHANNEL);
    subscriber.on("message", (channel: string, expiredKey: string) => {
      if (channel !== EXPIRED_CHANNEL) return;
      if (!expiredKey.startsWith(PRESENCE_KEY_PREFIX)) return; // not a presence key — ignore

      const userId = expiredKey.slice(PRESENCE_KEY_PREFIX.length);
      presenceService.handleTTLExpiry(userId).catch((err) => {
        console.error(`[presence] TTL-expiry handling failed for user ${userId}:`, (err as Error).message);
      });
    });
  } catch (err) {
    console.error(
      "[presence] failed to start the keyspace-expiry subscriber — TTL-expiry push events will not fire:",
      (err as Error).message
    );
  }
}
