/**
 * Local filesystem storage adapter.
 */

import { readdir, readFile, writeFile, unlink, copyFile, mkdir, stat } from "fs/promises";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

function getRoot() {
  return resolve(process.cwd(), process.env.FILE_STORAGE_LOCAL_ROOT || "./cache/files");
}

function resolvePath(path) {
  const root = getRoot();
  const full = resolve(root, path);
  if (!full.startsWith(root)) return null;
  return full;
}

export default {
  async list(path) {
    const full = resolvePath(path);
    if (!full) throw new Error("invalid_path");
    if (!existsSync(full)) return { items: [] };

    const entries = await readdir(full, { withFileTypes: true });
    const items = await Promise.all(entries.map(async (e) => {
      const itemPath = path ? `${path}/${e.name}` : e.name;
      let size = null;
      if (e.isFile()) {
        try {
          const s = await stat(resolve(full, e.name));
          size = s.size;
        } catch { /* ignore */ }
      }
      return { name: e.name, path: itemPath, isDir: e.isDirectory(), size };
    }));

    return { items };
  },

  async read(path) {
    const full = resolvePath(path);
    if (!full) throw new Error("invalid_path");
    const buf = await readFile(full);
    return { content: buf.toString("base64"), size: buf.length };
  },

  async write(path, content, contentType) {
    const full = resolvePath(path);
    if (!full) throw new Error("invalid_path");
    const root = getRoot();
    if (!full.startsWith(root)) throw new Error("invalid_path");

    const dir = dirname(full);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, typeof content === "string" && content.length > 0 && !content.includes(",") ? "utf8" : "base64");
    await writeFile(full, buf);
    return { path, size: buf.length };
  },

  async delete(path) {
    const full = resolvePath(path);
    if (!full) throw new Error("invalid_path");
    await unlink(full);
    return { deleted: path };
  },

  async copy(sourcePath, destPath) {
    const src = resolvePath(sourcePath);
    const dst = resolvePath(destPath);
    if (!src || !dst) throw new Error("invalid_path");
    const root = getRoot();
    if (!src.startsWith(root) || !dst.startsWith(root)) throw new Error("invalid_path");

    const dir = dirname(dst);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await copyFile(src, dst);
    return { source: sourcePath, dest: destPath };
  },

  async move(sourcePath, destPath) {
    const src = resolvePath(sourcePath);
    const dst = resolvePath(destPath);
    if (!src || !dst) throw new Error("invalid_path");
    const root = getRoot();
    if (!src.startsWith(root) || !dst.startsWith(root)) throw new Error("invalid_path");

    const dir = dirname(dst);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await copyFile(src, dst);
    await unlink(src);
    return { source: sourcePath, dest: destPath };
  },
};
