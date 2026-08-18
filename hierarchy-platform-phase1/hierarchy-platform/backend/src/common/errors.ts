// Structured error codes per master spec §44. Extend this union as new
// modules need new codes — do not throw ad-hoc strings.
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "ALREADY_EXISTS"
  | "USER_INACTIVE"
  | "INVALID_CREDENTIALS"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  USER_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ALREADY_EXISTS: 409,
  USER_INACTIVE: 403,
  INVALID_CREDENTIALS: 401,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
