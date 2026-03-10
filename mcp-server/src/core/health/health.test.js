/**
 * Health Service Tests
 *
 * Comprehensive test suite for the health monitoring service.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HealthStatus,
} from "./health.types.js";
import {
  runHealthCheck,
  runHealthCheckWithRetry,
  runHealthChecks,
  calculateOverallStatus,
  isStatusWorse,
} from "./health.checker.js";
import {
  HealthService,
  createHealthService,
  getHealthService,
  setHealthService,
} from "./health.service.js";

describe("Health Service", () => {
  describe("Health Types", () => {
    it("should have correct health status values", () => {
      expect(HealthStatus.HEALTHY).toBe("healthy");
      expect(HealthStatus.DEGRADED).toBe("degraded");
      expect(HealthStatus.UNHEALTHY).toBe("unhealthy");
      expect(HealthStatus.UNKNOWN).toBe("unknown");
    });
  });

  describe("Health Checker", () => {
    describe("runHealthCheck", () => {
      it("should return healthy for successful check", async () => {
        const checkFn = async () => ({
          status: "healthy",
          message: "All good",
        });

        const result = await runHealthCheck(checkFn, "test-service");

        expect(result.name).toBe("test-service");
        expect(result.status).toBe(HealthStatus.HEALTHY);
        expect(result.message).toBe("All good");
        expect(result.timestamp).toBeGreaterThan(0);
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      });

      it("should return unhealthy for failed check", async () => {
        const checkFn = async () => {
          throw new Error("Service failed");
        };

        const result = await runHealthCheck(checkFn, "test-service");

        expect(result.status).toBe(HealthStatus.UNHEALTHY);
        expect(result.message).toBe("Service failed");
        expect(result.error).toBeDefined();
      });

      it("should timeout on slow checks", async () => {
        const checkFn = async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return { status: "healthy" };
        };

        const result = await runHealthCheck(checkFn, "test-service", {}, 100);

        expect(result.status).toBe(HealthStatus.UNHEALTHY);
        expect(result.message).toContain("timed out");
      });

      it("should normalize various status strings", async () => {
        const tests = [
          { input: "ok", expected: HealthStatus.HEALTHY },
          { input: "good", expected: HealthStatus.HEALTHY },
          { input: "up", expected: HealthStatus.HEALTHY },
          { input: "warning", expected: HealthStatus.DEGRADED },
          { input: "slow", expected: HealthStatus.DEGRADED },
          { input: "error", expected: HealthStatus.UNHEALTHY },
          { input: "down", expected: HealthStatus.UNHEALTHY },
          { input: "failed", expected: HealthStatus.UNHEALTHY },
          { input: "unknown", expected: HealthStatus.UNKNOWN },
          { input: null, expected: HealthStatus.UNKNOWN },
        ];

        for (const test of tests) {
          const checkFn = async () => ({ status: test.input });
          const result = await runHealthCheck(checkFn, "test");
          expect(result.status).toBe(test.expected);
        }
      });
    });

    describe("runHealthCheckWithRetry", () => {
      it("should succeed on first attempt", async () => {
        const checkFn = async () => ({ status: "healthy" });

        const result = await runHealthCheckWithRetry(checkFn, "test");

        expect(result.status).toBe(HealthStatus.HEALTHY);
      });

      it("should retry on failure and succeed", async () => {
        let attempts = 0;
        const checkFn = async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error("Not ready");
          }
          return { status: "healthy" };
        };

        const result = await runHealthCheckWithRetry(checkFn, "test", {}, {
          maxRetries: 3,
          retryDelay: 10,
        });

        expect(result.status).toBe(HealthStatus.HEALTHY);
        expect(attempts).toBe(3);
        expect(result.message).toContain("recovered");
      });

      it("should fail after max retries", async () => {
        const checkFn = async () => {
          throw new Error("Always fails");
        };

        const result = await runHealthCheckWithRetry(checkFn, "test", {}, {
          maxRetries: 2,
          retryDelay: 10,
        });

        expect(result.status).toBe(HealthStatus.UNHEALTHY);
        expect(result.message).toBe("Always fails");
      });
    });

    describe("runHealthChecks", () => {
      it("should run multiple checks in parallel", async () => {
        const checks = [
          { name: "service1", checkFn: async () => ({ status: "healthy" }) },
          { name: "service2", checkFn: async () => ({ status: "healthy" }) },
          { name: "service3", checkFn: async () => ({ status: "degraded" }) },
        ];

        const results = await runHealthChecks(checks, { parallel: true });

        expect(results).toHaveLength(3);
        expect(results[0].status).toBe(HealthStatus.HEALTHY);
        expect(results[1].status).toBe(HealthStatus.HEALTHY);
        expect(results[2].status).toBe(HealthStatus.DEGRADED);
      });

      it("should run checks sequentially when parallel is false", async () => {
        const order = [];
        const checks = [
          {
            name: "service1",
            checkFn: async () => {
              order.push(1);
              return { status: "healthy" };
            },
          },
          {
            name: "service2",
            checkFn: async () => {
              order.push(2);
              return { status: "healthy" };
            },
          },
        ];

        await runHealthChecks(checks, { parallel: false });

        expect(order).toEqual([1, 2]);
      });
    });

    describe("calculateOverallStatus", () => {
      it("should return healthy when all checks are healthy", () => {
        const results = [
          { status: HealthStatus.HEALTHY },
          { status: HealthStatus.HEALTHY },
        ];

        expect(calculateOverallStatus(results)).toBe(HealthStatus.HEALTHY);
      });

      it("should return degraded when any check is degraded", () => {
        const results = [
          { status: HealthStatus.HEALTHY },
          { status: HealthStatus.DEGRADED },
        ];

        expect(calculateOverallStatus(results)).toBe(HealthStatus.DEGRADED);
      });

      it("should return unhealthy when any check is unhealthy", () => {
        const results = [
          { status: HealthStatus.HEALTHY },
          { status: HealthStatus.DEGRADED },
          { status: HealthStatus.UNHEALTHY },
        ];

        expect(calculateOverallStatus(results)).toBe(HealthStatus.UNHEALTHY);
      });

      it("should return degraded when only unknown", () => {
        const results = [
          { status: HealthStatus.UNKNOWN },
          { status: HealthStatus.UNKNOWN },
        ];

        expect(calculateOverallStatus(results)).toBe(HealthStatus.DEGRADED);
      });

      it("should return unknown for empty results", () => {
        expect(calculateOverallStatus([])).toBe(HealthStatus.UNKNOWN);
      });
    });

    describe("isStatusWorse", () => {
      it("should correctly compare status severity", () => {
        expect(isStatusWorse(HealthStatus.UNHEALTHY, HealthStatus.HEALTHY)).toBe(true);
        expect(isStatusWorse(HealthStatus.UNHEALTHY, HealthStatus.DEGRADED)).toBe(true);
        expect(isStatusWorse(HealthStatus.DEGRADED, HealthStatus.HEALTHY)).toBe(true);
        expect(isStatusWorse(HealthStatus.HEALTHY, HealthStatus.UNHEALTHY)).toBe(false);
        expect(isStatusWorse(HealthStatus.HEALTHY, HealthStatus.DEGRADED)).toBe(false);
        expect(isStatusWorse(HealthStatus.DEGRADED, HealthStatus.UNHEALTHY)).toBe(false);
      });
    });
  });

  describe("Health Service", () => {
    let service;

    beforeEach(() => {
      service = createHealthService({
        checkInterval: 1000,
        checkTimeout: 500,
        autoStart: false,
      });
    });

    afterEach(() => {
      service.stop();
    });

    describe("Registration", () => {
      it("should register a plugin", () => {
        service.registerPlugin(
          "test-plugin",
          async () => ({ status: "healthy" }),
          { version: "1.0.0" },
          ["dependency1"]
        );

        const health = service.getPluginHealth("test-plugin");

        expect(health).toBeDefined();
        expect(health.name).toBe("test-plugin");
        expect(health.version).toBe("1.0.0");
        expect(health.dependencies).toEqual(["dependency1"]);
        expect(health.enabled).toBe(true);
      });

      it("should unregister a plugin", () => {
        service.registerPlugin("test", async () => ({ status: "healthy" }));

        service.unregisterPlugin("test");

        expect(service.getPluginHealth("test")).toBeUndefined();
      });

      it("should track multiple plugins", () => {
        service.registerPlugin("plugin1", async () => ({ status: "healthy" }));
        service.registerPlugin("plugin2", async () => ({ status: "healthy" }));

        expect(service.getStatus().pluginsRegistered).toBe(2);
      });
    });

    describe("Health Checks", () => {
      it("should run health check for a plugin", async () => {
        service.registerPlugin("test", async () => ({
          status: "healthy",
          message: "All good",
        }));

        const result = await service.checkPlugin("test");

        expect(result.status).toBe(HealthStatus.HEALTHY);
        expect(result.message).toBe("All good");
      });

      it("should run all health checks", async () => {
        service.registerPlugin("p1", async () => ({ status: "healthy" }));
        service.registerPlugin("p2", async () => ({ status: "healthy" }));

        const health = await service.runChecks();

        expect(health.status).toBe(HealthStatus.HEALTHY);
        expect(health.summary.total).toBe(2);
        expect(health.summary.healthy).toBe(2);
        expect(health.plugins).toHaveLength(2);
      });

      it("should track consecutive failures", async () => {
        let shouldFail = true;
        service.registerPlugin("test", async () => {
          if (shouldFail) {
            throw new Error("Failed");
          }
          return { status: "healthy" };
        });

        await service.checkPlugin("test");
        await service.checkPlugin("test");

        const health = service.getPluginHealth("test");
        expect(health.consecutiveFailures).toBe(2);

        shouldFail = false;
        await service.checkPlugin("test");
        expect(health.consecutiveFailures).toBe(0);
      });

      it("should not check disabled plugins", async () => {
        service.registerPlugin("test", async () => ({ status: "healthy" }));
        service.setPluginEnabled("test", false);

        const health = await service.runChecks();

        expect(health.summary.total).toBe(0);
      });
    });

    describe("Dependency Tracking", () => {
      it("should detect dependency failures", async () => {
        service.registerPlugin(
          "dependency",
          async () => ({ status: "unhealthy" }),
          { version: "1.0.0" }
        );
        service.registerPlugin(
          "dependent",
          async () => ({ status: "healthy" }),
          { version: "1.0.0" },
          ["dependency"]
        );

        await service.runChecks();

        const dependentHealth = service.getPluginHealth("dependent");
        expect(dependentHealth.status).toBe(HealthStatus.DEGRADED);
        expect(dependentHealth.message).toContain("dependency");
      });

      it("should build dependency graph", () => {
        service.registerPlugin("dep1", async () => ({}), {}, []);
        service.registerPlugin("dep2", async () => ({}), {}, ["dep1"]);
        service.registerPlugin("dep3", async () => ({}), {}, ["dep1", "dep2"]);

        const graph = service.getDependencyGraph();

        expect(graph.dependencies.get("dep2")).toEqual(["dep1"]);
        expect(graph.dependencies.get("dep3")).toEqual(["dep1", "dep2"]);
        expect(graph.dependents.get("dep1")).toContain("dep2");
        expect(graph.dependents.get("dep1")).toContain("dep3");
      });
    });

    describe("History", () => {
      it("should track health history", async () => {
        service.registerPlugin("test", async () => ({ status: "healthy" }));

        await service.runChecks();
        await service.runChecks();

        const history = service.getHistory();
        expect(history).toHaveLength(2);
      });

      it("should limit history size", async () => {
        service = createHealthService({
          maxHistory: 3,
          autoStart: false,
        });

        service.registerPlugin("test", async () => ({ status: "healthy" }));

        await service.runChecks();
        await service.runChecks();
        await service.runChecks();
        await service.runChecks();

        expect(service.getHistory()).toHaveLength(3);
      });

      it("should return limited history", async () => {
        service.registerPlugin("test", async () => ({ status: "healthy" }));

        await service.runChecks();
        await service.runChecks();
        await service.runChecks();

        const history = service.getHistory(2);
        expect(history).toHaveLength(2);
      });
    });

    describe("Subscriptions", () => {
      it("should notify subscribers", async () => {
        const notifications = [];
        service.registerPlugin("test", async () => ({ status: "healthy" }));
        service.subscribe((health) => {
          notifications.push(health);
        });

        await service.runChecks();

        expect(notifications).toHaveLength(1);
        expect(notifications[0].status).toBe(HealthStatus.HEALTHY);
      });

      it("should allow unsubscribing", async () => {
        const notifications = [];
        const unsubscribe = service.subscribe((health) => {
          notifications.push(health);
        });

        unsubscribe();
        await service.runChecks();

        expect(notifications).toHaveLength(0);
      });
    });

    describe("Monitoring", () => {
      it("should start and stop monitoring", () => {
        expect(service.getStatus().isRunning).toBe(false);

        service.start();
        expect(service.getStatus().isRunning).toBe(true);

        service.stop();
        expect(service.getStatus().isRunning).toBe(false);
      });

      it("should not start twice", () => {
        service.start();
        service.start(); // Should not throw
        expect(service.getStatus().isRunning).toBe(true);
      });
    });

    describe("Failing Plugins", () => {
      it("should get failing plugins", async () => {
        service.registerPlugin("healthy", async () => ({ status: "healthy" }));
        service.registerPlugin("unhealthy", async () => ({ status: "unhealthy" }));
        service.registerPlugin("degraded", async () => ({ status: "degraded" }));

        await service.runChecks();

        const failing = service.getFailingPlugins();
        expect(failing).toHaveLength(2);
        expect(failing.map(p => p.name)).toContain("unhealthy");
        expect(failing.map(p => p.name)).toContain("degraded");
      });
    });

    describe("Global Instance", () => {
      it("should use global instance", () => {
        setHealthService(null);

        const service1 = getHealthService();
        const service2 = getHealthService();

        expect(service1).toBe(service2);
      });

      it("should set global instance", () => {
        const newService = createHealthService();
        setHealthService(newService);

        expect(getHealthService()).toBe(newService);
      });
    });
  });
});
