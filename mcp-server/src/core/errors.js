export class AppError extends Error {
  constructor(message, statusCode = 500, code = "internal_error", details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }

  serialize(requestId = null) {
    const out = { ok: false, error: this.code, message: this.message };
    if (this.details != null) out.details = this.details;
    if (requestId) out.requestId = requestId;
    return out;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(message, 400, "validation_error");
    this.name = "ValidationError";
  }
}
