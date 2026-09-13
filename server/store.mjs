/** Durable CAS documents. Workspace and identity data are deliberately separate. */
import { createWorkspace, validateWorkspace } from "../packages/core/workspace.mjs";
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conloca_board (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,document JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS boards_records (namespace TEXT NOT NULL,id TEXT NOT NULL,value JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(namespace,id))`,
];
export class NeonStore {
  constructor(sql) {
    this.sql = sql;
    this.ready = null;
    this.kind = "neon";
  }
  async init() {
    if (!this.ready)
      this.ready = (async () => {
        for (const q of SCHEMA) await this.sql.query(q);
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    await this.ready;
  }
  async get(ns, id) {
    await this.init();
    const [r] =
      ns === "workspace"
        ? await this.sql.query("SELECT version,document AS value FROM conloca_board WHERE id=1")
        : await this.sql.query(
            "SELECT version,value FROM boards_records WHERE namespace=$1 AND id=$2",
            [ns, id],
          );
    return r ? { version: Number(r.version), value: r.value } : null;
  }
  async cas(ns, id, version, value) {
    await this.init();
    let rows;
    if (ns === "workspace")
      rows =
        version === 0
          ? await this.sql.query(
              "INSERT INTO conloca_board(id,version,document) VALUES(1,1,$1::jsonb) ON CONFLICT DO NOTHING RETURNING version",
              [JSON.stringify(value)],
            )
          : await this.sql.query(
              "UPDATE conloca_board SET document=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 AND version=$2 RETURNING version",
              [JSON.stringify(value), version],
            );
    else
      rows =
        version === 0
          ? await this.sql.query(
              "INSERT INTO boards_records(namespace,id,value) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING version",
              [ns, id, JSON.stringify(value)],
            )
          : await this.sql.query(
              "UPDATE boards_records SET value=$4::jsonb,version=version+1 WHERE namespace=$1 AND id=$2 AND version=$3 RETURNING version",
              [ns, id, version, JSON.stringify(value)],
            );
    return rows.length ? Number(rows[0].version) : null;
  }
  async list(ns) {
    await this.init();
    return this.sql.query(
      "SELECT id,value,version FROM boards_records WHERE namespace=$1 ORDER BY id LIMIT 5000",
      [ns],
    );
  }
}
export class MemoryStore {
  constructor() {
    this.rows = new Map();
    this.kind = "test";
  }
  async init() {}
  async get(ns, id) {
    return structuredClone(this.rows.get(ns + ":" + id) || null);
  }
  async cas(ns, id, version, value) {
    const key = ns + ":" + id,
      r = this.rows.get(key);
    if ((r?.version || 0) !== version) return null;
    this.rows.set(key, { value: structuredClone(value), version: version + 1 });
    return version + 1;
  }
  async list(ns) {
    return [...this.rows]
      .filter(([k]) => k.startsWith(ns + ":"))
      .map(([k, r]) => ({ id: k.slice(ns.length + 1), ...structuredClone(r) }));
  }
}
export async function sqliteStore(path) {
  const { Database } = await import("bun:sqlite");
  const db = new Database(path, { create: true });
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(namespace TEXT,id TEXT,value TEXT,version INTEGER,PRIMARY KEY(namespace,id))",
  );
  return {
    kind: "local-test",
    async init() {},
    async get(ns, id) {
      const r = db
        .prepare("SELECT value,version FROM records WHERE namespace=? AND id=?")
        .get(ns, id);
      return r ? { version: r.version, value: JSON.parse(r.value) } : null;
    },
    async cas(ns, id, version, value) {
      const r =
        version === 0
          ? db
              .prepare("INSERT OR IGNORE INTO records VALUES(?,?,?,1)")
              .run(ns, id, JSON.stringify(value))
          : db
              .prepare(
                "UPDATE records SET value=?,version=version+1 WHERE namespace=? AND id=? AND version=?",
              )
              .run(JSON.stringify(value), ns, id, version);
      return r.changes ? version + 1 : null;
    },
    async list(ns) {
      return db
        .prepare("SELECT id,value,version FROM records WHERE namespace=?")
        .all(ns)
        .map((r) => ({ ...r, value: JSON.parse(r.value) }));
    },
    close() {
      db.close();
    },
  };
}
export async function mutate(store, ns, id, fn, initial = {}) {
  for (let i = 0; i < 12; i++) {
    const old = await store.get(ns, id),
      value = structuredClone(old?.value ?? initial),
      result = await fn(value);
    if (await store.cas(ns, id, old?.version || 0, value)) return result;
  }
  throw Object.assign(Error("Concurrent update. Please retry."), { status: 409 });
}
/** A local preview must never seed test identities in an accidentally supplied cloud DB. */
export function storeTarget(env = process.env) {
  const test = env.LOCAL_TEST_MODE === "1" && !env.VERCEL;
  if (test && env.DATABASE_URL)
    throw Object.assign(Error("Do not combine local test mode with a cloud DATABASE_URL."), {
      status: 503,
    });
  if (test) return { kind: "local-test", path: env.LOCAL_DATABASE_PATH || ".data/test.sqlite" };
  if (!env.DATABASE_URL)
    throw Object.assign(Error("Connect a cloud database first."), { status: 503 });
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {}
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw Object.assign(Error("Configure a valid PostgreSQL database connection string."), {
      status: 503,
    });
  return { kind: "neon", connectionString: env.DATABASE_URL };
}
const connections = new Map();
export async function getStore(env = process.env) {
  const target = storeTarget(env),
    key = JSON.stringify(target);
  if (!connections.has(key)) {
    const pending = (async () => {
      let store;
      if (target.kind === "neon") {
        const { neon } = await import("@neondatabase/serverless");
        store = new NeonStore(neon(target.connectionString));
      } else store = await sqliteStore(target.path);
      await store.init();
      return store;
    })().catch((error) => {
      connections.delete(key);
      throw error;
    });
    connections.set(key, pending);
  }
  return connections.get(key);
}
export async function workspace(store) {
  const r = await store.get("workspace", "main");
  if (r) return { version: r.version, value: validateWorkspace(r.value) };
  const value = createWorkspace();
  await store.cas("workspace", "main", 0, value);
  return workspace(store);
}
