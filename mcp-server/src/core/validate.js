import { ZodError } from "zod";

function validationErrorPayload(error) {
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: "Validation failed",
        details: error.flatten(),
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "validation_error",
      message: "Validation failed",
    },
  };
}

export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorPayload(parsed.error));
    }
    req.validatedBody = parsed.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(validationErrorPayload(parsed.error));
    }
    req.validatedQuery = parsed.data;
    next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json(validationErrorPayload(parsed.error));
    }
    req.validatedParams = parsed.data;
    next();
  };
}
