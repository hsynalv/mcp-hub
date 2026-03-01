import express from "express";
import cors from "cors";
import morgan from "morgan";
import { AppError } from "./errors.js";
import { loadPlugins, getPlugins } from "./plugins.js";

export async function createServer() {
  const app = express();

  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/plugins", (req, res) => {
    res.json(getPlugins());
  });

  await loadPlugins(app);

  // Error handler must come after plugins so plugin routes are covered too
  app.use((err, req, res, next) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.message ?? "Internal server error" });
  });

  return app;
}
