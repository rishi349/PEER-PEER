import { createApp } from "./app";
import { env } from "./config/env";
import { redis } from "./config/redis";

async function main() {
  await redis.connect().catch((err) => {
    // Don't crash the whole API because Redis isn't up yet in Phase 1 —
    // it isn't load-bearing for any route yet. /health will report it.
    console.warn("[redis] initial connection failed:", (err as Error).message);
  });

  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
