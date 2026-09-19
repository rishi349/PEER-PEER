import Redis from "ioredis";
import { env } from "./env";

// Wired up per the Phase 1 foundation requirement, but not used for any
// application logic yet. Presence, heartbeats, transient location, and
// Socket.IO coordination start in Phase 4 — see docs/PHASES.md.
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
