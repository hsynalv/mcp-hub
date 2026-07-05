#!/usr/bin/env node
/**
 * Reset hub user password (admin / recovery — no email flow).
 *
 * Usage:
 *   node scripts/reset-user-password.js --email hhsynalv@gmail.com --password 'yeni-sifre-8+'
 *
 * Or via env (shell history'e dikkat):
 *   HUB_RESET_EMAIL=... HUB_RESET_PASSWORD=... node scripts/reset-user-password.js
 *
 * Requires: mcp-server/.env with HUB_MSSQL_URL (and persistence enabled).
 */

import "dotenv/config";
import { initPersistence, persistenceQuery, isPersistenceHealthy } from "../src/core/persistence/index.js";
import { findUserByEmail } from "../src/core/auth/users.service.js";
import { hashPassword, validatePasswordPolicy } from "../src/core/auth/password.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let email = process.env.HUB_RESET_EMAIL?.trim();
  let password = process.env.HUB_RESET_PASSWORD;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) email = args[++i];
    else if (args[i] === "--password" && args[i + 1]) password = args[++i];
  }

  return {
    email: email?.trim().toLowerCase(),
    password,
  };
}

async function main() {
  const { email, password } = parseArgs();

  if (!email || !password) {
    console.error("Kullanım:");
    console.error("  node scripts/reset-user-password.js --email user@example.com --password 'yeni-sifre'");
    console.error("");
    console.error("Şifre en az 8 karakter olmalı.");
    process.exit(1);
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    console.error(policy.message);
    process.exit(1);
  }

  await initPersistence();
  if (!isPersistenceHealthy()) {
    console.error("MSSQL bağlantısı yok. mcp-server/.env içinde HUB_MSSQL_URL ve HUB_PERSISTENCE_ENABLED kontrol et.");
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`Kullanıcı bulunamadı: ${email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await persistenceQuery(
    `UPDATE hub_users SET password_hash = @passwordHash, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id: user.id, passwordHash }
  );

  console.log(`OK — şifre sıfırlandı: ${user.email}`);
  console.log(`user id: ${user.id}`);
  console.log("Web UI → /auth/login ile yeni şifreyle giriş yap.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
