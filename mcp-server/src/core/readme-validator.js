/**
 * Documentation Standardization - README Validator
 * 
 * Validates plugin README files have required sections.
 * Standardizes documentation across all plugins.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Required sections for a standard plugin README
 */
export const REQUIRED_SECTIONS = [
  { name: "title", pattern: /^#\s+.+/, required: true },
  { name: "description", pattern: /##?\s*(?:Purpose|Açıklama|Description)/i, required: false },
  { name: "endpoints", pattern: /##?\s*(?:Endpoints|API|Routes)/i, required: true },
  { name: "tools", pattern: /##?\s*(?:Tools|MCP Araçları)/i, required: true },
  { name: "configuration", pattern: /##?\s*(?:Config|Configuration|Env|Environment)/i, required: true },
];

/**
 * Validate a README file
 * @param {string} readmePath - Path to README.md
 * @returns {Object} Validation result
 */
export function validateReadme(readmePath) {
  if (!existsSync(readmePath)) {
    return {
      valid: false,
      exists: false,
      errors: ["README.md does not exist"],
      warnings: [],
      sections: [],
    };
  }

  const content = readFileSync(readmePath, "utf-8");
  const lines = content.split("\n");
  
  const errors = [];
  const warnings = [];
  const foundSections = [];

  // Check required sections
  for (const section of REQUIRED_SECTIONS) {
    const found = section.pattern.test(content);
    
    if (section.required && !found) {
      errors.push(`Missing required section: ${section.name}`);
    } else if (!found) {
      warnings.push(`Missing recommended section: ${section.name}`);
    } else {
      foundSections.push(section.name);
    }
  }

  // Check for code examples
  const hasExamples = content.includes("```") || content.includes("`");
  if (!hasExamples) {
    warnings.push("No code examples found");
  }

  // Check for env vars documentation
  const hasEnvVars = /[A-Z_]+_KEY|_TOKEN|_URL/.test(content);
  if (!hasEnvVars) {
    warnings.push("No environment variables documented");
  }

  // Check length
  const lineCount = lines.length;
  if (lineCount < 20) {
    warnings.push(`README is quite short (${lineCount} lines)`);
  }

  return {
    valid: errors.length === 0,
    exists: true,
    lineCount,
    errors,
    warnings,
    sections: foundSections,
    score: calculateReadmeScore(foundSections, errors, warnings),
  };
}

/**
 * Calculate README quality score
 */
function calculateReadmeScore(sections, errors, warnings) {
  let score = 100;
  
  // Deduct for errors
  score -= errors.length * 20;
  
  // Deduct for warnings
  score -= warnings.length * 5;
  
  // Bonus for sections
  score += sections.length * 5;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Validate all plugin READMEs
 * @param {string} pluginsDir - Path to plugins directory
 * @returns {Object} Summary of all validations
 */
export function validateAllPluginReadmes(pluginsDir) {
  const results = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let validCount = 0;

  const entries = readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const readmePath = join(pluginsDir, entry.name, "README.md");
    const result = validateReadme(readmePath);
    
    results.push({
      plugin: entry.name,
      ...result,
    });

    if (result.valid) validCount++;
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  return {
    totalPlugins: results.length,
    validReadmes: validCount,
    totalErrors,
    totalWarnings,
    averageScore: Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length),
    results,
  };
}

/**
 * Generate standardized README template
 * @param {Object} options - Template options
 * @returns {string} README content
 */
export function generateReadmeTemplate(options = {}) {
  const { name, description, endpoints = [], tools = [], envVars = [] } = options;

  return `# ${name}

${description || "Plugin description goes here."}

## Purpose

Brief explanation of what this plugin does and when to use it.

## Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
${endpoints.map(e => `| \`${e.path}\` | ${e.method} | ${e.scope || "read"} | ${e.description || ""} |`).join("\n")}

## MCP Tools

| Tool | Description | Required Params |
|------|-------------|-----------------|
${tools.map(t => `| \`${t.name}\` | ${t.description || ""} | ${(t.inputSchema?.required || []).join(", ")} |`).join("\n")}

## Configuration

### Environment Variables

${envVars.length > 0 
  ? envVars.map(e => `- \`${e.name}\` ${e.required ? "(required)" : "(optional)"} - ${e.description || ""}`).join("\n")
  : "_No environment variables required_"}

### Example .env

\`\`\`env
${envVars.filter(e => e.required).map(e => `${e.name}=your_${e.name.toLowerCase()}_here`).join("\n")}
\`\`\`

## Example Usage

### HTTP API

\`\`\`bash
curl http://localhost:8787/${name.toLowerCase()}/endpoint \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "x-project-id: my-project"
\`\`\`

### MCP Tool

\`\`\`json
{
  "tool": "${tools[0]?.name || "example_tool"}",
  "params": {}
}
\`\`\`

## Error Handling

Common errors and how to handle them:

| Error Code | Description | Resolution |
|------------|-------------|------------|
| \`PLUGIN_ERROR\` | Generic plugin error | Check logs |

## Security Considerations

- Required scope: \`read\` or \`write\`
- Dangerous combinations: None

## See Also

- [Plugin Development Guide](../../docs/plugin-development.md)
- [API Reference](../../docs/api-reference.md)
`;
}

/**
 * Fix common README issues automatically
 * @param {string} readmePath - Path to README
 * @returns {Object} Fix result
 */
export function fixReadmeIssues(readmePath) {
  if (!existsSync(readmePath)) {
    return { success: false, error: "README not found" };
  }

  const content = readFileSync(readmePath, "utf-8");
  let fixed = content;
  const fixes = [];

  // Ensure title exists
  if (!/^#\s+.+/.test(fixed)) {
    const pluginName = readmePath.split("/").slice(-2)[0];
    fixed = `# ${pluginName}\n\n${fixed}`;
    fixes.push("Added missing title");
  }

  // Ensure sections have proper headers
  const sections = [
    { pattern: /##?\s*EndPoints/i, replacement: "## Endpoints" },
    { pattern: /##?\s*Tools/i, replacement: "## Tools" },
    { pattern: /##?\s*Config/i, replacement: "## Configuration" },
  ];

  for (const section of sections) {
    if (section.pattern.test(fixed)) {
      fixed = fixed.replace(section.pattern, section.replacement);
    }
  }

  return {
    success: true,
    fixes,
    original: content,
    fixed,
  };
}

/**
 * CLI command to run validation
 */
export function runReadmeValidationCLI(pluginsDir) {
  const summary = validateAllPluginReadmes(pluginsDir);

  console.log("\n📚 Plugin README Validation Report\n");
  console.log(`Total Plugins: ${summary.totalPlugins}`);
  console.log(`Valid READMEs: ${summary.validReadmes}/${summary.totalPlugins}`);
  console.log(`Average Score: ${summary.averageScore}/100`);
  console.log(`Total Errors: ${summary.totalErrors}`);
  console.log(`Total Warnings: ${summary.totalWarnings}\n`);

  console.log("Top Plugins:");
  summary.results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.plugin}: ${r.score}/100 ${r.valid ? "✅" : "❌"}`);
  });

  console.log("\nNeeds Improvement:");
  summary.results
    .filter(r => !r.valid || r.score < 70)
    .slice(0, 5)
    .forEach(r => {
      console.log(`  - ${r.plugin}: ${r.score}/100`);
      r.errors.forEach(e => console.log(`    ❌ ${e}`));
      r.warnings.slice(0, 2).forEach(w => console.log(`    ⚠️  ${w}`));
    });

  return summary;
}
