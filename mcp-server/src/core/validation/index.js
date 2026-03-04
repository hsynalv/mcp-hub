/**
 * Centralized validation helper.
 * Returns parsed data or sends 400 and returns null.
 */

/**
 * Validates body against a Zod schema.
 * On success: returns parsed data.
 * On failure: sends 400 JSON with { ok, error, details } and returns null.
 */
export function validate(schema, body, res) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  res.status(400).json({
    ok:      false,
    error:   "validation_error",
    message: "Validation failed",
    details: result.error.flatten(),
  });
  return null;
}
