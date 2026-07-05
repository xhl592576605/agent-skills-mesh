#!/usr/bin/env node
/**
 * asm launcher (design §2, standalone executable distribution).
 *
 * Resolves the platform-specific standalone executable and spawns it with the
 * user's argv. The main npm package declares each `agent-skills-mesh-<plat>`
 * package as an optionalDependency; npm installs only the one matching the
 * host at install time, and this wrapper locates it.
 *
 * Why spawn with cwd = os.tmpdir(): a Bun standalone executable reads
 * `<cwd>/bunfig.toml` at boot. If the user runs `asm` from a directory whose
 * bunfig preloads another package (common in Bun + SolidJS projects), the exe
 * fails with `preload not found`. Agent Skills Mesh never reads `process.cwd()`
 * — all paths resolve from `ASM_HOME` — so launching from a clean temp cwd is
 * safe and avoids the conflict entirely.
 */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)

/** Map host platform/arch to the npm package suffix. */
function derivePlatformSuffix() {
  if (process.env.ASM_PLATFORM) return process.env.ASM_PLATFORM
  const plat = process.platform // darwin | linux | win32
  const arch = process.arch // arm64 | x64
  // Linux musl: opt-in via ASM_LIBC=musl (auto-detect of libc is unreliable from Node).
  if (plat === "linux" && process.env.ASM_LIBC === "musl") return `linux-${arch}-musl`
  return `${plat}-${arch}`
}

/** Locate the standalone exe: ASM_STANDALONE_EXE (dev) > platform package (prod). */
function resolveExe() {
  if (process.env.ASM_STANDALONE_EXE) {
    // Resolve against the user's launch cwd (not the spawn cwd), so relative
    // dev paths like ./dist/standalone/.../asm still work.
    return path.resolve(process.env.ASM_STANDALONE_EXE)
  }

  const suffix = derivePlatformSuffix()
  const pkg = `agent-skills-mesh-${suffix}`
  const isWin = process.platform === "win32"
  const exeName = isWin ? "asm.exe" : "asm"

  let pkgDir
  try {
    pkgDir = path.dirname(require.resolve(`${pkg}/package.json`))
  } catch {
    console.error(`asm: standalone package not installed for this platform (${pkg}).`)
    console.error(`asm: install it with: npm install -g ${pkg}`)
    process.exit(127)
  }
  return path.join(pkgDir, exeName)
}

const exe = resolveExe()
const child = spawn(exe, process.argv.slice(2), {
  stdio: "inherit",
  cwd: os.tmpdir(),
  env: process.env
})

child.on("error", (err) => {
  console.error(`asm: failed to launch standalone executable: ${err.message}`)
  process.exit(1)
})
child.on("exit", (code, signal) => {
  if (signal) {
    // Re-raise the same signal so calling shells see ctrl+c / SIGTERM semantics.
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})
