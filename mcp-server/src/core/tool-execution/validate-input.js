/**
 * Runtime JSON Schema validation for tool arguments (subset — no $ref).
 * Keeps dependency-free alignment with registered inputSchema objects.
 */

/**
 * @param {string} path
 * @param {*} value
 * @param {object} schema
 * @param {string[]} errors
 */
function validateValueAt(path, value, schema, errors) {
  if (!schema || typeof schema !== "object") return;

  const t = schema.type;
  if (t === "string") {
    if (typeof value !== "string") errors.push(`${path}: expected string`);
    else if (Array.isArray(schema.enum) && schema.enum.length > 0 && !schema.enum.includes(value)) {
      errors.push(`${path}: must be one of: ${schema.enum.join(", ")}`);
    }
    return;
  }
  if (t === "number" || t === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${path}: expected number`);
    } else if (t === "integer" && !Number.isInteger(value)) {
      errors.push(`${path}: expected integer`);
    }
    return;
  }
  if (t === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
    return;
  }
  if (t === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.items && typeof schema.items === "object") {
      value.forEach((item, i) => {
        validateValueAt(`${path}[${i}]`, item, schema.items, errors);
      });
    }
    return;
  }
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateValueAt(`${path}.${key}`, value[key], sub, errors);
        }
      }
    }
  }
}

/**
 * @param {object} inputSchema - JSON Schema (type object, properties, required)
 * @param {object} args
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateToolArgs(inputSchema, args) {
  if (!inputSchema || typeof inputSchema !== "object") {
    return { ok: true };
  }

  const obj =
    args && typeof args === "object" && !Array.isArray(args) ? args : {};

  const errors = [];

  const asObject =
    inputSchema.type === "object" ||
    (inputSchema.properties && typeof inputSchema.properties === "object");

  if (asObject) {
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      errors.push("arguments must be a plain object");
    }

    if (Array.isArray(inputSchema.required)) {
      for (const key of inputSchema.required) {
        if (!Object.prototype.hasOwnProperty.call(obj, key) || obj[key] === undefined) {
          errors.push(`missing required property: ${key}`);
        }
      }
    }

    if (inputSchema.properties && typeof inputSchema.properties === "object") {
      for (const [key, subSchema] of Object.entries(inputSchema.properties)) {
        if (!Object.prototype.hasOwnProperty.call(obj, key) || obj[key] === undefined) {
          continue;
        }
        validateValueAt(key, obj[key], subSchema, errors);
      }
    }

  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
