/**
 * Health Service
 *
 * Centralized health monitoring service for all plugins.
 */

import { HealthStatus } from "./health.types.js";
import {
  runHealthCheckWithRetry,
  runHealthChecks,
  calculateOverallStatus,
} from "./health.checker.js";

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  checkInterval: 30000, // 30 seconds
  checkTimeout: 5000,   // 5 seconds
  maxHistory: 100,
  autoStart: false,
  trackDependencies: true,
};

/**
 * Health Service
 */
export class HealthService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    /** @type {Map<string, import("./health.types.js").PluginHealth>} */
    this.pluginHealth = new Map();

    /** @type {Array<import("./health.types.js").ServiceHealth>} */
    this.history = [];

    /** @type {Map<string, Function>} */
    this.checkFunctions = new Map();

    /** @type {Map<string, string[]>} */
    this.dependencies = new Map();

    /** @type {number | null} */
    this.intervalId = null;

    /** @type {boolean} */
    this.isRunning = false;

    /** @type {Set<Function>} */
    this.listeners = new Set();
  }

  /**
   * Register a plugin for health monitoring
   * @param {string} name - Plugin name
   * @param {Function} checkFn - Health check function
   * @param {Object} [metadata] - Plugin metadata
   * @param {string[]} [dependencies] - Plugin dependencies
   */
  registerPlugin(name, checkFn, metadata = {}, dependencies = []) {
    this.checkFunctions.set(name, checkFn);

    this.pluginHealth.set(name, {
      name,
      version: metadata.version || "0.0.0",
      status: HealthStatus.UNKNOWN,
      lastCheck: 0,
      consecutiveFailures: 0,
      dependencies: dependencies || [],
      enabled: true,
    });

    if (dependencies && dependencies.length > 0) {
      this.dependencies.set(name, dependencies);
    }
  }

  /**
   * Unregister a plugin
   * @param {string} name - Plugin name
   */
  unregisterPlugin(name) {
    this.checkFunctions.delete(name);
    this.pluginHealth.delete(name);
    this.dependencies.delete(name);
  }

  /**
   * Start health monitoring
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;

    // Run initial check
    this.runChecks();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runChecks();
    }, this.config.checkInterval);
  }

  /**
   * Stop health monitoring
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Run health checks for all plugins
   * @returns {Promise<import("./health.types.js").ServiceHealth>}
   */
  async runChecks() {
    const checks = [];

    for (const [name, checkFn] of this.checkFunctions) {
      const health = this.pluginHealth.get(name);
      if (!health || !health.enabled) continue;

      checks.push({
        name,
        checkFn,
        context: {},
      });
    }

    const results = await runHealthChecks(checks, {
      timeout: this.config.checkTimeout,
      parallel: true,
    });

    // Update plugin health status
    for (const result of results) {
      this.updatePluginHealth(result);
    }

    // Check for cascading failures from dependencies
    if (this.config.trackDependencies) {
      this.checkDependencyFailures();
    }

    // Build service health
    const serviceHealth = this.buildServiceHealth();

    // Add to history
    this.addToHistory(serviceHealth);

    // Notify listeners
    this.notifyListeners(serviceHealth);

    return serviceHealth;
  }

  /**
   * Check health of a specific plugin
   * @param {string} name - Plugin name
   * @returns {Promise<import("./health.types.js").HealthCheckResult>}
   */
  async checkPlugin(name) {
    const checkFn = this.checkFunctions.get(name);
    if (!checkFn) {
      return {
        name,
        status: HealthStatus.UNKNOWN,
        message: "Plugin not registered for health checks",
        timestamp: Date.now(),
      };
    }

    const result = await runHealthCheckWithRetry(
      checkFn,
      name,
      {},
      { timeout: this.config.checkTimeout }
    );

    this.updatePluginHealth(result);

    return result;
  }

  /**
   * Update plugin health from check result
   * @param {import("./health.types.js").HealthCheckResult} result
   */
  updatePluginHealth(result) {
    const health = this.pluginHealth.get(result.name);
    if (!health) return;

    health.status = result.status;
    health.lastCheck = result.timestamp;
    health.responseTime = result.responseTime;
    health.message = result.message;

    if (result.status === HealthStatus.UNHEALTHY) {
      health.consecutiveFailures++;
    } else {
      health.consecutiveFailures = 0;
    }

    if (result.dependencies) {
      health.dependencies = result.dependencies;
    }
  }

  /**
   * Check for cascading failures from dependencies
   */
  checkDependencyFailures() {
    for (const [name, health] of this.pluginHealth) {
      const deps = this.dependencies.get(name);
      if (!deps || deps.length === 0) continue;

      // Check if any dependency is unhealthy
      const hasUnhealthyDep = deps.some(depName => {
        const depHealth = this.pluginHealth.get(depName);
        return depHealth && depHealth.status === HealthStatus.UNHEALTHY;
      });

      if (hasUnhealthyDep && health.status === HealthStatus.HEALTHY) {
        // Mark as degraded due to dependency
        health.status = HealthStatus.DEGRADED;
        health.message = `Degraded due to unhealthy dependencies: ${deps.filter(d => {
          const dh = this.pluginHealth.get(d);
          return dh && dh.status === HealthStatus.UNHEALTHY;
        }).join(", ")}`;
      }
    }
  }

  /**
   * Build service health snapshot
   * @returns {import("./health.types.js").ServiceHealth}
   */
  buildServiceHealth() {
    const plugins = Array.from(this.pluginHealth.values());

    const summary = {
      total: plugins.length,
      healthy: plugins.filter(p => p.status === HealthStatus.HEALTHY).length,
      degraded: plugins.filter(p => p.status === HealthStatus.DEGRADED).length,
      unhealthy: plugins.filter(p => p.status === HealthStatus.UNHEALTHY).length,
      unknown: plugins.filter(p => p.status === HealthStatus.UNKNOWN).length,
    };

    const status = calculateOverallStatus(
      plugins.map(p => ({ status: p.status }))
    );

    return {
      status,
      timestamp: Date.now(),
      summary,
      plugins,
    };
  }

  /**
   * Add to health history
   * @param {import("./health.types.js").ServiceHealth} health
   */
  addToHistory(health) {
    this.history.push(health);

    // Keep only recent history
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }
  }

  /**
   * Get health history
   * @param {number} [limit] - Max entries to return
   * @returns {import("./health.types.js").ServiceHealth[]}
   */
  getHistory(limit) {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * Get current health status
   * @returns {import("./health.types.js").ServiceHealth}
   */
  getCurrentHealth() {
    return this.buildServiceHealth();
  }

  /**
   * Get plugin health
   * @param {string} name - Plugin name
   * @returns {import("./health.types.js").PluginHealth | undefined}
   */
  getPluginHealth(name) {
    return this.pluginHealth.get(name);
  }

  /**
   * Enable/disable plugin health checks
   * @param {string} name - Plugin name
   * @param {boolean} enabled
   */
  setPluginEnabled(name, enabled) {
    const health = this.pluginHealth.get(name);
    if (health) {
      health.enabled = enabled;
    }
  }

  /**
   * Subscribe to health updates
   * @param {Function} listener
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   * @param {import("./health.types.js").ServiceHealth} health
   */
  notifyListeners(health) {
    for (const listener of this.listeners) {
      try {
        listener(health);
      } catch (err) {
        console.error("Health listener error:", err);
      }
    }
  }

  /**
   * Get dependency graph
   * @returns {import("./health.types.js").DependencyGraph}
   */
  getDependencyGraph() {
    const dependents = new Map();

    // Build reverse mapping
    for (const [name, deps] of this.dependencies) {
      for (const dep of deps) {
        if (!dependents.has(dep)) {
          dependents.set(dep, []);
        }
        dependents.get(dep).push(name);
      }
    }

    return {
      dependencies: this.dependencies,
      dependents,
    };
  }

  /**
   * Get failing plugins
   * @returns {import("./health.types.js").PluginHealth[]}
   */
  getFailingPlugins() {
    return Array.from(this.pluginHealth.values()).filter(
      p => p.status === HealthStatus.UNHEALTHY || p.status === HealthStatus.DEGRADED
    );
  }

  /**
   * Get service status summary
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.config.checkInterval,
      pluginsRegistered: this.checkFunctions.size,
      historySize: this.history.length,
    };
  }
}

/**
 * Create a new health service
 * @param {import("./health.types.js").HealthServiceConfig} [config]
 * @returns {HealthService}
 */
export function createHealthService(config) {
  return new HealthService(config);
}

/**
 * Global health service instance
 * @type {HealthService | null}
 */
let globalHealthService = null;

/**
 * Get or create global health service
 * @param {import("./health.types.js").HealthServiceConfig} [config]
 * @returns {HealthService}
 */
export function getHealthService(config) {
  if (!globalHealthService) {
    globalHealthService = new HealthService(config);
  }
  return globalHealthService;
}

/**
 * Set global health service
 * @param {HealthService} service
 */
export function setHealthService(service) {
  globalHealthService = service;
}
