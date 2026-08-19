import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { errorHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { hierarchyRouter } from "./modules/hierarchy/hierarchy.routes";
import { usersRouter } from "./modules/users/users.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true, // required so the refresh-token cookie is sent
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
    ]);

    const healthy = dbOk && redisOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      postgres: dbOk ? "up" : "down",
      redis: redisOk ? "up" : "down",
    });
  });

  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use("/hierarchy", hierarchyRouter);

  // 404 for anything unmatched, before the error handler.
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  app.use(errorHandler);

  return app;
}
