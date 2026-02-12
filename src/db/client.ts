import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

import { config } from "../config";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  dbInstance = new Database(config.dbPath, { create: true, strict: true });
  dbInstance.exec("PRAGMA foreign_keys = ON;");

  return dbInstance;
}

export function nowIso(): string {
  return new Date().toISOString();
}
