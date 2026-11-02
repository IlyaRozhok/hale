import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const infra = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tools = ["initdb", "pg_ctl", "postgres", "psql", "pg_dump"];

/** A directory holding a matching initdb/pg_ctl/postgres/psql/pg_dump set. */
function findPgBin(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const which = spawnSync("sh", ["-c", "command -v pg_dump"], { encoding: "utf8" });
  if (which.stdout.trim()) candidates.push(dirname(realpathSync(which.stdout.trim())));
  for (const base of ["/usr/lib/postgresql"]) {
    if (existsSync(base)) {
      for (const v of readdirSync(base).sort().reverse()) candidates.push(join(base, v, "bin"));
    }
  }
  return candidates.find((d) => tools.every((t) => existsSync(join(d, t)))) ?? null;
}

const pgBin = findPgBin();
if (!pgBin) {
  console.warn(
    "SKIPPED infra script tests: no PostgreSQL binaries (initdb, pg_ctl, postgres, psql, pg_dump) " +
      "found. Install postgresql or set PG_BIN to its bin directory.",
  );
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

// The tables created by apps/api migration 0001, read from source so the
// restore-check table list cannot silently drift from the schema.
const migration = readFileSync(
  resolve(infra, "../apps/api/src/db/migrations/0001-init.ts"),
  "utf8",
);
const migrationTables = [...migration.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]!);

describe("tablo.cron", () => {
  const cron = readFileSync(join(infra, "tablo.cron"), "utf8");
  it("runs pg_dump and psql inside the postgres container, where host `postgres` resolves", () => {
    expect(cron).toMatch(/^PG_DUMP=docker compose -f \S+ exec -T postgres pg_dump$/m);
    expect(cron).toMatch(/^PSQL=docker compose -f \S+ exec -T postgres psql$/m);
  });
  it("keeps Postgres unpublished in compose", () => {
    const compose = readFileSync(join(infra, "compose.yml"), "utf8");
    const start = compose.indexOf("\n  postgres:");
    const pg = compose.slice(start, compose.indexOf("\n  api:"));
    expect(start).toBeGreaterThan(0);
    expect(pg).not.toMatch(/^\s+ports:/m);
  });
});

describe.skipIf(!pgBin)("backup.sh / restore-check.sh", () => {
  let dir: string;
  let port: number;
  let n = 0;
  const bin = (t: string) => join(pgBin!, t);
  const url = (db: string) => `postgres://tablo@127.0.0.1:${port}/${db}`;
  const psql = (db: string, sql: string) =>
    execFileSync(bin("psql"), [url(db), "-Atqc", sql], { encoding: "utf8" }).trim();

  const baseEnv = () => ({
    PATH: process.env.PATH ?? "",
    PG_DUMP: bin("pg_dump"),
    PSQL: bin("psql"),
    ENCRYPT_CMD: "cat", // test seam: real age is not installed
    DECRYPT_CMD: "cat",
    RESTORE_ADMIN_URL: url("postgres"),
  });
  const run = (script: string, env: Record<string, string>, args: string[] = []) =>
    spawnSync("bash", [join(infra, script), ...args], { env, encoding: "utf8" });

  /** Fresh source db with every expected table and `rows` transactions. */
  function makeSource(rows: number, omit: string[] = []): string {
    const db = `src_${++n}`;
    psql("postgres", `create database ${db}`);
    for (const t of migrationTables.filter((x) => !omit.includes(x))) {
      psql(db, `create table ${t} (id integer)`);
    }
    for (let i = 0; i < rows; i++) psql(db, `insert into transactions values (${i})`);
    return db;
  }
  const backupTo = (db: string) => {
    const backups = mkdtempSync(join(dir, "bk-"));
    const r = run("backup.sh", { ...baseEnv(), DATABASE_URL: url(db), BACKUP_DIR: backups });
    expect(r.status, r.stderr).toBe(0);
    return backups;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "tablo-infra-"));
    port = await freePort();
    const data = join(dir, "data");
    execFileSync(bin("initdb"), ["-D", data, "-U", "tablo", "--auth=trust", "-E", "UTF8"], {
      stdio: "ignore",
    });
    execFileSync(
      bin("pg_ctl"),
      ["-D", data, "-w", "-l", join(dir, "pg.log"), "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, "start"],
      { stdio: "ignore" },
    );
  });

  afterAll(() => {
    if (!dir) return;
    try {
      execFileSync(bin("pg_ctl"), ["-D", join(dir, "data"), "-m", "immediate", "stop"], { stdio: "ignore" });
    } catch {
      /* already stopped */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps restore-check's table list in sync with the migration", () => {
    const script = readFileSync(join(infra, "restore-check.sh"), "utf8");
    const listed = /DEFAULT_TABLES="([^"]+)"/.exec(script)![1]!.split(" ");
    expect([...listed].sort()).toEqual([...migrationTables].sort());
  });

  it("backup then restore-check succeeds", () => {
    const src = makeSource(3);
    const backups = backupTo(src);
    const r = run("restore-check.sh", {
      ...baseEnv(),
      BACKUP_DIR: backups,
      SOURCE_URL: url(src),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("restore-check ok");
  });

  it("fails when a table is missing from the backup", () => {
    const src = makeSource(3, ["devices"]);
    const backups = backupTo(src);
    const r = run("restore-check.sh", { ...baseEnv(), BACKUP_DIR: backups });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("table 'devices' missing");
  });

  it("fails when the backup has fewer transactions than the source", () => {
    const src = makeSource(3);
    const backups = backupTo(src);
    psql(src, "insert into transactions values (100), (101)");
    const r = run("restore-check.sh", { ...baseEnv(), BACKUP_DIR: backups, SOURCE_URL: url(src) });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("restored 3 transactions, expected at least 5");
  });

  it("fails when the manifest baseline is not met", () => {
    const src = makeSource(3);
    const backups = backupTo(src);
    const r = run("restore-check.sh", { ...baseEnv(), BACKUP_DIR: backups, EXPECTED_MIN_TX: "9" });
    expect(r.status).not.toBe(0);
  });

  it("refuses to pass with no baseline at all", () => {
    const src = makeSource(3);
    const backups = backupTo(src);
    for (const f of readdirSync(backups).filter((f) => f.endsWith(".manifest"))) {
      rmSync(join(backups, f));
    }
    const r = run("restore-check.sh", { ...baseEnv(), BACKUP_DIR: backups });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("no baseline");
  });

  it("fails when there is no backup", () => {
    const empty = mkdtempSync(join(dir, "empty-"));
    const r = run("restore-check.sh", { ...baseEnv(), BACKUP_DIR: empty });
    expect(r.status).not.toBe(0);
  });

  it("deletes backups older than the retention window", () => {
    const src = makeSource(1);
    const backups = backupTo(src);
    const old = join(backups, "tablo-20200101T000000Z.sql.gz.age");
    writeFileSync(old, "x");
    execFileSync("touch", ["-t", "202001010000", old]);
    const r = run("backup.sh", { ...baseEnv(), DATABASE_URL: url(src), BACKUP_DIR: backups });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(old)).toBe(false);
  });

  it("cron-run records a failed job in the jobs table", () => {
    const db = `src_${++n}`;
    psql("postgres", `create database ${db}`);
    psql(
      db,
      "create table jobs (id serial primary key, kind text not null, status text not null, attempts int, last_error text)",
    );
    const log = join(dir, "jobs.log");
    const r = run(
      "cron-run.sh",
      { ...baseEnv(), DATABASE_URL: url(db), LOG_FILE: log },
      ["backup", "sh", "-c", "echo boom >&2; exit 3"],
    );
    expect(r.status).toBe(3);
    expect(psql(db, "select kind || '|' || status || '|' || last_error from jobs")).toBe(
      "backup.failed|failed|boom",
    );
    expect(readFileSync(log, "utf8")).toContain("backup exit=3");
  });

  it("cron-run reads a real argon2 hash env file without sourcing it", () => {
    const db = `src_${++n}`;
    psql("postgres", `create database ${db}`);
    psql(
      db,
      "create table jobs (id serial primary key, kind text not null, status text not null, attempts int, last_error text)",
    );
    const envFile = join(dir, "prod.env");
    writeFileSync(
      envFile,
      [
        "DOMAIN=example.test",
        "OWNER_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA'",
        "JWT_SECRET=$HOME$undefined_var",
        `DATABASE_URL='${url(db)}'`,
        "",
      ].join("\n"),
    );
    const log = join(dir, "jobs2.log");
    const env = { PATH: process.env.PATH ?? "", PSQL: bin("psql"), ENV_FILE: envFile, LOG_FILE: log };
    const ok = run("cron-run.sh", env, ["noop", "true"]);
    expect(ok.status, ok.stderr).toBe(0);
    const bad = run("cron-run.sh", env, ["backup", "sh", "-c", "echo $DATABASE_URL >&2; exit 4"]);
    expect(bad.status).toBe(4);
    expect(readFileSync(log, "utf8")).toContain(url(db));
    expect(psql(db, "select kind from jobs")).toBe("backup.failed");
  });

  it("full mode without a key fails instead of downgrading to shallow", () => {
    const backups = mkdtempSync(join(dir, "nokey-"));
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    writeFileSync(join(backups, `tablo-${stamp}.sql.gz.age`), "age-encryption.org/v1\nrest");
    const r = run("restore-check.sh", { PATH: process.env.PATH ?? "", BACKUP_DIR: backups });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("full mode needs AGE_IDENTITY_FILE");
  });

  it("deploy.sh exits non-zero when a step fails and zero when health passes", () => {
    const fake = join(dir, "fake-ssh.sh");
    writeFileSync(fake, 'cat >/dev/null 2>&1 || true\n[ -z "$FAIL_ON" ] || { case "$*" in *"$FAIL_ON"*) exit 1;; esac; }\n');
    const env = (extra: Record<string, string>) => ({
      PATH: process.env.PATH ?? "",
      DEPLOY_HOST: "203.0.113.1",
      DOMAIN: "example.test",
      SSH_CMD: `bash ${fake}`,
      HEALTH_RETRIES: "1",
      ...extra,
    });
    const failBuild = run("deploy.sh", env({ FAIL_ON: "docker build", CURL: "true" }));
    expect(failBuild.status).not.toBe(0);
    expect(failBuild.stdout).not.toContain("deploy ok");
    const failMig = run("deploy.sh", env({ FAIL_ON: "mig.js", CURL: "true" }));
    expect(failMig.status).not.toBe(0);
    const failHealth = run("deploy.sh", env({ CURL: "false", HEALTH_RETRIES: "1" }));
    expect(failHealth.status).not.toBe(0);
    expect(failHealth.stderr).toContain("/health did not return 200");
    const ok = run("deploy.sh", env({ CURL: "true" }));
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("deploy ok");
  });

  it("db-tunnel.sh forwards loopback to the container IP and refuses a bad lookup", () => {
    const log = join(dir, "tunnel.log");
    const fake = join(dir, "fake-tunnel-ssh.sh");
    writeFileSync(fake, `case "$*" in *"docker inspect"*) echo "$FAKE_IP";; *) echo "$*" > ${log};; esac\n`);
    const env = (ip: string) => ({ PATH: process.env.PATH ?? "", DEPLOY_HOST: "203.0.113.1", SSH_CMD: `bash ${fake}`, FAKE_IP: ip });
    const ok = run("db-tunnel.sh", env("172.18.0.2"));
    expect(ok.status, ok.stderr).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("-N -L 127.0.0.1:15432:172.18.0.2:5432 root@203.0.113.1");
    const bad = run("db-tunnel.sh", env(""));
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("could not find the postgres container IP");
  });

  it("shallow mode accepts a fresh age-shaped backup and rejects a stale or plain one", () => {
    const backups = mkdtempSync(join(dir, "shallow-"));
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const f = join(backups, `tablo-${stamp}.sql.gz.age`);
    const env = { PATH: process.env.PATH ?? "", BACKUP_DIR: backups };
    writeFileSync(f, "age-encryption.org/v1\nrest");
    expect(run("restore-check.sh", env, ["--shallow"]).status).toBe(0);
    writeFileSync(f, "plain sql, not encrypted");
    expect(run("restore-check.sh", env, ["--shallow"]).status).not.toBe(0);
    rmSync(f);
    writeFileSync(join(backups, "tablo-20200101T000000Z.sql.gz.age"), "age-encryption.org/v1\nx");
    expect(run("restore-check.sh", env, ["--shallow"]).status).not.toBe(0);
  });
});
