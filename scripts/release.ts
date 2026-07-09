/**
 * Release pipeline: build → assemble platform packages → publish (or dry-run).
 *
 * Usage:
 *   bun run scripts/release.ts                # 默认 dry-run（不真正发布，仅打包验证）
 *   bun run scripts/release.ts --publish      # 真正发布到 npm（需先 npm login 官方 registry）
 *   bun run scripts/release.ts --skip-build   # 跳过构建，只组装 + dry-run（调试发布流程）
 *
 * 平台包模式（参考 esbuild / @biomejs / swc）：
 *   主包 `bin/asm.js` 是 Node launcher；各平台子包 `agent-skills-mesh-<plat>` 含 standalone exe，
 *   经主包 optionalDependencies + 子包 os/cpu 声明，npm install 时自动只装匹配平台的一个。
 */
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { argv, exit } from "node:process"

/** 发布目标：npm 包后缀 + standalone 构建产物 + os/cpu 声明。 */
interface ReleaseTarget {
  /** npm 包后缀：`agent-skills-mesh-<pkg>` */
  pkg: string
  /** standalone 构建产物目录名（dist/standalone/<build>） */
  build: string
  /** 可执行文件名（Windows 加 .exe） */
  exe: string
  /** package.json `os` 字段，约束 npm 只在匹配平台安装 */
  os: string[]
  /** package.json `cpu` 字段 */
  cpu: string[]
}

/** 本次发布的 4 大桌面平台（与主包 optionalDependencies 对应）。 */
const TARGETS: readonly ReleaseTarget[] = [
  { pkg: "darwin-arm64", build: "darwin-arm64", exe: "asm", os: ["darwin"], cpu: ["arm64"] },
  { pkg: "darwin-x64", build: "darwin-x64", exe: "asm", os: ["darwin"], cpu: ["x64"] },
  { pkg: "linux-x64", build: "linux-x64", exe: "asm", os: ["linux"], cpu: ["x64"] },
  { pkg: "win32-x64", build: "win32-x64", exe: "asm.exe", os: ["win32"], cpu: ["x64"] }
]

const SCRIPT_PATH = resolve(argv[1]!)
const PROJECT_ROOT = dirname(dirname(SCRIPT_PATH))
const PUBLISH_DIR = join(PROJECT_ROOT, "dist/publish")
const NPM_REGISTRY = "https://registry.npmjs.org/"

function parseArgs(): { publish: boolean; skipBuild: boolean } {
  return {
    publish: argv.includes("--publish"),
    skipBuild: argv.includes("--skip-build")
  }
}

/** 读取主包 version（optionalDependencies 版本与之同步）。 */
async function readMainVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(PROJECT_ROOT, "package.json"), "utf8"))
  return pkg.version as string
}

/** 调用 build-standalone.ts 构建 4 平台二进制。 */
async function runBuild(targets: readonly ReleaseTarget[]): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "scripts/build-standalone.ts", ...targets.map((t) => t.build)],
    cwd: PROJECT_ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  })
  return await proc.exited
}

/** 组装单个平台子包目录：拷贝 exe + 生成 package.json。 */
async function assemblePlatformPackage(target: ReleaseTarget, version: string): Promise<void> {
  const dir = join(PUBLISH_DIR, target.pkg)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const srcExe = join(PROJECT_ROOT, "dist/standalone", target.build, target.exe)
  const dstExe = join(dir, target.exe)
  await cp(srcExe, dstExe)
  await chmod(dstExe, 0o755)

  const pkgJson = {
    name: `agent-skills-mesh-${target.pkg}`,
    version,
    description: `Standalone executable for agent-skills-mesh (${target.pkg})`,
    license: "MIT",
    os: target.os,
    cpu: target.cpu,
    files: [target.exe],
    publishConfig: { access: "public", registry: NPM_REGISTRY }
  }
  await writeFile(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n")
}

/** 在指定 cwd 跑 npm publish（dry-run 或真正发布）。publishConfig 已锁定官方 registry。 */
async function npmPublish(cwd: string, dryRun: boolean): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["npm", "publish", ...(dryRun ? ["--dry-run"] : [])],
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  })
  return await proc.exited
}

/**
 * 发布前清理主包 optionalDependencies：只保留 `agent-skills-mesh-*` 平台子包。
 *
 * 防御 pnpm 在「删 lockfile + 启用 supportedArchitectures」瞬态下，把 @opentui/core 的
 * 平台 native（如 @opentui/core-linux-x64）注入根 optionalDependencies —— 这些是构建期
 * 依赖，绝不能进主包发布声明（否则用户装主包会拉一堆无用的 @opentui/core native）。
 */
async function sanitizeMainPackage(): Promise<void> {
  const pkgPath = join(PROJECT_ROOT, "package.json")
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
  const opt: Record<string, string> = pkg.optionalDependencies ?? {}
  const removed = Object.keys(opt).filter((name) => !name.startsWith("agent-skills-mesh-"))
  if (removed.length === 0) return
  pkg.optionalDependencies = Object.fromEntries(
    Object.entries(opt).filter(([name]) => name.startsWith("agent-skills-mesh-"))
  )
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  console.log(`⚠ 清理主包 optionalDependencies：移除工具注入的 ${removed.join(", ")}`)
}

async function main(): Promise<void> {
  const { publish, skipBuild } = parseArgs()
  const dryRun = !publish
  const version = await readMainVersion()

  console.log(`\n=== agent-skills-mesh release ${version} (${dryRun ? "DRY-RUN" : "PUBLISH"}) ===`)
  console.log(`targets: ${TARGETS.map((t) => t.pkg).join(", ")}\n`)

  if (!skipBuild) {
    console.log("--- 1/3 build standalone binaries ---")
    const code = await runBuild(TARGETS)
    if (code !== 0) {
      console.error(`build failed (exit ${code})`)
      exit(code)
    }
  } else {
    console.log("--- 1/3 build SKIPPED (--skip-build) ---")
  }

  console.log("\n--- 2/3 assemble platform packages ---")
  await rm(PUBLISH_DIR, { recursive: true, force: true })
  await mkdir(PUBLISH_DIR, { recursive: true })
  for (const target of TARGETS) {
    await assemblePlatformPackage(target, version)
    console.log(`✓ ${target.pkg}`)
  }

  console.log(`\n--- 3/3 ${dryRun ? "dry-run publish" : "publish"} ---`)
  console.log("(顺序：先平台子包，后主包——确保主包 optionalDependencies 指向的版本已存在)\n")

  for (const target of TARGETS) {
    console.log(`[platform] agent-skills-mesh-${target.pkg}`)
    const code = await npmPublish(join(PUBLISH_DIR, target.pkg), dryRun)
    if (code !== 0) {
      console.error(`platform package ${target.pkg} publish failed (exit ${code})`)
      exit(code)
    }
    console.log()
  }

  await sanitizeMainPackage()
  console.log("[main] agent-skills-mesh")
  const mainCode = await npmPublish(PROJECT_ROOT, dryRun)
  if (mainCode !== 0) {
    console.error(`main package publish failed (exit ${mainCode})`)
    exit(mainCode)
  }

  console.log(`\n=== ${dryRun ? "dry-run complete" : "publish complete"} ===`)
  if (dryRun) {
    console.log("确认无误后，用 `bun run scripts/release.ts --publish` 真正发布。")
  }
}

void main()
