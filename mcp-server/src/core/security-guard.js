/**
 * Security Guard - Tool Chain Analysis & Parameter Sanitization
 * 
 * Provides 4-layer security:
 * 1. Authentication - API key validation
 * 2. Authorization - Scope-based access control
 * 3. Policy Rules - Per-tool rules and dangerous chain detection
 * 4. Audit/Approval - Human-in-the-loop for sensitive operations
 */

import { getPlugins } from "./plugins.js";

// Dangerous tool combinations that should be flagged
const DANGEROUS_CHAINS = [
  ["shell_execute", "file_write"],      // Shell → Write file (malware risk)
  ["shell_execute", "http_request"],    // Shell → HTTP (data exfiltration)
  ["database_query", "http_request"],   // DB → HTTP (data leak)
  ["secrets_get", "http_request"],      // Secrets → HTTP (credential theft)
  ["file_read", "http_request"],        // File → HTTP (data exfiltration)
  ["git_clone", "shell_execute"],       // Clone → Execute (supply chain attack)
];

// Patterns that indicate potential attacks
const DANGEROUS_PATTERNS = {
  sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b.*\b(FROM|INTO|TABLE)\b)|(--|;--|;\s*\/\*)|(\bOR\s+1\s*=\s*1\b)|('\s*OR\s*')/i,
  pathTraversal: /\.\.[\/\\]|\.\.\\|\/\.\.\/|\%2e\%2e/,
  commandInjection: /[;&|`$(){}[\]]|\$\(|`.*`|\|\||&&/,
  xmlInjection: /<\!ENTITY\s+.*SYSTEM\s+["']file:\/\//i,
  templateInjection: /\{\{.*\}\}|\$\{.*\}|\#{.*\}/,
};

/**
 * Analyze a sequence of tool calls for dangerous chains
 * @param {Array} toolCalls - Array of {tool, args} objects in call order
 * @returns {Object} Analysis result with warnings and risk score
 */
export function analyzeToolChain(toolCalls) {
  const warnings = [];
  let riskScore = 0;
  const toolNames = toolCalls.map(tc => tc.tool);

  // Check for dangerous combinations
  for (const chain of DANGEROUS_CHAINS) {
    const match = findSubsequence(toolNames, chain);
    if (match) {
      warnings.push({
        type: "dangerous_chain",
        severity: "high",
        message: `Dangerous tool chain detected: ${chain.join(" → ")}`,
        chain,
        indices: match,
      });
      riskScore += 50;
    }
  }

  // Check for repeated sensitive operations
  const sensitiveTools = ["shell_execute", "database_query", "file_delete", "secrets_get"];
  for (const tool of sensitiveTools) {
    const count = toolNames.filter(n => n === tool).length;
    if (count > 5) {
      warnings.push({
        type: "repeated_operation",
        severity: "medium",
        message: `Repeated ${tool} calls (${count} times) may indicate abuse`,
        tool,
        count,
      });
      riskScore += count * 5;
    }
  }

  // Check plugin security metadata
  const plugins = getPlugins();
  for (let i = 0; i < toolCalls.length; i++) {
    const { tool, args } = toolCalls[i];
    const plugin = plugins.find(p => p.tools?.some(t => t.name === tool));
    
    if (plugin?.security?.dangerousCombinations) {
      const nextTools = toolNames.slice(i + 1, i + 3);
      for (const dangerous of plugin.security.dangerousCombinations) {
        if (nextTools.includes(dangerous)) {
          warnings.push({
            type: "plugin_dangerous_combo",
            severity: "high",
            message: `${tool} followed by ${dangerous} is flagged by ${plugin.name} plugin`,
            tool,
            dangerous,
          });
          riskScore += 40;
        }
      }
    }

    // Check if plugin requires approval
    if (plugin?.security?.requiresApproval) {
      warnings.push({
        type: "requires_approval",
        severity: "medium",
        message: `${tool} requires human approval`,
        tool,
        plugin: plugin.name,
      });
      riskScore += 30;
    }
  }

  return {
    safe: riskScore < 50,
    riskScore,
    warnings,
    requiresApproval: riskScore >= 30,
    blocked: riskScore >= 100,
  };
}

/**
 * Sanitize and validate tool arguments
 * @param {string} tool - Tool name
 * @param {Object} args - Tool arguments
 * @returns {Object} Sanitization result
 */
export function sanitizeToolArgs(tool, args) {
  const issues = [];
  const sanitized = { ...args };

  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;

    // Check for SQL injection
    if (DANGEROUS_PATTERNS.sqlInjection.test(value)) {
      issues.push({
        type: "sql_injection",
        severity: "critical",
        field: key,
        message: `Potential SQL injection detected in ${key}`,
      });
      sanitized[key] = sanitizeSql(value);
    }

    // Check for path traversal
    if (DANGEROUS_PATTERNS.pathTraversal.test(value)) {
      issues.push({
        type: "path_traversal",
        severity: "critical",
        field: key,
        message: `Path traversal attempt detected in ${key}`,
      });
      sanitized[key] = sanitizePath(value);
    }

    // Check for command injection
    if (tool.includes("shell") && DANGEROUS_PATTERNS.commandInjection.test(value)) {
      issues.push({
        type: "command_injection",
        severity: "critical",
        field: key,
        message: `Command injection attempt detected in ${key}`,
      });
      sanitized[key] = sanitizeCommand(value);
    }

    // Check for XML injection
    if (value.includes("<!ENTITY") && DANGEROUS_PATTERNS.xmlInjection.test(value)) {
      issues.push({
        type: "xml_injection",
        severity: "high",
        field: key,
        message: `XML external entity detected in ${key}`,
      });
      sanitized[key] = "[REMOVED-XML-ENTITY]";
    }

    // Check for template injection
    if (DANGEROUS_PATTERNS.templateInjection.test(value)) {
      issues.push({
        type: "template_injection",
        severity: "medium",
        field: key,
        message: `Template injection pattern detected in ${key}`,
      });
    }
  }

  const hasCritical = issues.some(i => i.severity === "critical");

  return {
    safe: !hasCritical,
    blocked: hasCritical,
    issues,
    sanitized,
  };
}

/**
 * Check if user has required scope for tool
 * @param {string} tool - Tool name
 * @param {Array} userScopes - User's granted scopes
 * @returns {boolean}
 */
export function hasToolScope(tool, userScopes) {
  const plugins = getPlugins();
  const plugin = plugins.find(p => p.tools?.some(t => t.name === tool));
  
  if (!plugin?.security?.scope) return true; // Default allow if not specified
  
  const requiredScope = plugin.security.scope;
  const scopeHierarchy = { read: 1, write: 2, admin: 3 };
  
  const userLevel = Math.max(...userScopes.map(s => scopeHierarchy[s] || 0));
  const requiredLevel = scopeHierarchy[requiredScope] || 1;
  
  return userLevel >= requiredLevel;
}

/**
 * Generate security questionnaire for a plugin
 * @param {Object} pluginMeta - Plugin metadata
 * @returns {Object} Security assessment
 */
export function assessPluginSecurity(pluginMeta) {
  const checks = {
    hasAuth: pluginMeta.requiresAuth,
    hasScope: !!pluginMeta.security?.scope,
    hasApproval: !!pluginMeta.security?.requiresApproval,
    hasResilience: pluginMeta.resilience?.retry || pluginMeta.resilience?.circuitBreaker,
    hasTest: pluginMeta.testLevel !== "none",
    hasDocs: pluginMeta.documentation?.readme && pluginMeta.documentation?.examples,
  };

  const score = Object.values(checks).filter(Boolean).length;
  const maxScore = Object.keys(checks).length;

  return {
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
    tier: score >= 6 ? "gold" : score >= 4 ? "silver" : score >= 2 ? "bronze" : "needs-work",
  };
}

// Helper functions

function findSubsequence(arr, subseq) {
  if (subseq.length === 0) return null;
  
  for (let i = 0; i <= arr.length - subseq.length; i++) {
    let match = true;
    for (let j = 0; j < subseq.length; j++) {
      if (arr[i + j] !== subseq[j]) {
        match = false;
        break;
      }
    }
    if (match) return [i, i + subseq.length - 1];
  }
  return null;
}

function sanitizeSql(value) {
  // Basic SQL sanitization - replace dangerous patterns
  return value
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/;/g, "")
    .trim();
}

function sanitizePath(value) {
  // Remove path traversal attempts
  return value
    .replace(/\.\.[\/\\]/g, "")
    .replace(/\.\.\\/g, "")
    .replace(/\/\.\.\//g, "/")
    .replace(/%2e%2e/gi, "");
}

function sanitizeCommand(value) {
  // Remove shell metacharacters
  const dangerous = /[;&|`$(){}[\]]/g;
  return value.replace(dangerous, "");
}
