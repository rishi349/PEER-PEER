import type { CookieOptions, Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { env } from "../../config/env";
import { loginSchema, registerSchema } from "./auth.schemas";
import * as authService from "./auth.service";
import type { TokenPair } from "./auth.service";

const REFRESH_COOKIE_NAME = "refresh_token";

// The refresh token lives in an httpOnly cookie so it's never reachable
// from JS (mitigates XSS token theft). The access token is returned in
// the JSON body and kept in memory on the client — see master spec §29's
// spirit of "don't leave long-lived secrets sitting in localStorage,"
// applied here to bearer tokens even though that section is about device
// key material specifically.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/auth",
  maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res: Response, tokens: TokenPair): void {
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, cookieOptions);
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/auth" });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const { user, tokens } = await authService.register(input);
  setRefreshCookie(res, tokens);
  res.status(201).json({ user, accessToken: tokens.accessToken });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const { user, tokens } = await authService.login(input);
  setRefreshCookie(res, tokens);
  res.status(200).json({ user, accessToken: tokens.accessToken });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No refresh token" } });
    return;
  }

  const { user, tokens } = await authService.refresh(token);
  setRefreshCookie(res, tokens);
  res.status(200).json({ user, accessToken: tokens.accessToken });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(token);
  clearRefreshCookie(res);
  res.status(204).send();
});
