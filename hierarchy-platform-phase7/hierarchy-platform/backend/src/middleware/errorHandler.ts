import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/errors";
import { env } from "../config/env";

// Must be registered last. Never leaks stack traces or internal error
// messages to the client (master spec §44/§45) — those go to the server
// log only.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  console.error("[unhandled error]", err);

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      ...(env.NODE_ENV === "development" && err instanceof Error
        ? { details: err.message }
        : {}),
    },
  });
}
