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

// The tables created by every apps/api migration, read from source so the
// restore-check table list cannot silently drift from the schema.
const migrationsDir = resolve(infra, "../apps/api/src/db/migrations");
const migrationTables = readdirSync(migrationsDir).flatMap((f) =>
  [...readFileSync(join(migrationsDir, f), "utf8").matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]!),
);

describe("hale.cron", () => {
  const cron = readFileSync(join(infra, "hale.cron"), "utf8");
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

describe("restore-check table list", () => {
  it("keeps restore-check's table list in sync with the migrations", () => {
    const script = readFileSync(join(infra, "restore-check.sh"), "utf8");
    const listed = /DEFAULT_TABLES="([^"]+)"/.exec(script)![1]!.split(" ");
    expect([...listed].sort()).toEqual([...migrationTables].sort());
  });
});

describe("db-tunnel.sh", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hale-tunnel-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const tunnel = (ip: string) => {
    const log = join(dir, "tunnel.log");
    const fake = join(dir, "fake-tunnel-ssh.sh");
    writeFileSync(fake, `case "$*" in *"docker inspect"*) echo "$FAKE_IP";; *) echo "$*" > ${log};; esac\n`);
    const env = { PATH: process.env.PATH ?? "", DEPLOY_HOST: "203.0.113.1", SSH_CMD: `bash ${fake}`, FAKE_IP: ip };
    return { r: spawnSync("bash", [join(infra, "db-tunnel.sh")], { env, encoding: "utf8" }), log };
  };

  it("forwards loopback to the container IP", () => {
    const { r, log } = tunnel("172.18.0.2");
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("-N -L 127.0.0.1:15432:172.18.0.2:5432 root@203.0.113.1");
  });

  it.each(["", "172.18.0.2172.19.0.3", "172.18.0.2172", "172.18.0", "not-an-ip"])("refuses the lookup result %j", (ip) => {
    const { r } = tunnel(ip);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("could not find the postgres container IP");
  });
});

describe.skipIf(!pgBin)("backup.sh / restore-check.sh", () => {
  let dir: string;
  let port: number;
  let n = 0;
  const bin = (t: string) => join(pgBin!, t);
  const url = (db: string) => `postgres://hale@127.0.0.1:${port}/${db}`;
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
    dir = mkdtempSync(join(tmpdir(), "hale-infra-"));
    port = await freePort();
    const data = join(dir, "data");
    execFileSync(bin("initdb"), ["-D", data, "-U", "hale", "--auth=trust", "-E", "UTF8"], {
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
    const old = join(backups, "hale-20200101T000000Z.sql.gz.age");
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
    writeFileSync(join(backups, `hale-${stamp}.sql.gz.age`), "age-encryption.org/v1\nrest");
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

  it("shallow mode accepts a fresh age-shaped backup and rejects a stale or plain one", () => {
    const backups = mkdtempSync(join(dir, "shallow-"));
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const f = join(backups, `hale-${stamp}.sql.gz.age`);
    const env = { PATH: process.env.PATH ?? "", BACKUP_DIR: backups };
    writeFileSync(f, "age-encryption.org/v1\nrest");
    expect(run("restore-check.sh", env, ["--shallow"]).status).toBe(0);
    writeFileSync(f, "plain sql, not encrypted");
    expect(run("restore-check.sh", env, ["--shallow"]).status).not.toBe(0);
    rmSync(f);
    writeFileSync(join(backups, "hale-20200101T000000Z.sql.gz.age"), "age-encryption.org/v1\nx");
    expect(run("restore-check.sh", env, ["--shallow"]).status).not.toBe(0);
  });
});

/**
 * Fake ssh: appends each remote command (one per line, newlines flattened) to
 * $SSH_LOG, swallows stdin, fails when the command contains $FAIL_ON and, for
 * `grep ^API_IMAGE=`, prints $FAKE_CURRENT.
 */
describe("deploy.sh / rollback.sh (fake ssh)", () => {
  let dir: string;
  let n = 0;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hale-deploy-"));
    writeFileSync(
      join(dir, "fake-ssh.sh"),
      [
        'cat >/dev/null 2>&1 || true',
        'shift # user@host',
        'printf "%s\\n" "$*" | tr "\\n" " " >> "$SSH_LOG"; echo >> "$SSH_LOG"',
        '[ -z "${FAIL_ON:-}" ] || { case "$*" in *"$FAIL_ON"*) exit 1;; esac; }',
        'case "$*" in *"grep ^API_IMAGE="*) echo "${FAKE_CURRENT:-}";; esac',
        'exit 0',
      ].join("\n"),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (script: string, extra: Record<string, string>, args: string[] = []) => {
    const log = join(dir, `ssh-${++n}.log`);
    writeFileSync(log, "");
    const env = {
      PATH: process.env.PATH ?? "",
      DEPLOY_HOST: "203.0.113.1",
      DOMAIN: "example.test",
      SSH_CMD: `bash ${join(dir, "fake-ssh.sh")}`,
      SSH_LOG: log,
      HEALTH_RETRIES: "1",
      HEALTH_SLEEP: "0",
      CURL: "true",
      ...extra,
    };
    const r = spawnSync("bash", [join(infra, script), ...args], { env, encoding: "utf8" });
    const cmds = readFileSync(log, "utf8").split("\n").filter(Boolean);
    const at = (needle: string) => cmds.findIndex((c) => c.includes(needle));
    return { r, cmds, at };
  };

  it("deploy backs up the database before migrations and prunes old images after /health", () => {
    const { r, at } = run("deploy.sh", { FAKE_CURRENT: "API_IMAGE=hale-api:0123456789ab" });
    expect(r.status, r.stderr).toBe(0);
    expect(at("backup.sh")).toBeGreaterThan(-1);
    expect(at("backup.sh")).toBeLessThan(at("mig.js"));
    expect(at("prune-images.sh")).toBeGreaterThan(at("mig.js"));
    expect(r.stdout).toContain("infra/rollback.sh 0123456789ab");
  });

  it("deploy stops before migrations when the backup fails", () => {
    const { r, at } = run("deploy.sh", { FAIL_ON: "backup.sh" });
    expect(r.status).not.toBe(0);
    expect(at("mig.js")).toBe(-1);
    expect(r.stderr).toContain("backup before migrations FAILED");
  });

  it("deploy with SKIP_BACKUP=1 (first install) skips the backup", () => {
    const { r, at } = run("deploy.sh", { SKIP_BACKUP: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(at("backup.sh")).toBe(-1);
  });

  it("deploy does not prune images when /health fails", () => {
    const { r, at } = run("deploy.sh", { CURL: "false" });
    expect(r.status).not.toBe(0);
    expect(at("prune-images.sh")).toBe(-1);
  });

  it("rollback points compose at the given image and checks /health", () => {
    const { r, cmds, at } = run("rollback.sh", {}, ["0123456789ab"]);
    expect(r.status, r.stderr).toBe(0);
    expect(at("docker image inspect hale-api:0123456789ab")).toBeGreaterThan(-1);
    const all = cmds.join("\n");
    expect(all).toContain("API_IMAGE=hale-api:0123456789ab");
    expect(all.indexOf("docker compose up -d")).toBeGreaterThan(all.indexOf("API_IMAGE=hale-api:0123456789ab"));
    expect(at("mig.js")).toBe(-1);
    expect(r.stdout).toContain("rollback ok: hale-api:0123456789ab");
  });

  it("rollback accepts the full image name", () => {
    const { r, cmds } = run("rollback.sh", {}, ["hale-api:0123456789ab"]);
    expect(r.status, r.stderr).toBe(0);
    expect(cmds.join("\n")).toContain("API_IMAGE=hale-api:0123456789ab");
  });

  it("rollback fails when /health does not come back", () => {
    const { r } = run("rollback.sh", { CURL: "false" }, ["0123456789ab"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("/health did not return 200");
  });

  it("rollback refuses an image that is not on the server and changes nothing", () => {
    const { r, at } = run("rollback.sh", { FAIL_ON: "docker image inspect" }, ["0123456789ab"]);
    expect(r.status).not.toBe(0);
    expect(at("API_IMAGE=")).toBe(-1);
  });

  it.each([[], ["latest; rm -rf /"], ["../x"], ["ABC"]])("rollback refuses the tag %j", (...args) => {
    const { r, cmds } = run("rollback.sh", {}, args as string[]);
    expect(r.status).not.toBe(0);
    expect(cmds).toEqual([]);
  });
});

describe("prune-images.sh", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hale-prune-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const prune = (images: string[], current: string, failRm = "") => {
    const log = join(dir, "docker.log");
    writeFileSync(log, "");
    const fake = join(dir, "fake-docker.sh");
    writeFileSync(
      fake,
      [
        'echo "$*" >> "$DOCKER_LOG"',
        'case "$1 $2" in',
        '  "image ls") printf "%s\\n" $FAKE_IMAGES ;;',
        '  "image rm") [ -n "$FAIL_RM" ] && [ "$3" = "$FAIL_RM" ] && exit 1 ;;',
        "esac",
        "exit 0",
      ].join("\n"),
    );
    const env = {
      PATH: process.env.PATH ?? "",
      DOCKER: `bash ${fake}`,
      DOCKER_LOG: log,
      FAKE_IMAGES: images.join(" "),
      FAIL_RM: failRm,
    };
    const r = spawnSync("bash", [join(infra, "prune-images.sh"), current], { env, encoding: "utf8" });
    const removed = readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("image rm "))
      .map((l) => l.slice("image rm ".length));
    return { r, removed, log: readFileSync(log, "utf8") };
  };
  const imgs = ["a", "b", "c", "d", "e"].map((t) => `hale-api:${t}`); // newest first

  it("keeps the newest 3 hale-api images and removes the rest", () => {
    const { r, removed, log } = prune(imgs, "hale-api:a");
    expect(r.status, r.stderr).toBe(0);
    expect(removed).toEqual(["hale-api:d", "hale-api:e"]);
    expect(log).toContain("image prune -f");
  });

  it("never removes the image that is running now", () => {
    const { removed } = prune(imgs, "hale-api:e");
    expect(removed).toEqual(["hale-api:d"]);
  });

  it("a failed removal does not fail the script", () => {
    const { r } = prune(imgs, "hale-api:a", "hale-api:d");
    expect(r.status).toBe(0);
  });
});

describe("compose logging", () => {
  const compose = readFileSync(join(infra, "compose.yml"), "utf8");
  it("rotates json-file logs for every service", () => {
    expect(compose).toMatch(/driver: json-file/);
    expect(compose).toMatch(/max-size: "\d+m"/);
    expect(compose).toMatch(/max-file: "\d+"/);
    for (const svc of ["postgres", "api", "caddy"]) {
      const start = compose.indexOf(`\n  ${svc}:`);
      const rest = compose.slice(start + 1);
      const end = rest.search(/\n {2}\S|\n\S/);
      const block = rest.slice(0, end === -1 ? undefined : end);
      expect(block, svc).toMatch(/^\s+logging: \*logging$/m);
    }
  });
});

describe("compose api environment", () => {
  const compose = readFileSync(join(infra, "compose.yml"), "utf8");
  const start = compose.indexOf("\n  api:");
  const rest = compose.slice(start + 1);
  const end = rest.search(/\n {2}\S|\n\S/);
  const api = rest.slice(0, end === -1 ? undefined : end);

  // Task Б27: the api service has no env_file, so a variable reaches the container only when listed here.
  it("passes LEDGER_CHECK_ENABLED to the api, empty (off) by default", () => {
    expect(api).toMatch(/^ {6}LEDGER_CHECK_ENABLED: \$\{LEDGER_CHECK_ENABLED:-\}$/m);
  });
});
