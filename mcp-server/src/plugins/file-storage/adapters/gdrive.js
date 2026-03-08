/**
 * Google Drive storage adapter.
 * Requires: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
 */

import { google } from "googleapis";
import { createPluginErrorHandler } from "../../../core/error-standard.js";

const pluginError = createPluginErrorHandler("file-storage");

function getDrive() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw pluginError.validation("Google Drive credentials not configured - set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth2:0:oob");
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

function pathToId(path) {
  if (!path || path === "." || path === "/") return "root";
  return path.replace(/^\//, "").replace(/\/$/, "");
}

export default {
  async list(path) {
    const drive = getDrive();
    const folderId = pathToId(path);
    const q = folderId === "root"
      ? "'root' in parents and trashed = false"
      : `'${folderId}' in parents and trashed = false`;
    const res = await drive.files.list({
      q,
      fields: "files(id, name, mimeType, size)",
      pageSize: 100,
    });
    const items = (res.data.files || []).map((f) => ({
      name:   f.name,
      path:   f.id,
      isDir:  f.mimeType === "application/vnd.google-apps.folder",
      size:   f.size ? parseInt(f.size, 10) : null,
    }));
    return { items };
  },

  async read(path) {
    const drive = getDrive();
    const fileId = pathToId(path);
    if (fileId === "root") throw pluginError.validation("Cannot modify root directory");
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const buf = Buffer.from(res.data);
    return { content: buf.toString("base64"), size: buf.length };
  },

  async write(path, content, contentType) {
    const drive = getDrive();
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, typeof content === "string" && /^[A-Za-z0-9+/=]+$/.test(content) ? "base64" : "utf8");
    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop() || "file";
    const parentId = parts.length ? parts[0] : "root";
    const metadata = { name: fileName, parents: [parentId] };
    const media = { mimeType: contentType || "application/octet-stream", body: buf };
    const file = await drive.files.create({ requestBody: metadata, media });
    return { path: file.data.id, size: buf.length };
  },

  async delete(path) {
    const drive = getDrive();
    const fileId = pathToId(path);
    if (fileId === "root") throw pluginError.validation("Cannot modify root directory");
    await drive.files.delete({ fileId });
    return { deleted: path };
  },

  async copy(sourcePath, destPath) {
    const drive = getDrive();
    const fileId = pathToId(sourcePath);
    const destName = destPath.split("/").pop() || "copy";
    const res = await drive.files.copy({ fileId, requestBody: { name: destName } });
    return { source: sourcePath, dest: res.data.id };
  },

  async move(sourcePath, destPath) {
    const drive = getDrive();
    const fileId = pathToId(sourcePath);
    const destName = destPath.split("/").pop() || pathToId(sourcePath);
    const res = await drive.files.copy({ fileId, requestBody: { name: destName } });
    await drive.files.delete({ fileId });
    return { source: sourcePath, dest: res.data.id };
  },
};
