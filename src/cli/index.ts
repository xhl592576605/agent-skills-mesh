#!/usr/bin/env node
import { cac } from "cac";
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

const cli = cac("asm");

cli.command("init", "Initialize Agent Skills Mesh home")
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

cli.command("refresh", "Scan sources and update index").action(async () => {
  const { indexStore, config, state } = await loadStores();
  const next = await refreshIndex(config, state);
  await indexStore.write(next);
  console.log(`Refreshed ${Object.keys(next.skills).length} skills`);
});

cli.command("skill <subcommand> [name]", "Skill commands: list, search, info, add, update, remove, rebind, enable, disable")
  .option("--source <id>", "Source id (for add/rebind)")
  .option("--agent <agent>", "Agent id (for enable/disable)")
  .action(async (subcommand: string, name?: string, options: { source?: string; agent?: string } = {}) => {
    if (subcommand === "list") {
      const { index } = await loadStores();
      const skills = Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name));
      printSkillLines(skills, "No skills indexed. Run `asm refresh` first.");
      return;
    }
    if (subcommand === "search") {
      const keyword = name ?? "";
      const { index } = await loadStores();
      const skills = searchSkills(index, keyword);
      printSkillLines(
        skills,
        keyword.trim() ? `No skills matching '${keyword.trim()}'` : "No skills indexed. Run `asm refresh` first."
      );
      return;
    }
    if (subcommand === "info") {
      if (!name) throw new Error("Usage: asm skill info <name>");
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
      return;
    }
    if (subcommand === "add") {
      if (!name) throw new Error("Usage: asm skill add <name> [--source <id>]");
      const { configStore, stateStore, index } = await loadStores();
      const record = await skillAdd(configStore, stateStore, index, name, { source: options.source });
      const src = record.source.kind === "configured-source" ? record.source.sourceId : "manual";
      console.log(`Added skill ${record.skillName} -> ${record.ssotPath} (source: ${src})`);
      return;
    }
    if (subcommand === "update") {
      if (!name) throw new Error("Usage: asm skill update <name|--all>");
      const { configStore, stateStore, indexStore } = await loadStores();
      const reports = await skillUpdate(configStore, stateStore, name);
      for (const r of reports) {
        const detail = r.success ? `updated ${r.oldHash?.slice(0, 8) ?? "?"} -> ${r.newHash?.slice(0, 8) ?? "?"}` : `failed: ${r.error}`;
        console.log(`${r.skillName}\t${detail}`);
      }
      const refreshed = await refreshIndex(await configStore.read(), await stateStore.read());
      await indexStore.write(refreshed);
      return;
    }
    if (subcommand === "remove") {
      if (!name) throw new Error("Usage: asm skill remove <name>");
      const { configStore, stateStore } = await loadStores();
      await skillRemove(configStore, stateStore, name);
      console.log(`Removed skill ${name} (SSOT + agent symlinks)`);
      return;
    }
    if (subcommand === "rebind") {
      if (!name) throw new Error("Usage: asm skill rebind <name> --source <id>");
      if (!options.source) throw new Error("Missing required option: --source <id>");
      const { configStore, stateStore, index } = await loadStores();
      await skillRebind(configStore, stateStore, index, name, options.source);
      console.log(`Rebound skill ${name} -> source ${options.source}`);
      return;
    }
    if (subcommand === "enable") {
      if (!name) throw new Error("Usage: asm skill enable <name> --agent <id>");
      if (!options.agent) throw new Error("Missing required option: --agent <id>");
      const { config, index, state, stateStore } = await loadStores();
      const plan = await buildInstallPlan(config, index, name, options.agent, state);
      printPlan(plan.actions, plan.hasConflict);
      await applyInstallPlan(plan, stateStore);
      console.log(`Enabled ${name} for ${options.agent}`);
      return;
    }
    if (subcommand === "disable") {
      if (!name) throw new Error("Usage: asm skill disable <name> --agent <id>");
      if (!options.agent) throw new Error("Missing required option: --agent <id>");
      const { config, state, stateStore } = await loadStores();
      const plan = await buildUninstallPlan(config, name, options.agent, state);
      printPlan(plan.actions, plan.hasConflict);
      await applyUninstallPlan(plan, stateStore);
      console.log(`Disabled ${name} for ${options.agent}`);
      return;
    }
    throw new Error(`Unknown skill command: ${subcommand}`);
  });

cli.command("source <subcommand> [arg]", "Source commands: list, add, sync, remove, enable, disable")
  .option("--id <id>", "Custom source id (for add)")
  .option("--type <type>", "Source type: repo|folder|skill (for add, auto-inferred if omitted)")
  .option("--branch <branch>", "Branch to clone (for add --type repo)")
  .option("--purge", "Cascade-delete SSOT skill + agent symlinks (for remove)")
  .action(async (subcommand: string, arg?: string, options: { id?: string; type?: string; branch?: string; purge?: boolean } = {}) => {
    if (subcommand === "list") {
      const { config } = await loadStores();
      const sources = listSources(config);
      if (!sources.length) {
        console.log("No sources configured.");
        return;
      }
      for (const source of sources) {
        const meta = [source.url ? `url=${source.url}` : "", source.branch ? `branch=${source.branch}` : ""].filter(Boolean).join(" ");
        console.log(`${source.id}\t${source.type}\t${source.enabled ? "enabled" : "disabled"}\t${source.path}${meta ? `\t${meta}` : ""}`);
      }
      return;
    }
    if (subcommand === "add") {
      if (!arg) throw new Error("Usage: asm source add <url|path>");
      const { configStore, stateStore } = await loadStores();
      const result = await addSource(configStore, stateStore, arg, { id: options.id, branch: options.branch, type: options.type as "repo" | "folder" | "skill" | undefined });
      console.log(`Added source ${result.source.id} (${result.source.type}) -> ${result.source.path}`);
      if (result.reboundOrphans.length) console.log(`Rebound orphans: ${result.reboundOrphans.join(", ")}`);
      console.log("Run `asm refresh` to index skills from this source.");
      return;
    }
    if (subcommand === "sync") {
      const { configStore, indexStore, stateStore } = await loadStores();
      const reports = await sourceUpdate(configStore, stateStore, arg);
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
      return;
    }
    if (subcommand === "remove") {
      if (!arg) throw new Error("Usage: asm source remove <id>");
      const { configStore, stateStore } = await loadStores();
      const result = await removeSource(configStore, stateStore, arg, { purge: options.purge });
      if (options.purge) console.log(`Removed source ${arg} (purged: ${result.purged.join(", ") || "none"})`);
      else console.log(`Removed source ${arg} (orphaned: ${result.orphaned.join(", ") || "none"})`);
      return;
    }
    if (subcommand === "enable") {
      if (!arg) throw new Error("Usage: asm source enable <id>");
      const { configStore } = await loadStores();
      await setSourceEnabled(configStore, arg, true);
      console.log(`Enabled source ${arg}`);
      return;
    }
    if (subcommand === "disable") {
      if (!arg) throw new Error("Usage: asm source disable <id>");
      const { configStore } = await loadStores();
      await setSourceEnabled(configStore, arg, false);
      console.log(`Disabled source ${arg}`);
      return;
    }
    throw new Error(`Unknown source command: ${subcommand}`);
  });

cli.command("doctor", "Run health checks").action(async () => {
  const configStore = new ConfigStore();
  const indexStore = new IndexStore(configStore.home);
  const config = (await configStore.exists()) ? await configStore.read() : undefined;
  const index = (await indexStore.exists()) ? await indexStore.read() : undefined;
  const checks = await runDoctor(configStore, indexStore, config, index);
  for (const check of checks) console.log(`${symbol(check.status)} ${check.kind}: ${check.message}`);
  if (checks.some((check) => check.status === "error")) process.exitCode = 1;
});

cli.command("tui", "Open interactive TUI").action(async () => {
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

cli.help();
cli.parse();

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
