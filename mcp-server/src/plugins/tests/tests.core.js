/**
 * Tests Plugin - Core
 *
 * Test runner integration for running unit and integration tests.
 * Supports multiple test frameworks: vitest, jest, mocha.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { promises as fs } from "fs";

const execAsync = promisify(exec);

/**
 * Detect test framework and configuration
 * @param {string} projectPath - Project root path
 * @returns {Promise<{framework: string|null, configFile: string|null}>}
 */
async function detectTestFramework(projectPath) {
  const files = await fs.readdir(projectPath);

  // Check for vitest
  if (files.includes("vitest.config.js") || files.includes("vitest.config.ts")) {
    return { framework: "vitest", configFile: "vitest.config.js" };
  }

  // Check for jest
  if (files.includes("jest.config.js") || files.includes("jest.config.ts")) {
    return { framework: "jest", configFile: "jest.config.js" };
  }

  // Check package.json for test scripts
  try {
    const packageJson = JSON.parse(await fs.readFile(join(projectPath, "package.json"), "utf-8"));
    const testScript = packageJson.scripts?.test || "";

    if (testScript.includes("vitest")) return { framework: "vitest", configFile: null };
    if (testScript.includes("jest")) return { framework: "jest", configFile: null };
    if (testScript.includes("mocha")) return { framework: "mocha", configFile: null };
  } catch {
    // No package.json
  }

  return { framework: null, configFile: null };
}

/**
 * Run tests
 * @param {string} projectPath - Project root path
 * @param {Object} options
 * @param {string} options.pattern - Test file pattern
 * @param {boolean} options.watch - Watch mode
 * @param {string} options.reporter - Reporter type
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function runTests(projectPath, options = {}) {
  const { framework } = await detectTestFramework(projectPath);

  if (!framework) {
    return {
      ok: false,
      error: {
        code: "no_test_framework",
        message: "No supported test framework detected (vitest, jest, mocha)",
      },
    };
  }

  const pattern = options.pattern || "";
  const watch = options.watch ? " --watch" : "";
  const reporter = options.reporter ? ` --reporter=${options.reporter}` : "";

  let command;
  switch (framework) {
    case "vitest":
      command = `npx vitest run${pattern ? ` ${pattern}` : ""}${reporter}`;
      break;
    case "jest":
      command = `npx jest${pattern ? ` ${pattern}` : ""}${watch}${reporter}`;
      break;
    case "mocha":
      command = `npx mocha${pattern ? ` ${pattern}` : ""}${reporter}`;
      break;
    default:
      return { ok: false, error: { code: "unsupported_framework", message: `Framework ${framework} not supported` } };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: projectPath,
      timeout: 120000, // 2 minute timeout
    });

    // Parse test results
    const summary = parseTestOutput(stdout + stderr, framework);

    return {
      ok: true,
      data: {
        framework,
        command,
        summary,
        output: stdout + stderr,
        passed: summary.failed === 0,
      },
    };
  } catch (err) {
    // Tests failed (non-zero exit code)
    const summary = parseTestOutput(err.stdout + err.stderr, framework);

    return {
      ok: true, // Request succeeded, tests just failed
      data: {
        framework,
        command,
        summary,
        output: err.stdout + err.stderr,
        passed: false,
        exitCode: err.code,
      },
    };
  }
}

/**
 * Parse test output for summary
 * @param {string} output - Test command output
 * @param {string} framework - Test framework
 * @returns {Object}
 */
function parseTestOutput(output, framework) {
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
  };

  if (framework === "vitest") {
    // Parse Vitest output
    // Example: "Test Files  3 passed (3)" or "Tests  15 passed (15)"
    const testsMatch = output.match(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/);
    const filesMatch = output.match(/Test Files\s+(\d+)\s+passed/);
    const durationMatch = output.match(/Duration\s+([\d.]+)s/);

    if (testsMatch) {
      summary.total = parseInt(testsMatch[2], 10);
      summary.passed = parseInt(testsMatch[1], 10);
    }
    if (durationMatch) {
      summary.duration = parseFloat(durationMatch[1]);
    }

    // Check for failures
    const failedMatch = output.match(/failed\s+(\d+)/);
    if (failedMatch) {
      summary.failed = parseInt(failedMatch[1], 10);
      summary.passed = summary.total - summary.failed;
    }
  } else if (framework === "jest") {
    // Parse Jest output
    // Example: "Tests: 10 passed, 2 failed, 15 total"
    const match = output.match(/Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?,\s+(\d+)\s+total/);
    if (match) {
      summary.passed = parseInt(match[1], 10) || 0;
      summary.failed = parseInt(match[2], 10) || 0;
      summary.skipped = parseInt(match[3], 10) || 0;
      summary.total = parseInt(match[4], 10) || 0;
    }

    const timeMatch = output.match(/Time:\s+([\d.]+)\s*s/);
    if (timeMatch) {
      summary.duration = parseFloat(timeMatch[1]);
    }
  }

  return summary;
}

/**
 * Run linting
 * @param {string} projectPath - Project root path
 * @param {Object} options
 * @param {string} options.linter - Linter to use (eslint, prettier)
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function runLint(projectPath, options = {}) {
  const linter = options.linter || "eslint";

  let command;
  switch (linter) {
    case "eslint":
      command = "npx eslint . --format json";
      break;
    case "prettier":
      command = "npx prettier --check .";
      break;
    default:
      return { ok: false, error: { code: "unsupported_linter", message: `Linter ${linter} not supported` } };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: projectPath,
      timeout: 60000,
    });

    return {
      ok: true,
      data: {
        linter,
        passed: true,
        output: stdout || stderr,
      },
    };
  } catch (err) {
    // Linting found issues
    return {
      ok: true,
      data: {
        linter,
        passed: false,
        output: err.stdout || err.stderr,
        exitCode: err.code,
      },
    };
  }
}

/**
 * Get test coverage
 * @param {string} projectPath - Project root path
 * @returns {Promise<{ok: boolean, data?: Object, error?: Object}>}
 */
export async function getCoverage(projectPath) {
  const { framework } = await detectTestFramework(projectPath);

  if (!framework) {
    return {
      ok: false,
      error: { code: "no_test_framework", message: "No test framework detected" },
    };
  }

  let command;
  switch (framework) {
    case "vitest":
      command = "npx vitest run --coverage";
      break;
    case "jest":
      command = "npx jest --coverage";
      break;
    default:
      return { ok: false, error: { code: "unsupported_framework", message: `Coverage not supported for ${framework}` } };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: projectPath,
      timeout: 180000,
    });

    // Parse coverage from output
    const coverageMatch = stdout.match(/Coverage\s+([\d.]+)%/);
    const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : null;

    return {
      ok: true,
      data: {
        framework,
        coverage,
        output: stdout + stderr,
      },
    };
  } catch (err) {
    return {
      ok: true,
      data: {
        framework,
        coverage: null,
        output: err.stdout + err.stderr,
        passed: false,
      },
    };
  }
}
