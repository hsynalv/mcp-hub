/**
 * Workspace System - Entity Model and Context Management
 * 
 * Defines the workspace hierarchy:
 * workspace → projects → conversations → artifacts/jobs
 * Ensures proper context isolation across all operations.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { config } from "./config.js";

// In-memory storage (replace with Redis/DB in production)
const workspaces = new Map();
const projects = new Map();
const conversations = new Map();

/**
 * Workspace entity
 * @property {string} id - Workspace identifier
 * @property {string} name - Display name
 * @property {string} owner - Owner identifier
 * @property {Object} settings - Workspace settings
 * @property {string} [settings.workspace_root] - Per-workspace root path (overrides base)
 * @property {string[]} [settings.allowed_operations] - Allowed operation types (read, write, index, git, etc.)
 * @property {Object} [settings.plugin_permission_scope] - Per-plugin permission scope
 */
export class Workspace {
  constructor(id, name, owner, options = {}) {
    this.id = id;
    this.name = name;
    this.owner = owner;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.projects = new Set();
    this.settings = {
      defaultEnv: options.defaultEnv || "development",
      allowedPlugins: options.allowedPlugins || [], // empty = all
      maxProjects: options.maxProjects || 10,
      retentionDays: options.retentionDays || 90,
      workspace_root: options.workspace_root || null,
      allowed_operations: options.allowed_operations || [],
      plugin_permission_scope: options.plugin_permission_scope || {},
      readOnly: options.readOnly || false,
      ...options,
    };
    this.metadata = {
      totalJobs: 0,
      totalConversations: 0,
      lastActivity: null,
    };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      owner: this.owner,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      projectCount: this.projects.size,
      settings: this.settings,
      metadata: this.metadata,
    };
  }
}

/**
 * Project entity
 */
export class Project {
  constructor(id, name, workspaceId, options = {}) {
    this.id = id;
    this.name = name;
    this.workspaceId = workspaceId;
    this.env = options.env || "development";
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.config = {
      notionDbId: options.notionDbId || null,
      githubRepo: options.githubRepo || null,
      slackChannel: options.slackChannel || null,
      ...options.config,
    };
    this.secrets = new Map(); // workspace-isolated secrets
    this.indices = new Set(); // RAG index IDs
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      workspaceId: this.workspaceId,
      env: this.env,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      config: this.config,
    };
  }
}

/**
 * Conversation/Session entity
 */
export class Conversation {
  constructor(id, projectId, workspaceId, options = {}) {
    this.id = id;
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.messages = [];
    this.toolCalls = [];
    this.artifacts = []; // Generated files, code, docs
    this.context = {
      ragDocuments: [], // Referenced RAG docs
      activeJobIds: [],
      ...options.context,
    };
  }

  addMessage(role, content, metadata = {}) {
    this.messages.push({
      id: `msg-${Date.now()}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
    this.updatedAt = new Date().toISOString();
  }

  addToolCall(tool, args, result) {
    this.toolCalls.push({
      id: `tc-${Date.now()}`,
      tool,
      args,
      result,
      timestamp: new Date().toISOString(),
      workspaceId: this.workspaceId,
      projectId: this.projectId,
    });
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messageCount: this.messages.length,
      toolCallCount: this.toolCalls.length,
      artifactCount: this.artifacts.length,
    };
  }
}

/**
 * Create or get workspace
 */
export function getOrCreateWorkspace(id, name, owner, options = {}) {
  if (workspaces.has(id)) {
    return workspaces.get(id);
  }

  const workspace = new Workspace(id, name || id, owner, options);
  workspaces.set(id, workspace);
  return workspace;
}

/**
 * Get workspace by ID
 */
export function getWorkspace(id) {
  return workspaces.get(id);
}

/**
 * Create project in workspace
 */
export function createProject(workspaceId, name, options = {}) {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  if (workspace.projects.size >= workspace.settings.maxProjects) {
    throw new Error(`Workspace ${workspaceId} has reached max project limit`);
  }

  const id = `proj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const project = new Project(id, name, workspaceId, options);
  
  projects.set(id, project);
  workspace.projects.add(id);
  workspace.updatedAt = new Date().toISOString();

  return project;
}

/**
 * Get project by ID
 */
export function getProject(id) {
  return projects.get(id);
}

/**
 * Create conversation in project
 */
export function createConversation(projectId, workspaceId, options = {}) {
  const project = projects.get(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const conversation = new Conversation(id, projectId, workspaceId, options);
  
  conversations.set(id, conversation);
  
  const workspace = workspaces.get(workspaceId);
  if (workspace) {
    workspace.metadata.totalConversations++;
    workspace.metadata.lastActivity = new Date().toISOString();
  }

  return conversation;
}

/**
 * Get conversation by ID
 */
export function getConversation(id) {
  return conversations.get(id);
}

/**
 * List workspaces
 */
export function listWorkspaces() {
  return Array.from(workspaces.values()).map(w => w.toJSON());
}

/**
 * List projects in workspace
 */
export function listWorkspaceProjects(workspaceId) {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) return [];

  return Array.from(workspace.projects)
    .map(id => projects.get(id))
    .filter(Boolean)
    .map(p => p.toJSON());
}

/**
 * Resolve workspace context from request
 * Uses x-project-id header to determine workspace
 */
export function resolveWorkspaceContext(projectId) {
  // Find project and its workspace
  for (const [id, project] of projects) {
    if (id === projectId || project.name === projectId) {
      const workspace = workspaces.get(project.workspaceId);
      return {
        workspaceId: project.workspaceId,
        projectId: id,
        env: project.env,
        workspace: workspace?.toJSON(),
        project: project.toJSON(),
      };
    }
  }

  // Auto-create default workspace if not found
  if (projectId) {
    const workspaceId = `ws-${projectId}`;
    const workspace = getOrCreateWorkspace(workspaceId, `Workspace for ${projectId}`, "system");
    const project = createProject(workspaceId, projectId, { env: "development" });
    
    return {
      workspaceId,
      projectId: project.id,
      env: "development",
      workspace: workspace.toJSON(),
      project: project.toJSON(),
    };
  }

  return null;
}

/**
 * Middleware to attach workspace context to request
 */
export function workspaceContextMiddleware(req, res, next) {
  const projectId = req.headers["x-project-id"] || req.projectId;
  
  if (projectId) {
    const context = resolveWorkspaceContext(projectId);
    if (context) {
      req.workspaceContext = context;
      req.workspaceId = context.workspaceId;
    }
  }

  next();
}

/**
 * Get workspace-scoped storage key
 */
export function getWorkspaceKey(workspaceId, type, id) {
  return `${workspaceId}:${type}:${id}`;
}

/**
 * Check if plugin is allowed in workspace
 */
export function isPluginAllowed(workspaceId, pluginName) {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) return true;

  const allowed = workspace.settings.allowedPlugins;
  if (!allowed || allowed.length === 0) return true;

  return allowed.includes(pluginName);
}
