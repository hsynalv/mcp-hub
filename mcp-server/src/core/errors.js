export class AppError extends Error {
  constructor(message, statusCode = 500, code = "internal_error") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "AppError";
  }

  serialize() {
    return { ok: false, error: this.code, message: this.message };
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
