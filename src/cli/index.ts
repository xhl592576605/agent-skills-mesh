#!/usr/bin/env node
import { Command } from "commander";
import { ConfigStore } from "../core/storage/config-store.js";
import { IndexStore } from "../core/storage/index-store.js";
import { StateStore } from "../core/storage/state-store.js";
import { refreshIndex } from "../core/services/refresh-service.js";
import { applyInstallPlan, applyUninstallPlan, buildInstallPlan, buildUninstallPlan } from "../core/services/install-service.js";
import { runDoctor } from "../core/services/doctor-service.js";
import { addSource, listSources, removeSource, setSourceEnabled, sourceUpdate } from "../core/services/source-service.js";
import { searchSkills, skillAdd, skillRebind, skillRemove, skillUpdate } from "../core/services/skill-service.js";
import { formatSkillRows } from "./skill-format.js";
import type { SkillRecord } from "../core/models/skill.js";
import type { InstallAction } from "../core/models/install-plan.js";

const program = new Command();
program
  .name("asm")
  .description("Agent Skills Mesh — three-layer skill manager (source / skill / agent)")
  .version("0.1.0");

// === 顶层生命周期命令 ===

program
  .command("init")
  .description("Initialize Agent Skills Mesh home")
  .option("--force", "Overwrite existing config and index")
  .action(async (options: { force?: boolean }) => {
    const configStore = new ConfigStore();
    const indexStore = new IndexStore(configStore.home);
    const stateStore = new StateStore(configStore.home);
    await configStore.init({ force: options.force });
    await indexStore.init({ force: options.force });
    await stateStore.init({ force: options.force });
    console.log(`Initialized ${configStore.home}`);
  });

program
  .command("refresh")
  .description("Scan sources and rebuild index")
  .action(async () => {
    const { indexStore, config, state } = await loadStores();
    const next = await refreshIndex(config, state);
    await indexStore.write(next);
    console.log(`Refreshed ${Object.keys(next.skills).length} skills`);
  });

program
  .command("doctor")
  .description("Run health checks: external / broken-link / orphan / source-missing / conflict")
  .action(async () => {
    const configStore = new ConfigStore();
    const indexStore = new IndexStore(configStore.home);
    const config = (await configStore.exists()) ? await configStore.read() : undefined;
    const index = (await indexStore.exists()) ? await indexStore.read() : undefined;
    const checks = await runDoctor(configStore, indexStore, config, index);
    for (const check of checks) console.log(`${symbol(check.status)} ${check.kind}: ${check.message}`);
    if (checks.some((check) => check.status === "error")) process.exitCode = 1;
  });

program
  .command("tui")
  .description("Open interactive TUI")
  .action(async () => {
    if (!process.stdout.isTTY) {
      console.error("TUI requires an interactive terminal.");
      process.exitCode = 1;
      return;
    }
    // config 缺失先给终端友好错误（与其它非 init 命令一致）；index 缺失由 App 的
    // useIndexState 自动首次 refresh，故此处只校验 config。
    const configStore = new ConfigStore();
    if (!(await configStore.exists())) throw new Error("config.toml not found. Run `asm init` first.");
    // 懒加载 Ink/React 与 TUI，避免常用 CLI 命令承担 React 打包开销。.js 扩展遵循 NodeNext。
    const { createElement } = await import("react");
    const { render } = await import("ink");
    const { App } = await import("../tui/App.js");
    render(createElement(App));
  });

// === Layer 1 — Source（来源） ===

const source = program.command("source").description("Source commands: add, update, remove, list, enable, disable");

source
  .command("add <target>")
  .description("Register a source (auto-infers type: url→repo, SKILL.md dir→skill, multi-skill dir→folder)")
  .option("--type <type>", "repo|folder|skill (auto-inferred if omitted)")
  .option("--branch <branch>", "git branch (for repo)")
  .option("--id <id>", "custom source id")
  .action(async (target: string, options: { type?: string; branch?: string; id?: string }) => {
    const { configStore, stateStore } = await loadStores();
    const result = await addSource(configStore, stateStore, target, { id: options.id, branch: options.branch, type: options.type as "repo" | "folder" | "skill" | undefined });
    console.log(`Added source ${result.source.id} (${result.source.type}) -> ${result.source.path}`);
    if (result.reboundOrphans.length) console.log(`Rebound orphans: ${result.reboundOrphans.join(", ")}`);
    console.log("Run `asm refresh` to index skills from this source.");
  });

source
  .command("update [id]")
  .description("Pull/rescan source(s); report skills with new versions (does NOT update SSOT)")
  .action(async (id: string | undefined) => {
    const { configStore, indexStore, stateStore } = await loadStores();
    const reports = await sourceUpdate(configStore, stateStore, id);
    if (!reports.length) {
      console.log("No sources to update.");
      return;
    }
    for (const report of reports) {
      const status = report.success ? "ok" : `failed${report.error ? `: ${report.error}` : ""}`;
      console.log(`${report.sourceId}\t${report.action}\t${status}`);
      if (report.updatableSkills.length) console.log(`  updatable: ${report.updatableSkills.join(", ")} (run \`asm skill update <name>\` or \`asm skill update --all\`)`);
      if (report.upToDateSkills.length) console.log(`  up-to-date: ${report.upToDateSkills.join(", ")}`);
    }
    const refreshed = await refreshIndex(await configStore.read(), await stateStore.read());
    await indexStore.write(refreshed);
  });

source
  .command("remove <id>")
  .description("Remove source (default keeps SSOT skills as orphans; --purge cascade-deletes)")
  .option("--purge", "cascade-delete SSOT skill + agent symlinks")
  .action(async (id: string, options: { purge?: boolean }) => {
    const { configStore, stateStore } = await loadStores();
    const result = await removeSource(configStore, stateStore, id, { purge: options.purge });
    if (options.purge) console.log(`Removed source ${id} (purged: ${result.purged.join(", ") || "none"})`);
    else console.log(`Removed source ${id} (orphaned: ${result.orphaned.join(", ") || "none"})`);
  });

source
  .command("list")
  .description("List configured sources")
  .action(async () => {
    const { config } = await loadStores();
    const sources = listSources(config);
    if (!sources.length) {
      console.log("No sources configured.");
      return;
    }
    for (const s of sources) {
      const meta = [s.url ? `url=${s.url}` : "", s.branch ? `branch=${s.branch}` : ""].filter(Boolean).join(" ");
      console.log(`${s.id}\t${s.type}\t${s.enabled ? "enabled" : "disabled"}\t${s.path}${meta ? `\t${meta}` : ""}`);
    }
  });

source
  .command("enable <id>")
  .description("Enable a source (refresh will scan it again)")
  .action(async (id: string) => {
    const { configStore } = await loadStores();
    await setSourceEnabled(configStore, id, true);
    console.log(`Enabled source ${id}`);
  });

source
  .command("disable <id>")
  .description("Disable a source (refresh will skip it)")
  .action(async (id: string) => {
    const { configStore } = await loadStores();
    await setSourceEnabled(configStore, id, false);
    console.log(`Disabled source ${id}`);
  });

// === Layer 2 — Skill 库（SSOT 纳管） ===

const skill = program.command("skill").description("Skill commands: search, add, list, info, update, remove, rebind, enable, disable");

skill
  .command("search [query]")
  .description("Search indexable skills (matches name/displayName/description/tags)")
  .action(async (query: string | undefined) => {
    const { index } = await loadStores();
    const keyword = query ?? "";
    const skills = searchSkills(index, keyword);
    printSkillLines(skills, keyword.trim() ? `No skills matching '${keyword.trim()}'` : "No skills indexed. Run `asm refresh` first.");
  });

skill
  .command("add <name>")
  .description("Copy a skill from source into SSOT")
  .option("--source <id>", "source id (required when multiple sources provide the skill)")
  .action(async (name: string, options: { source?: string }) => {
    const { configStore, stateStore, index } = await loadStores();
    const record = await skillAdd(configStore, stateStore, index, name, { source: options.source });
    const src = record.source.kind === "configured-source" ? record.source.sourceId : "manual";
    console.log(`Added skill ${record.skillName} -> ${record.ssotPath} (source: ${src})`);
  });

skill
  .command("list")
  .description("List installed skills (managed + orphan)")
  .action(async () => {
    const { index } = await loadStores();
    const skills = Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name));
    printSkillLines(skills, "No skills indexed. Run `asm refresh` first.");
  });

skill
  .command("info <name>")
  .description("Show skill details: SSOT path / source / hash / enabled agents")
  .action(async (name: string) => {
    const { index, state } = await loadStores();
    const item = index.skills[name];
    if (!item) throw new Error(`Skill not found: ${name}`);
    console.log(`Name: ${item.name}`);
    console.log(`Status: ${item.status}`);
    if (item.description) console.log(`Description: ${item.description}`);
    console.log("Candidates:");
    for (const candidate of item.candidates) console.log(`- ${candidate.id}\n  source: ${candidate.sourceId} (${candidate.sourceType})\n  path: ${candidate.path}\n  description: ${candidate.description ?? ""}`);
    const installed = state.installedSkills[item.name];
    if (installed) {
      console.log(`SSOT: ${installed.ssotPath}`);
      console.log(`Content hash: ${installed.contentHash}`);
      console.log(`Enabled agents: ${Object.keys(installed.enabledAgents).join(", ") || "none"}`);
    }
    console.log("Installations:");
    for (const installation of Object.values(index.installations).filter((record) => record.skillName === item.name)) console.log(`- ${installation.agentId}: ${installation.status} ${installation.targetPath}${installation.reason ? ` (${installation.reason})` : ""}`);
  });

skill
  .command("update [name]")
  .description("Update SSOT to source's latest version")
  .option("--all", "update all installed managed skills")
  .action(async (name: string | undefined, options: { all?: boolean }) => {
    if (options.all && name) throw new Error("--all cannot be combined with a skill name");
    const target = options.all ? "--all" : name;
    if (!target) throw new Error("Usage: asm skill update <name|--all>");
    const { configStore, stateStore, indexStore } = await loadStores();
    const reports = await skillUpdate(configStore, stateStore, target);
    for (const r of reports) {
      const detail = r.success ? `updated ${r.oldHash?.slice(0, 8) ?? "?"} -> ${r.newHash?.slice(0, 8) ?? "?"}` : `failed: ${r.error}`;
      console.log(`${r.skillName}\t${detail}`);
    }
    const refreshed = await refreshIndex(await configStore.read(), await stateStore.read());
    await indexStore.write(refreshed);
  });

skill
  .command("remove <name>")
  .description("Remove skill from SSOT + detach all agent symlinks")
  .action(async (name: string) => {
    const { configStore, stateStore } = await loadStores();
    await skillRemove(configStore, stateStore, name);
    console.log(`Removed skill ${name} (SSOT + agent symlinks)`);
  });

skill
  .command("rebind <name>")
  .description("Re-associate an orphan/existing skill with a source")
  .requiredOption("--source <id>", "source id")
  .action(async (name: string, options: { source: string }) => {
    const { configStore, stateStore, index } = await loadStores();
    await skillRebind(configStore, stateStore, index, name, options.source);
    console.log(`Rebound skill ${name} -> source ${options.source}`);
  });

// === Layer 3 — Agent 启用（symlink 分发） ===

skill
  .command("enable <name>")
  .description("Enable a skill for an agent (SSOT → agent symlink)")
  .requiredOption("--agent <id>", "agent id")
  .action(async (name: string, options: { agent: string }) => {
    const { config, index, state, stateStore } = await loadStores();
    const plan = await buildInstallPlan(config, index, name, options.agent, state);
    printPlan(plan.actions, plan.hasConflict);
    await applyInstallPlan(plan, stateStore);
    console.log(`Enabled ${name} for ${options.agent}`);
  });

skill
  .command("disable <name>")
  .description("Disable a skill for an agent (remove symlink)")
  .requiredOption("--agent <id>", "agent id")
  .action(async (name: string, options: { agent: string }) => {
    const { config, state, stateStore } = await loadStores();
    const plan = await buildUninstallPlan(config, name, options.agent, state);
    printPlan(plan.actions, plan.hasConflict);
    await applyUninstallPlan(plan, stateStore);
    console.log(`Disabled ${name} for ${options.agent}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

async function loadStores() {
  const configStore = new ConfigStore();
  const indexStore = new IndexStore(configStore.home);
  const stateStore = new StateStore(configStore.home);
  if (!(await configStore.exists())) throw new Error("config.toml not found. Run `asm init` first.");
  const config = await configStore.read();
  const index = await indexStore.read();
  const state = await stateStore.read();
  return { configStore, indexStore, stateStore, config, index, state };
}

function printPlan(actions: InstallAction[], hasConflict: boolean): void {
  console.log(hasConflict ? "Plan has conflicts:" : "Plan:");
  for (const action of actions) {
    if (action.type === "create-symlink") console.log(`- create symlink [${action.agentId}] ${action.targetPath} -> ${action.linkTarget}`);
    else if (action.type === "copy-to-ssot") console.log(`- copy to SSOT ${action.sourcePath} -> ${action.targetPath}`);
    else if (action.type === "update-state") console.log(`- update state ${action.record.skillName}`);
    else if (action.type === "remove-symlink") console.log(`- remove symlink [${action.agentId}] ${action.targetPath}`);
    else if (action.type === "skip") console.log(`- skip [${action.agentId}] ${action.targetPath ?? ""} ${action.reason}`.trim());
    else if (action.type === "conflict") console.log(`- conflict [${action.agentId}] ${action.targetPath} ${action.reason}`.trim());
    else console.log(`- repair-broken-link [${action.agentId}] ${action.targetPath}`);
  }
}

function symbol(status: "ok" | "warning" | "error"): string {
  if (status === "ok") return "✓";
  if (status === "warning") return "!";
  return "✗";
}

/** skill list/search 的表格输出；空结果打印 emptyMessage（如「No skills matching 'x'」）。 */
function printSkillLines(skills: readonly SkillRecord[], emptyMessage: string): void {
  if (!skills.length) {
    console.log(emptyMessage);
    return;
  }
  for (const line of formatSkillRows(skills)) console.log(line);
}
