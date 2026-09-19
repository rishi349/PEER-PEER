import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't await async handlers, so a rejected promise becomes an
// unhandled rejection instead of hitting the error middleware. This wraps
// every controller so `throw new AppError(...)` just works.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
