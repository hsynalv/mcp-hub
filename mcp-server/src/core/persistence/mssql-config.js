/**
 * Parse ADO.NET-style MSSQL connection strings for node-mssql v12+.
 * sql.connect({ connectionString }) does not reliably parse these keys.
 */

/**
 * @param {string} connectionString
 * @returns {{ server: string, port?: number, database?: string, user?: string, password?: string, options: { encrypt: boolean, trustServerCertificate: boolean } }}
 */
export function parseMssqlConnectionString(connectionString) {
  const parts = {};
  for (const segment of connectionString.split(";")) {
    const idx = segment.indexOf("=");
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim().toLowerCase();
    const value = segment.slice(idx + 1).trim();
    if (key) parts[key] = value;
  }

  const serverRaw =
    parts["server"] ||
    parts["data source"] ||
    parts["address"] ||
    parts["addr"] ||
    parts["network address"];

  if (!serverRaw) {
    throw new Error("Invalid MSSQL connection string: missing Server or Data Source");
  }

  let server = serverRaw;
  let port;
  if (serverRaw.includes(",")) {
    const [host, portStr] = serverRaw.split(",").map((s) => s.trim());
    server = host;
    port = parseInt(portStr, 10);
  } else if (serverRaw.includes(":")) {
    const [host, portStr] = serverRaw.split(":").map((s) => s.trim());
    server = host;
    port = parseInt(portStr, 10);
  }

  const encrypt =
    parts["encrypt"] != null
      ? /^true$/i.test(parts["encrypt"])
      : !/^\d{1,3}(\.\d{1,3}){3}$/.test(server) && !server.startsWith("[");
  const trustServerCertificate =
    parts["trustservercertificate"] != null
      ? /^true$/i.test(parts["trustservercertificate"])
      : true;

  return {
    server,
    ...(port && !Number.isNaN(port) ? { port } : {}),
    database: parts["database"] || parts["initial catalog"],
    user: parts["user id"] || parts["uid"] || parts["user"],
    password: parts["password"] || parts["pwd"] || "",
    options: { encrypt, trustServerCertificate },
  };
}

/**
 * @param {string} connectionString
 * @param {{ max?: number, min?: number, idleTimeoutMillis?: number }} [pool]
 */
export function mssqlConfigFromConnectionString(connectionString, pool = {}) {
  const parsed = parseMssqlConnectionString(connectionString);
  return {
    server: parsed.server,
    ...(parsed.port ? { port: parsed.port } : {}),
    database: parsed.database,
    user: parsed.user,
    password: parsed.password,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000, ...pool },
    options: {
      encrypt: true,
      trustServerCertificate: true,
      ...parsed.options,
    },
  };
}
