/**
 * Standalone executable builder (design §2, bin distribution).
 *
 * Compiles `src/cli/index.ts` into a self-contained executable per platform
 * (Bun runtime + OpenTUI native + app code) via `Bun.build({ compile })`.
 *
 * Usage:
 *   bun run scripts/build-standalone.ts                  # all platforms
 *   bun run scripts/build-standalone.ts darwin-arm64      # single platform
 *
 * Output: `dist/standalone/<platform>/asm[.exe]`.
 *
 * Cross-platform native prerequisite: install OpenTUI core for every platform
 * first, e.g. `bun install --os="*" --cpu="*" @opentui/core`. Cross-compiling
 * from a single host also requires Bun's cross-compile support for the target.
 *
 * Linux musl targets additionally define `process.env.OPENTUI_LIBC = "musl"`
 * so the OpenTUI native loader picks the musl variant.
 *
 * --- Why this script re-spawns itself in a temp cwd ---
 *
 * `bunfig.toml` preloads `@opentui/solid/preload` so JSX stays reactive under
 * `bun run` during development. When `Bun.build({ compile })` runs inside a
 * process that already loaded that preload, the preload directive is baked into
 * the standalone exe's boot sequence — but the preload module is not a normal
 * import and is not embedded, so the exe fails at startup with
 * `preload not found "@opentui/solid/preload"`.
 *
 * Bun's `--config` flag *adds* a config file; it does not replace the default
 * `cwd/bunfig.toml` lookup, so we cannot disable the preload via flags. Instead,
 * the launcher process spawns a worker in a freshly-created temp directory
 * (which has no `bunfig.toml`), where `bun run` boots without the preload, and
 * `Bun.build` therefore does not bake it into the exe. The compile-time
 * `solidPlugin` already transforms every `.tsx`, so the runtime preload is
 * unnecessary in a standalone exe anyway.
 */
import solidPlugin from "@opentui/solid/bun-plugin"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { argv, env, exit } from "node:process"

/** Platform key → Bun compile target + npm package suffix. */
interface Target {
  /** npm package suffix: `agent-skills-mesh-<pkg>`. */
  pkg: string
  /** Bun `compile.target`, e.g. `bun-darwin-arm64`. */
  bunTarget: string
  /** Output file basename; `.exe` appended for Windows. */
  out: string
  /** Linux musl needs OPENTUI_LIBC=musl define. */
  musl?: boolean
}

const TARGETS: readonly Target[] = [
  { pkg: "darwin-arm64", bunTarget: "bun-darwin-arm64", out: "asm" },
  { pkg: "darwin-x64", bunTarget: "bun-darwin-x64", out: "asm" },
  { pkg: "linux-arm64", bunTarget: "bun-linux-arm64", out: "asm" },
  { pkg: "linux-x64", bunTarget: "bun-linux-x64", out: "asm" },
  { pkg: "linux-arm64-musl", bunTarget: "bun-linux-arm64", out: "asm", musl: true },
  { pkg: "linux-x64-musl", bunTarget: "bun-linux-x64", out: "asm", musl: true },
  { pkg: "win32-x64", bunTarget: "bun-windows-x64", out: "asm.exe" }
]

/** Resolve project paths from this script's location (not `cwd()`). */
const SCRIPT_PATH = resolve(argv[1]!)
const PROJECT_ROOT = dirname(dirname(SCRIPT_PATH))
const ENTRYPOINT = join(PROJECT_ROOT, "src/cli/index.ts")
const OUT_DIR = join(PROJECT_ROOT, "dist/standalone")

/** Env flag used to tell the worker process it is the clean-cwd builder. */
const CLEAN_FLAG = "ASM_STANDALONE_BUILD_WORKER"

async function fileMB(path: string): Promise<number> {
  const s = await stat(path)
  return Math.round((s.size / 1024 / 1024) * 10) / 10
}

async function buildOne(target: Target): Promise<void> {
  const dir = join(OUT_DIR, target.pkg)
  await mkdir(dir, { recursive: true })
  const outfile = join(dir, target.out)

  const startedAt = Date.now()
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    target: "bun",
    plugins: [solidPlugin],
    compile: {
      target: target.bunTarget,
      outfile
    },
    // Linux musl: tell OpenTUI native loader to pick the musl variant.
    define: target.musl ? { "process.env.OPENTUI_LIBC": '"musl"' } : undefined
  })

  if (!result.success) {
    const messages = result.logs
      .map((log) => (typeof log === "string" ? log : log.message))
      .join("\n")
    throw new Error(`build failed for ${target.pkg}:\n${messages}`)
  }

  const mb = await fileMB(outfile)
  const secs = Math.round((Date.now() - startedAt) / 100) / 10
  console.log(`✓ ${target.pkg.padEnd(18)} ${String(mb).padStart(6)} MB  (${secs}s)  → ${outfile}`)
}

/**
 * Re-spawn this script in a temp cwd with no `bunfig.toml` so the compile
 * process does not preload `@opentui/solid/preload` (see file header).
 * Returns the worker's exit code.
 */
async function runCleanWorker(): Promise<number> {
  const workerCwd = await mkdtemp(join(tmpdir(), "asm-build-"))
  try {
    // Write an empty bunfig.toml into the worker cwd so the compile process
    // bakes an *empty* bunfig into the exe. A standalone exe otherwise reads
    // the user's cwd/bunfig.toml at boot; if that bunfig preloads
    // `@opentui/solid/preload` (e.g. when run from this repo during dev), the
    // exe fails with `preload not found`. Baking an empty config makes the exe
    // self-contained and ignore any external bunfig preload.
    await writeFile(join(workerCwd, "bunfig.toml"), "")
    const child = Bun.spawn({
      cmd: ["bun", "run", SCRIPT_PATH, ...argv.slice(2)],
      cwd: workerCwd,
      env: { ...env, [CLEAN_FLAG]: "1" },
      stdio: ["inherit", "inherit", "inherit"]
    })
    return await child.exited
  } finally {
    await rm(workerCwd, { recursive: true, force: true })
  }
}

async function buildAll(): Promise<void> {
  const requested = argv.slice(2).filter((a) => !a.startsWith("-"))
  const targets = requested.length
    ? TARGETS.filter((t) => requested.includes(t.pkg))
    : TARGETS

  if (targets.length === 0) {
    console.error(`no matching targets. known: ${TARGETS.map((t) => t.pkg).join(", ")}`)
    exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })
  console.log(`entrypoint: ${ENTRYPOINT}`)
  console.log(`out dir:    ${OUT_DIR}`)
  console.log(`targets:    ${targets.map((t) => t.pkg).join(", ")}\n`)

  const failures: string[] = []
  for (const target of targets) {
    try {
      await buildOne(target)
    } catch (err) {
      failures.push(`${target.pkg}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`✗ ${target.pkg} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} target(s) failed:\n${failures.join("\n")}`)
    exit(1)
  }
  console.log("\nall targets built.")
}

async function main(): Promise<void> {
  // Worker phase: run the actual builds in a bunfig-free cwd.
  if (env[CLEAN_FLAG] === "1") {
    await buildAll()
    return
  }

  // Launcher phase: hand off to a clean worker.
  console.log("launching clean build worker (temp cwd, no bunfig preload)...")
  const code = await runCleanWorker()
  exit(code)
}

void main()
