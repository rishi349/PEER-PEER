import http from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { redis } from "./config/redis";
import { initSocketIO } from "./config/socket";
import { startPresenceExpiryListener } from "./modules/presence/presence.keyspaceListener";

async function main() {
  await redis.connect().catch((err) => {
    // Don't crash the whole API because Redis isn't up yet — Phase 4
    // now actually depends on it functionally (presence), but the
    // startup posture stays the same as Phase 1: log and keep booting.
    // /health reports Redis status; presence reads/writes will simply
    // fail (caught at the call sites) until Redis becomes reachable.
    console.warn("[redis] initial connection failed:", (err as Error).message);
  });

  const app = createApp();

  // Socket.IO needs the raw http.Server, not just the Express app, so
  // it can upgrade connections — this is the one thing that changes
  // about how the app boots in Phase 4.
  const httpServer = http.createServer(app);

  await initSocketIO(httpServer);
  await startPresenceExpiryListener();

  httpServer.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
