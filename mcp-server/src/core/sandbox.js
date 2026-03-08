/**
 * Plugin Sandboxing System
 * 
 * Provides security isolation for dangerous plugins:
 * 1. Command allowlist (shell plugin)
 * 2. Path allowlist (file plugins)  
 * 3. Domain allowlist (http plugin)
 * 4. Readonly mode (database plugin)
 * 5. Workspace isolation
 * 
 * Dangerous combinations are detected in security-guard.js
 */

import { getWorkspaceKey } from "./workspace.js";

/**
 * Allowed command patterns for shell plugin
 */
export const ALLOWED_COMMANDS = [
  // File operations (read-only)
  /^ls\s/i,
  /^cat\s/i,
  /^head\s/i,
  /^tail\s/i,
  /^find\s/i,
  /^grep\s/i,
  /^wc\s/i,
  
  // Git operations
  /^git\s+(status|log|show|diff|branch)\s/i,
  /^git\s+clone\s/i,
  /^git\s+pull\s/i,
  /^git\s+fetch\s/i,
  
  // Process inspection (read-only)
  /^ps\s/i,
  /^top\s+/i,
  /^htop\s+/i,
  
  // Network inspection (read-only)
  /^ping\s/i,
  /^curl\s+--head\s/i,
  /^nslookup\s/i,
  /^dig\s/i,
  
  // Build tools
  /^npm\s+(install|ci|run|test|build)\s/i,
  /^yarn\s/i,
  /^pnpm\s/i,
  
  // Container inspection (read-only)
  /^docker\s+(ps|images|logs|inspect)\s/i,
  /^docker-compose\s+(ps|logs|config)\s/i,
];

/**
 * Blocked dangerous commands
 */
export const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\//i,           // Delete root
  />\s*\/etc\/passwd/i,       // Overwrite passwd
  /mkfs/i,                    // Format filesystem
  /dd\s+if/i,                 // Direct disk write
  /:\(\)\s*\{\s*:\|;:\};/i,    // Fork bomb
  /wget.*\|.*sh/i,            // Pipe remote to shell
  /curl.*\|.*sh/i,            // Pipe remote to shell
];

/**
 * Validate shell command against allowlist
 */
export function validateShellCommand(command, workspaceId) {
  // First check blocked commands
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: "Command matches blocked pattern",
        requiresApproval: true,
      };
    }
  }
  
  // Check allowed commands
  for (const pattern of ALLOWED_COMMANDS) {
    if (pattern.test(command)) {
      return {
        allowed: true,
        reason: "Command matches allowlist",
        requiresApproval: false,
      };
    }
  }
  
  // Not in allowlist - requires approval
  return {
    allowed: true,
    reason: "Command not in allowlist - requires approval",
    requiresApproval: true,
  };
}

/**
 * Allowed file paths for file plugins
 */
export function validateFilePath(path, workspaceId, mode = "read") {
  // Normalize path
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  
  // Block path traversal
  if (normalized.includes("..") || normalized.includes("~")) {
    return {
      allowed: false,
      reason: "Path traversal detected",
    };
  }
  
  // Workspace-bound paths
  const workspacePath = `/workspaces/${workspaceId}/`;
  
  // Allowed prefixes
  const allowedPrefixes = [
    workspacePath,
    `/tmp/${workspaceId}/`,
    `/var/tmp/${workspaceId}/`,
  ];
  
  const isAllowed = allowedPrefixes.some(prefix => 
    normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)
  );
  
  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Path outside workspace boundary (${workspacePath})`,
      requiresApproval: true,
    };
  }
  
  // Check write operations
  if (mode === "write" || mode === "delete") {
    return {
      allowed: true,
      reason: "Write operation requires approval",
      requiresApproval: true,
    };
  }
  
  return {
    allowed: true,
    reason: "Path validated",
    requiresApproval: false,
  };
}

/**
 * Allowed domains for HTTP plugin
 */
export const ALLOWED_DOMAINS = [
  // APIs
  "api.github.com",
  "api.notion.com",
  "api.slack.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.mistral.ai",
  "generativelanguage.googleapis.com",
  
  // Package registries
  "registry.npmjs.org",
  "pypi.org",
  "api.nuget.org",
  
  // Utilities
  "hooks.slack.com",
  "api.ipify.org",
  "httpbin.org",
];

/**
 * Blocked domains
 */
export const BLOCKED_DOMAINS = [
  /localhost/i,
  /127\.\d+\.\d+\.\d+/i,
  /192\.168\.\d+\.\d+/i,
  /10\.\d+\.\d+\.\d+/i,
  /0\.0\.0\.0/i,
  /::1/i,
];

/**
 * Validate HTTP domain
 */
export function validateHttpDomain(url) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    
    // Check blocked
    for (const pattern of BLOCKED_DOMAINS) {
      if (pattern.test(domain)) {
        return {
          allowed: false,
          reason: "Blocked domain pattern",
        };
      }
    }
    
    // Check allowed
    const isAllowed = ALLOWED_DOMAINS.some(d => 
      domain === d || domain.endsWith(`.${d}`)
    );
    
    if (!isAllowed) {
      return {
        allowed: true, // Allow but require approval
        reason: "Domain not in allowlist - requires approval",
        requiresApproval: true,
      };
    }
    
    return {
      allowed: true,
      reason: "Domain validated",
      requiresApproval: false,
    };
  } catch {
    return {
      allowed: false,
      reason: "Invalid URL",
    };
  }
}

/**
 * Database readonly enforcement
 */
export function validateDatabaseQuery(sql, mode = "readonly") {
  const writePatterns = [
    /^\s*INSERT\s/i,
    /^\s*UPDATE\s/i,
    /^\s*DELETE\s/i,
    /^\s*DROP\s/i,
    /^\s*CREATE\s/i,
    /^\s*ALTER\s/i,
    /^\s*TRUNCATE\s/i,
  ];
  
  const isWrite = writePatterns.some(pattern => pattern.test(sql));
  
  if (mode === "readonly" && isWrite) {
    return {
      allowed: false,
      reason: "Write operation in readonly mode",
      requiresApproval: true,
    };
  }
  
  if (isWrite) {
    return {
      allowed: true,
      reason: "Write operation requires approval",
      requiresApproval: true,
    };
  }
  
  return {
    allowed: true,
    reason: "Read-only query",
    requiresApproval: false,
  };
}

/**
 * Plugin sandbox configuration
 */
export const PLUGIN_SANDBOX = {
  shell: {
    allowedCommands: ALLOWED_COMMANDS,
    blockedCommands: BLOCKED_COMMANDS,
    requiresApproval: true,
  },
  "file-storage": {
    workspaceBound: true,
    allowedPaths: ["/workspaces/{workspaceId}/"],
    requiresApprovalForWrite: true,
  },
  "local-sidecar": {
    workspaceBound: true,
    whitelistRequired: true,
  },
  http: {
    allowedDomains: ALLOWED_DOMAINS,
    blockedDomains: BLOCKED_DOMAINS,
    requiresApprovalForNewDomains: true,
  },
  database: {
    readonlyByDefault: true,
    requiresApprovalForWrite: true,
    statementTimeout: 30000,
  },
};

/**
 * Check if plugin operation requires approval
 */
export function requiresApproval(pluginName, operation, context) {
  const sandbox = PLUGIN_SANDBOX[pluginName];
  if (!sandbox) return false;
  
  // Dangerous plugins always require approval for certain operations
  if (pluginName === "shell" && operation === "execute") {
    return true;
  }
  
  if (pluginName === "database" && operation === "query_write") {
    return true;
  }
  
  if (pluginName === "file-storage" && operation === "delete") {
    return true;
  }
  
  return false;
}

/**
 * Sandboxed execution wrapper
 */
export async function executeSandboxed(pluginName, operation, args, context) {
  // Check if approval required
  if (requiresApproval(pluginName, operation, context)) {
    return {
      approved: false,
      reason: "Operation requires approval",
      approvalId: null, // Would be created by policy system
    };
  }
  
  // Execute with validation
  try {
    // Pre-validation
    if (pluginName === "shell") {
      const validation = validateShellCommand(args.command, context.workspaceId);
      if (!validation.allowed) {
        throw new Error(validation.reason);
      }
    }
    
    if (pluginName === "file-storage") {
      const validation = validateFilePath(args.path, context.workspaceId, args.mode);
      if (!validation.allowed) {
        throw new Error(validation.reason);
      }
    }
    
    if (pluginName === "http") {
      const validation = validateHttpDomain(args.url);
      if (!validation.allowed) {
        throw new Error(validation.reason);
      }
    }
    
    return { approved: true };
  } catch (err) {
    return {
      approved: false,
      reason: err.message,
    };
  }
}
