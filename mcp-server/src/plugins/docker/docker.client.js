import { config } from "../../core/config.js";
import { createReadStream } from "fs";
import { join } from "path";

// Docker socket path - can be overridden with DOCKER_HOST env var
const DOCKER_SOCKET = process.env.DOCKER_HOST || "/var/run/docker.sock";

/**
 * Make a request to Docker API via Unix socket.
 * 
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g., "/containers/json")
 * @param {any} body - Request body (optional)
 * @param {Object} queryParams - Query parameters (optional)
 * @returns {Promise<{ok: boolean, data?: any, error?: string, details?: any}>}
 */
export async function dockerRequest(method, path, body = null, queryParams = {}) {
  try {
    // Build URL with query parameters
    let url = `http://localhost${path}`;
    if (Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url += `?${params}`;
    }

    // Prepare fetch options
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Host": "localhost",
      },
    };

    // Add body if present
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      if (typeof body === "object") {
        options.body = JSON.stringify(body);
      } else {
        options.body = body;
      }
    }

    // Make request via Unix socket
    const response = await fetch(url, options);
    
    let data;
    const contentType = response.headers.get("content-type");
    
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        error: "docker_api_error",
        details: {
          status: response.status,
          statusText: response.statusText,
          data,
        },
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: "docker_connection_error",
      details: {
        message: error.message,
        socket: DOCKER_SOCKET,
      },
    };
  }
}

/**
 * Check if Docker socket is accessible.
 */
export async function checkDockerConnection() {
  const result = await dockerRequest("GET", "/version");
  return result.ok;
}
