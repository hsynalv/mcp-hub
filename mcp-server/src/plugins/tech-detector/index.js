/**
 * Tech Stack Detector Plugin
 *
 * Analyzes project directories to detect technologies, frameworks,
 * libraries, and infrastructure configurations.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, extname, basename } from "path";
import { Router } from "express";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { validateWorkspacePath, requireWorkspaceId } from "../../core/workspace-paths.js";

const handleError = createPluginErrorHandler("tech-detector");

function safePath(requestedPath, workspaceId = "global") {
  requireWorkspaceId(workspaceId, "tech_detect");
  const result = validateWorkspacePath(requestedPath || ".", workspaceId);
  if (!result.valid) {
    return { valid: false, error: result.reason || result.error || "Path outside allowed workspace", path: null };
  }
  return { valid: true, path: result.resolvedPath };
}

export const metadata = createMetadata({
  name:        "tech-detector",
  version:     "1.0.0",
  description: "Detect project technology stack: languages, frameworks, databases, CI/CD, and infrastructure.",
  status:      PluginStatus.STABLE,
  riskLevel:   RiskLevel.LOW,
  capabilities: ["read"],
  requires:    [],
  tags:        ["tech", "stack", "detection", "analysis"],
  endpoints: [
    { method: "GET",  path: "/tech/health",    description: "Plugin health",                   scope: "read"  },
    { method: "POST", path: "/tech/detect",    description: "Detect project tech stack",        scope: "read"  },
    { method: "POST", path: "/tech/recommend", description: "Recommend stack for new project",  scope: "read"  },
    { method: "POST", path: "/tech/compare",   description: "Compare two technologies",         scope: "read"  },
  ],
  notes: "Paths are validated against WORKSPACE_BASE. No external API calls — purely file-based analysis.",
});

// Detection patterns for various technologies
const DETECTION_PATTERNS = {
  // Languages & Runtimes
  javascript: {
    files: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
    extensions: [".js", ".mjs", ".cjs"],
    confidence: 0.9,
  },
  typescript: {
    files: ["tsconfig.json", "tsconfig.*.json"],
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    confidence: 0.95,
  },
  python: {
    files: ["requirements.txt", "Pipfile", "pyproject.toml", "setup.py", "poetry.lock"],
    extensions: [".py", ".pyw", ".pyi"],
    confidence: 0.9,
  },
  go: {
    files: ["go.mod", "go.sum"],
    extensions: [".go"],
    confidence: 0.95,
  },
  rust: {
    files: ["Cargo.toml", "Cargo.lock"],
    extensions: [".rs"],
    confidence: 0.95,
  },
  java: {
    files: ["pom.xml", "build.gradle", "build.gradle.kts", "gradlew"],
    extensions: [".java", ".kt", ".scala"],
    confidence: 0.9,
  },

  // Frontend Frameworks
  react: {
    files: [],
    extensions: [],
    packageDeps: ["react", "react-dom"],
    confidence: 0.95,
  },
  vue: {
    files: [],
    extensions: [".vue"],
    packageDeps: ["vue", "vue-router", "vuex", "pinia"],
    confidence: 0.95,
  },
  nextjs: {
    files: ["next.config.js", "next.config.mjs", "next.config.ts"],
    extensions: [],
    packageDeps: ["next"],
    confidence: 0.95,
  },
  svelte: {
    files: ["svelte.config.js"],
    extensions: [".svelte"],
    packageDeps: ["svelte"],
    confidence: 0.95,
  },
  angular: {
    files: ["angular.json"],
    extensions: [".component.ts"],
    packageDeps: ["@angular/core"],
    confidence: 0.95,
  },

  // Styling
  tailwind: {
    files: ["tailwind.config.js", "tailwind.config.ts"],
    packageDeps: ["tailwindcss"],
    confidence: 0.95,
  },
  bootstrap: {
    packageDeps: ["bootstrap"],
    confidence: 0.9,
  },
  sass: {
    extensions: [".scss", ".sass"],
    packageDeps: ["sass", "node-sass"],
    confidence: 0.9,
  },

  // Backend Frameworks
  express: {
    packageDeps: ["express"],
    confidence: 0.9,
  },
  fastify: {
    packageDeps: ["fastify"],
    confidence: 0.9,
  },
  nestjs: {
    packageDeps: ["@nestjs/core"],
    confidence: 0.95,
  },
  django: {
    files: ["manage.py"],
    packageDeps: ["Django"],
    confidence: 0.95,
  },
  flask: {
    packageDeps: ["Flask"],
    confidence: 0.9,
  },
  fastapi: {
    packageDeps: ["fastapi"],
    confidence: 0.9,
  },

  // Databases
  postgresql: {
    files: [],
    packageDeps: ["pg", "psycopg2", "psycopg2-binary"],
    envVars: ["DATABASE_URL", "POSTGRES_URL", "PGHOST"],
    confidence: 0.9,
  },
  mongodb: {
    files: [],
    packageDeps: ["mongodb", "mongoose"],
    envVars: ["MONGODB_URI", "MONGO_URL"],
    confidence: 0.9,
  },
  redis: {
    files: [],
    packageDeps: ["redis", "ioredis"],
    envVars: ["REDIS_URL", "REDIS_HOST"],
    confidence: 0.9,
  },
  prisma: {
    files: ["prisma/schema.prisma"],
    packageDeps: ["@prisma/client", "prisma"],
    confidence: 0.95,
  },
  drizzle: {
    files: [],
    packageDeps: ["drizzle-orm"],
    confidence: 0.9,
  },
  typeorm: {
    packageDeps: ["typeorm"],
    confidence: 0.9,
  },

  // DevOps & Infrastructure
  docker: {
    files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"],
    confidence: 0.95,
  },
  kubernetes: {
    files: ["k8s/", "kubernetes/", "deployment.yaml", "service.yaml"],
    confidence: 0.9,
  },
  terraform: {
    files: ["*.tf", "main.tf", "variables.tf", "outputs.tf"],
    confidence: 0.95,
  },
  github_actions: {
    files: [".github/workflows/"],
    confidence: 0.95,
  },
  gitlab_ci: {
    files: [".gitlab-ci.yml"],
    confidence: 0.95,
  },
  jenkins: {
    files: ["Jenkinsfile"],
    confidence: 0.95,
  },

  // Build Tools
  vite: {
    files: ["vite.config.js", "vite.config.ts"],
    packageDeps: ["vite"],
    confidence: 0.95,
  },
  webpack: {
    files: ["webpack.config.js", "webpack.config.ts"],
    packageDeps: ["webpack"],
    confidence: 0.9,
  },
  rollup: {
    files: ["rollup.config.js"],
    packageDeps: ["rollup"],
    confidence: 0.9,
  },
  esbuild: {
    packageDeps: ["esbuild"],
    confidence: 0.9,
  },
  tsup: {
    packageDeps: ["tsup"],
    confidence: 0.9,
  },

  // Testing
  jest: {
    files: ["jest.config.js", "jest.config.ts"],
    packageDeps: ["jest"],
    confidence: 0.95,
  },
  vitest: {
    files: ["vitest.config.js", "vitest.config.ts"],
    packageDeps: ["vitest"],
    confidence: 0.95,
  },
  cypress: {
    files: ["cypress.config.js", "cypress/"],
    packageDeps: ["cypress"],
    confidence: 0.95,
  },
  playwright: {
    files: ["playwright.config.js", "playwright.config.ts"],
    packageDeps: ["@playwright/test"],
    confidence: 0.95,
  },

  // AI/ML
  openai: {
    packageDeps: ["openai"],
    confidence: 0.95,
  },
  langchain: {
    packageDeps: ["langchain", "@langchain/core"],
    confidence: 0.95,
  },
  transformers: {
    packageDeps: ["@xenova/transformers", "@huggingface/transformers"],
    confidence: 0.9,
  },

  // State Management
  redux: {
    packageDeps: ["redux", "@reduxjs/toolkit", "react-redux"],
    confidence: 0.9,
  },
  zustand: {
    packageDeps: ["zustand"],
    confidence: 0.95,
  },
  jotai: {
    packageDeps: ["jotai"],
    confidence: 0.9,
  },

  // UI Libraries
  shadcn: {
    files: ["components.json"],
    packageDeps: ["class-variance-authority", "clsx", "tailwind-merge"],
    confidence: 0.9,
  },
  material_ui: {
    packageDeps: ["@mui/material", "@material-ui/core"],
    confidence: 0.95,
  },
  antd: {
    packageDeps: ["antd"],
    confidence: 0.95,
  },
};

/**
 * Check if a file exists
 */
async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse JSON file
 */
async function readJsonFile(path) {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get all files in directory recursively (limited depth)
 */
async function getFiles(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return [];

  const files = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...await getFiles(path, depth + 1, maxDepth));
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  } catch {
    // Ignore permission errors
  }
  return files;
}

/**
 * Detect technologies in a project directory
 */
export async function detectStack(projectPath) {
  const detected = {
    languages: [],
    frontend: {},
    backend: {},
    database: {},
    devops: {},
    testing: {},
    ai: {},
    state: {},
    ui: {},
    build: {},
    confidence: 0,
  };

  const scores = {};

  // Get all files
  const allFiles = await getFiles(projectPath);
  const fileNames = allFiles.map(f => basename(f));
  const extensions = allFiles.map(f => extname(f).toLowerCase());

  // Read package.json if exists
  const packageJson = await readJsonFile(join(projectPath, "package.json"));
  const allDeps = {
    ...((packageJson?.dependencies) || {}),
    ...((packageJson?.devDependencies) || {}),
  };
  const depNames = Object.keys(allDeps);

  // Read requirements.txt if exists
  let pythonDeps = [];
  try {
    const reqContent = await readFile(join(projectPath, "requirements.txt"), "utf-8");
    pythonDeps = reqContent.split("\n").filter(l => l.trim() && !l.startsWith("#"));
  } catch { /* ignore */ }

  // Read pyproject.toml if exists
  let pyprojectDeps = [];
  try {
    const pyproject = await readJsonFile(join(projectPath, "pyproject.toml"));
    if (pyproject?.tool?.poetry?.dependencies) {
      pyprojectDeps = Object.keys(pyproject.tool.poetry.dependencies);
    }
  } catch { /* ignore */ }

  // Check each detection pattern
  for (const [tech, pattern] of Object.entries(DETECTION_PATTERNS)) {
    let score = 0;
    let checks = 0;

    // Check files
    if (pattern.files) {
      for (const file of pattern.files) {
        checks++;
        if (file.includes("*")) {
          // Glob pattern
          const prefix = file.replace("*", "");
          if (fileNames.some(f => f.startsWith(prefix))) {
            score += 1;
          }
        } else if (file.endsWith("/")) {
          // Directory
          if (await fileExists(join(projectPath, file))) {
            score += 1;
          }
        } else {
          // Specific file
          if (fileNames.includes(file) || await fileExists(join(projectPath, file))) {
            score += 1;
          }
        }
      }
    }

    // Check extensions
    if (pattern.extensions) {
      for (const ext of pattern.extensions) {
        checks++;
        if (extensions.some(e => e.toLowerCase() === ext.toLowerCase())) {
          score += 1;
          break; // One match is enough for extensions
        }
      }
    }

    // Check package dependencies (Node.js)
    if (pattern.packageDeps && depNames.length > 0) {
      for (const dep of pattern.packageDeps) {
        checks++;
        if (depNames.some(d => d === dep || d.startsWith(dep + "/"))) {
          score += 1;
        }
      }
    }

    // Check Python dependencies
    if (pattern.packageDeps && pythonDeps.length > 0) {
      for (const dep of pattern.packageDeps) {
        checks++;
        if (pythonDeps.some(d => d.toLowerCase().startsWith(dep.toLowerCase()))) {
          score += 1;
        }
      }
    }

    // Calculate confidence
    if (checks > 0) {
      const confidence = (score / checks) * (pattern.confidence || 0.8);
      if (confidence > 0.5) {
        scores[tech] = confidence;
      }
    }
  }

  // Categorize detected technologies
  const langMap = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    go: "Go",
    rust: "Rust",
    java: "Java",
  };

  const frontendFrameworks = ["react", "vue", "nextjs", "svelte", "angular"];
  const styling = ["tailwind", "bootstrap", "sass"];
  const backendFrameworks = ["express", "fastify", "nestjs", "django", "flask", "fastapi"];
  const databases = ["postgresql", "mongodb", "redis", "prisma", "drizzle", "typeorm"];
  const devopsTools = ["docker", "kubernetes", "terraform", "github_actions", "gitlab_ci", "jenkins"];
  const buildTools = ["vite", "webpack", "rollup", "esbuild", "tsup"];
  const testingTools = ["jest", "vitest", "cypress", "playwright"];
  const aiTools = ["openai", "langchain", "transformers"];
  const stateTools = ["redux", "zustand", "jotai"];
  const uiLibs = ["shadcn", "material_ui", "antd"];

  // Populate categories
  for (const [tech, confidence] of Object.entries(scores)) {
    if (langMap[tech]) {
      detected.languages.push({ name: langMap[tech], confidence });
    } else if (frontendFrameworks.includes(tech)) {
      detected.frontend.framework = { name: tech, confidence, version: allDeps[tech] };
    } else if (styling.includes(tech)) {
      detected.frontend.styling = { name: tech, confidence };
    } else if (backendFrameworks.includes(tech)) {
      detected.backend.framework = { name: tech, confidence };
    } else if (databases.includes(tech)) {
      if (tech === "prisma" || tech === "drizzle" || tech === "typeorm") {
        detected.backend.orm = { name: tech, confidence };
      } else {
        detected.backend.database = { name: tech, confidence };
      }
    } else if (devopsTools.includes(tech)) {
      detected.devops[tech] = { name: tech, confidence };
    } else if (buildTools.includes(tech)) {
      detected.build.tool = { name: tech, confidence };
    } else if (testingTools.includes(tech)) {
      detected.testing.framework = { name: tech, confidence };
    } else if (aiTools.includes(tech)) {
      detected.ai[tech] = { name: tech, confidence };
    } else if (stateTools.includes(tech)) {
      detected.state.manager = { name: tech, confidence };
    } else if (uiLibs.includes(tech)) {
      detected.ui.library = { name: tech, confidence };
    }
  }

  // Calculate overall confidence
  const allScores = Object.values(scores);
  detected.confidence = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0;

  // Extract project name
  try {
    detected.projectName = packageJson?.name || basename(projectPath);
  } catch {
    detected.projectName = basename(projectPath);
  }

  return detected;
}

/**
 * Recommend tech stack for a new project
 */
export function recommendStack(requirements) {
  const { type, scale, team, priorities } = requirements;

  const recommendations = {
    frontend: {},
    backend: {},
    database: {},
    devops: {},
    ai: {},
  };

  // Frontend recommendations
  if (type === "web-app" || type === "dashboard") {
    if (priorities?.includes("performance")) {
      recommendations.frontend = {
        framework: "Next.js 14",
        styling: "Tailwind CSS",
        ui: "shadcn/ui",
        state: "Zustand",
      };
    } else if (priorities?.includes("developer-experience")) {
      recommendations.frontend = {
        framework: "Next.js 14",
        styling: "Tailwind CSS",
        ui: "shadcn/ui",
        state: "Zustand",
      };
    } else {
      recommendations.frontend = {
        framework: "React + Vite",
        styling: "Tailwind CSS",
        ui: "Material UI",
        state: "Redux Toolkit",
      };
    }
  }

  // Backend recommendations
  if (scale === "small" || scale === "prototype") {
    recommendations.backend = {
      runtime: "Node.js",
      framework: "Express",
      database: "PostgreSQL",
      orm: "Prisma",
    };
  } else if (scale === "medium") {
    recommendations.backend = {
      runtime: "Node.js",
      framework: "Fastify",
      database: "PostgreSQL",
      orm: "Prisma",
    };
  } else {
    recommendations.backend = {
      runtime: "Node.js",
      framework: "NestJS",
      database: "PostgreSQL",
      orm: "Prisma",
      cache: "Redis",
    };
  }

  // DevOps recommendations
  recommendations.devops = {
    container: "Docker",
    ci: "GitHub Actions",
    deploy: scale === "small" ? "Vercel" : "AWS/GCP",
  };

  // AI recommendations
  if (priorities?.includes("ai-features")) {
    recommendations.ai = {
      llm: "OpenAI GPT-4o",
      embeddings: "OpenAI text-embedding-3-small",
      vectorDb: "Pinecone",
    };
  }

  return recommendations;
}

/**
 * Compare two tech options
 */
export function compareTech(optionA, optionB, criteria) {
  const comparisons = {
    "nextjs-vs-react": {
      nextjs: {
        pros: ["SSR/SSG out of the box", "File-based routing", "Image optimization", "API routes"],
        cons: ["Learning curve", "Vercel lock-in concerns"],
        bestFor: ["SEO-critical apps", "Marketing sites", "E-commerce"],
      },
      react: {
        pros: ["More flexible", "Larger ecosystem", "Easier to customize"],
        cons: ["Need to set up routing", "No built-in optimization"],
        bestFor: ["SPAs", "Dashboards", "Custom architectures"],
      },
    },
    "prisma-vs-drizzle": {
      prisma: {
        pros: ["Type-safe queries", "Great DX", "Migrations", "Studio GUI"],
        cons: ["Bundle size", "Query overhead"],
        bestFor: ["Rapid development", "Team projects"],
      },
      drizzle: {
        pros: ["Lightweight", "SQL-like syntax", "Better performance"],
        cons: ["Newer ecosystem", "Less tooling"],
        bestFor: ["Performance-critical", "SQL experts"],
      },
    },
  };

  const key = `${optionA}-vs-${optionB}`.toLowerCase();
  const reverseKey = `${optionB}-vs-${optionA}`.toLowerCase();

  return comparisons[key] || comparisons[reverseKey] || {
    error: "Comparison not available",
    available: Object.keys(comparisons),
  };
}

// MCP Tools
export const tools = [
  {
    name: "tech_detect",
    description: "Analyze a project directory to detect its technology stack: languages, frameworks, databases, CI/CD, and infrastructure.",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the project directory (must be inside WORKSPACE_BASE)" },
      },
      required: ["path"],
    },
    handler: async ({ path }, context = {}) => {
      const wid = context.workspaceId ?? "global";
      const v = safePath(path, wid);
      if (!v.valid) return { ok: false, error: { code: "invalid_path", message: v.error } };
      try {
        const stack = await detectStack(v.path);
        return { ok: true, data: stack };
      } catch (error) {
        return { ok: false, error: { code: "detection_failed", message: error.message } };
      }
    },
  },
  {
    name: "tech_recommend",
    description: "Get tech stack recommendations for a new project based on project type, scale, team size, and priorities.",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["web-app", "api", "dashboard", "e-commerce", "mobile"],
          description: "Project type",
        },
        scale: {
          type: "string",
          enum: ["small", "medium", "large", "enterprise"],
          description: "Project scale",
        },
        team: {
          type: "string",
          enum: ["solo", "small", "medium", "large"],
          description: "Team size",
        },
        priorities: {
          type: "array",
          items: { type: "string", enum: ["performance", "developer-experience", "cost", "ai-features", "seo"] },
          description: "Project priorities",
        },
      },
      required: ["type"],
    },
    handler: ({ type, scale = "medium", team = "small", priorities = [] }) => {
      const recommendations = recommendStack({ type, scale, team, priorities });
      return { ok: true, data: recommendations };
    },
  },
  {
    name: "tech_compare",
    description: "Compare two technologies or frameworks across given criteria (performance, ecosystem, learning curve, etc.).",
    tags: [ToolTags.READ_ONLY],
    inputSchema: {
      type: "object",
      properties: {
        optionA:  { type: "string", description: "First technology" },
        optionB:  { type: "string", description: "Second technology" },
        criteria: { type: "array", items: { type: "string" }, description: "Comparison criteria (optional)" },
      },
      required: ["optionA", "optionB"],
    },
    handler: ({ optionA, optionB, criteria = [] }) => {
      const comparison = compareTech(optionA, optionB, criteria);
      return { ok: true, data: comparison };
    },
  },
];

// Plugin registration
export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, plugin: "tech-detector", version: "1.0.0", status: "healthy" });
  });

  router.post("/detect", requireScope("read"), async (req, res) => {
    const wid = req.headers["x-workspace-id"] ?? "global";
    const v = safePath(req.body.path || ".", wid);
    if (!v.valid) return res.status(400).json({ ok: false, error: { code: "invalid_path", message: v.error } });
    try {
      const stack = await detectStack(v.path);
      res.json({ ok: true, data: stack });
    } catch (err) {
      res.status(500).json(handleError(err, "detect"));
    }
  });

  router.post("/recommend", requireScope("read"), (req, res) => {
    try {
      const { type, scale, team, priorities } = req.body;
      if (!type) return res.status(400).json({ ok: false, error: { code: "missing_type", message: "Project type required" } });
      const recommendations = recommendStack({ type, scale, team, priorities });
      res.json({ ok: true, data: recommendations });
    } catch (err) {
      res.status(500).json(handleError(err, "recommend"));
    }
  });

  router.post("/compare", requireScope("read"), (req, res) => {
    try {
      const { optionA, optionB, criteria } = req.body;
      if (!optionA || !optionB) return res.status(400).json({ ok: false, error: { code: "missing_options", message: "optionA and optionB required" } });
      const comparison = compareTech(optionA, optionB, criteria);
      res.json({ ok: true, data: comparison });
    } catch (err) {
      res.status(500).json(handleError(err, "compare"));
    }
  });

  app.use("/tech", router);
}
