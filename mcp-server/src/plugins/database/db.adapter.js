/**
 * Database adapter interface.
 * type: mssql | postgres | mongodb
 */

const TYPES = ["mssql", "postgres", "mongodb"];

export function getAdapter(type) {
  if (!TYPES.includes(type)) return null;
  switch (type) {
    case "mssql":   return import("./adapters/mssql.js").then((m) => m.default);
    case "postgres": return import("./adapters/postgres.js").then((m) => m.default);
    case "mongodb": return import("./adapters/mongodb.js").then((m) => m.default);
    default:        return null;
  }
}

export function isValidType(type) {
  return TYPES.includes(type);
}
