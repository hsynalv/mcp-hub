/**
 * AWS S3 storage adapter.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { createPluginErrorHandler } from "../../../core/error-standard.js";

const pluginError = createPluginErrorHandler("file-storage");

function getClient() {
  const region = process.env.AWS_REGION || "eu-west-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) throw pluginError.validation("AWS credentials not configured - set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  return new S3Client({
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

function getBucket() {
  return process.env.S3_BUCKET || "";
}

export default {
  async list(path) {
    const client = getClient();
    const bucket = getBucket();
    if (!bucket) throw pluginError.validation("S3_BUCKET not configured");
    const prefix = path ? (path.endsWith("/") ? path : `${path}/`) : "";
    const cmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" });
    const out = await client.send(cmd);
    const items = [];
    (out.CommonPrefixes || []).forEach((p) => {
      const name = (p.Prefix || "").replace(prefix, "").replace(/\/$/, "");
      if (name) items.push({ name, path: `${prefix}${name}`, isDir: true, size: null });
    });
    (out.Contents || []).forEach((o) => {
      const key = o.Key || "";
      if (key === prefix) return;
      const name = key.replace(prefix, "").split("/")[0];
      if (name && !items.some((i) => i.name === name)) {
        items.push({ name, path: key, isDir: false, size: o.Size ?? null });
      }
    });
    return { items };
  },

  async read(path) {
    const client = getClient();
    const bucket = getBucket();
    if (!bucket) throw pluginError.validation("S3_BUCKET not configured");
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: path });
    const out = await client.send(cmd);
    const chunks = [];
    for await (const chunk of out.Body) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    return { content: buf.toString("base64"), size: buf.length };
  },

  async write(path, content, contentType) {
    const client = getClient();
    const bucket = getBucket();
    if (!bucket) throw pluginError.validation("S3_BUCKET not configured");
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, typeof content === "string" && /^[A-Za-z0-9+/=]+$/.test(content) ? "base64" : "utf8");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      Body: buf,
      ContentType: contentType || "application/octet-stream",
    }));
    return { path, size: buf.length };
  },

  async delete(path) {
    const client = getClient();
    const bucket = getBucket();
    if (!bucket) throw pluginError.validation("S3_BUCKET not configured");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
    return { deleted: path };
  },

  async copy(sourcePath, destPath) {
    const client = getClient();
    const bucket = getBucket();
    if (!bucket) throw pluginError.validation("S3_BUCKET not configured");
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: destPath,
      CopySource: `${bucket}/${sourcePath}`,
    }));
    return { source: sourcePath, dest: destPath };
  },

  async move(sourcePath, destPath) {
    await this.copy(sourcePath, destPath);
    await this.delete(sourcePath);
    return { source: sourcePath, dest: destPath };
  },
};
