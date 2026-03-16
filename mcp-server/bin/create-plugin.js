#!/usr/bin/env node
/**
 * Plugin Generator
 *
 * Scaffolds a new MCP-Hub plugin from the template.
 *
 * Usage:
 *   node bin/create-plugin.js my-plugin
 *   node bin/create-plugin.js my-plugin "My plugin description"
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, "../src/plugins");
const TEMPLATE_DIR = join(__dirname, "../templates/plugin-template");

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toUpperSnake(name) {
  return name
    .toUpperCase()
    .replace(/-/g, "_")
    .replace(/[^A-Z0-9_]/g, "_");
}

function main() {
  const rawName = process.argv[2];
  const description = process.argv[3] || `A plugin named ${rawName}`;

  if (!rawName) {
    console.error("Usage: node bin/create-plugin.js <plugin-name> [description]");
    console.error("Example: node bin/create-plugin.js my-plugin \"My custom plugin\"");
    process.exit(1);
  }

  const pluginName = slugify(rawName);
  const pluginNameUpper = toUpperSnake(pluginName);
  const pluginDir = join(PLUGINS_DIR, pluginName);

  if (existsSync(pluginDir)) {
    console.error(`Error: Plugin directory already exists: ${pluginDir}`);
    process.exit(1);
  }

  const replacements = {
    "{{PLUGIN_NAME}}": pluginName,
    "{{PLUGIN_NAME_UPPER}}": pluginNameUpper,
    "{{DESCRIPTION}}": description,
  };

  function applyTemplate(content) {
    let out = content;
    for (const [key, val] of Object.entries(replacements)) {
      out = out.split(key).join(val);
    }
    return out;
  }

  mkdirSync(pluginDir, { recursive: true });

  const templateFiles = ["index.js", "plugin.meta.json"];
  for (const file of templateFiles) {
    const src = join(TEMPLATE_DIR, file);
    const dest = join(pluginDir, file);
    if (existsSync(src)) {
      const content = readFileSync(src, "utf-8");
      writeFileSync(dest, applyTemplate(content));
      console.log(`Created ${dest}`);
    }
  }

  console.log("");
  console.log(`Plugin "${pluginName}" created at src/plugins/${pluginName}/`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit src/plugins/${pluginName}/index.js`);
  console.log(`  2. Add tools and routes`);
  console.log(`  3. Run the server - your plugin will load automatically`);
  console.log("");
}

main();
