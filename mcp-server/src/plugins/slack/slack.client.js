// Slack Bot Token - should start with "xoxb-"
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";

/**
 * Make a request to Slack API.
 * 
 * @param {string} method - HTTP method
 * @param {string} endpoint - Slack API method (e.g., "chat.postMessage")
 * @param {Object} params - Request parameters
 * @param {boolean} isFileUpload - Whether this is a file upload request
 * @returns {Promise<{ok: boolean, data?: any, error?: string, details?: any}>}
 */
export async function slackRequest(method, endpoint, params = {}, isFileUpload = false) {
  try {
    if (!SLACK_BOT_TOKEN) {
      return {
        ok: false,
        error: "missing_token",
        details: { message: "SLACK_BOT_TOKEN environment variable is required" },
      };
    }

    let url = `https://slack.com/api/${endpoint}`;
    
    // Prepare request options
    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      },
    };

    if (isFileUpload) {
      // For file uploads, use FormData
      const formData = new FormData();
      
      // Add all parameters to FormData
      Object.entries(params).forEach(([key, value]) => {
        if (key === 'file' && Buffer.isBuffer(value)) {
          formData.append('file', value, params.filename || 'file');
        } else if (typeof value === 'object') {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value);
        }
      });

      options.body = formData;
      // Don't set Content-Type for FormData - browser sets it with boundary
    } else {
      // Regular JSON request
      options.headers["Content-Type"] = "application/json";
      
      // Add token to parameters for GET requests
      if (method === "GET") {
        params.token = SLACK_BOT_TOKEN;
      }
      
      if (Object.keys(params).length > 0) {
        if (method === "GET") {
          // For GET, add params to URL
          const searchParams = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach(v => searchParams.append(key, v));
            } else {
              searchParams.append(key, value);
            }
          });
          url += `?${searchParams.toString()}`;
        } else {
          // For POST/PUT, add params to body
          options.body = JSON.stringify(params);
        }
      }
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: "slack_api_error",
        details: {
          status: response.status,
          statusText: response.statusText,
          slack_error: data.error,
          data,
        },
      };
    }

    // Check Slack-specific error
    if (!data.ok) {
      return {
        ok: false,
        error: "slack_error",
        details: {
          slack_error: data.error,
          data,
        },
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: "slack_connection_error",
      details: {
        message: error.message,
        endpoint,
      },
    };
  }
}

/**
 * Test Slack connection and bot permissions.
 */
export async function testSlackConnection() {
  const result = await slackRequest("GET", "auth.test");
  return result.ok;
}

/**
 * Get bot user information.
 */
export async function getBotInfo() {
  const result = await slackRequest("GET", "bots.info");
  return result;
}
