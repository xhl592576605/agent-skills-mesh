#!/usr/bin/env node
import { cac } from "cac";
import { ConfigStore } from "../core/storage/config-store.js";
import { IndexStore } from "../core/storage/index-store.js";
import { StateStore } from "../core/storage/state-store.js";
import { refreshIndex } from "../core/services/refresh-service.js";
import { applyInstallPlan, applyUninstallPlan, buildInstallPlan, buildUninstallPlan } from "../core/services/install-service.js";
import { runDoctor } from "../core/services/doctor-service.js";
import { addRepoSource, addSource, listSources, removeSource, setSourceEnabled, syncSources } from "../core/services/source-service.js";
import { addSingleSkill, importSkillToSsot, preferSkill, searchSkills } from "../core/services/skill-service.js";
import { formatSkillRows } from "./skill-format.js";
import type { SkillRecord } from "../core/models/skill.js";
import type { InstallAction } from "../core/models/install-plan.js";
import { adoptSkill, listDiscover, setIgnored } from "../core/services/discover-service.js";

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
  const { configStore, indexStore, config, index, state } = await loadStores();
  const next = await refreshIndex(config, index, state);
  await indexStore.write(next);
  console.log(`Refreshed ${Object.keys(next.skills).length} skills from ${Object.keys(next.sources).length} sources`);
  void configStore;
});

cli.command("skill <subcommand> [name]", "Skill commands: list, search, info, add, import, prefer")
  .option("--source <id>", "Source id (for prefer)")
  .option("--id <id>", "Custom source id (for add/import)")
  .action(async (subcommand: string, name?: string, options: { source?: string; id?: string } = {}) => {
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
      if (item.preferredSourceId) console.log(`Preferred source: ${item.preferredSourceId}`);
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
      if (!name) throw new Error("Usage: asm skill add <path>");
      const { configStore } = await loadStores();
      const source = await addSingleSkill(configStore, name, { id: options.id });
      console.log(`Added skill source ${source.id} -> ${source.path}`);
      console.log("Run `asm refresh` to index this skill.");
      return;
    }
    if (subcommand === "import") {
      if (!name) throw new Error("Usage: asm skill import <path>");
      const { configStore, stateStore } = await loadStores();
      const record = await importSkillToSsot(configStore, stateStore, name);
      console.log(`Imported skill to SSOT ${record.skillName} -> ${record.ssotPath}`);
      console.log("Run `asm refresh` to update the index.");
      return;
    }
    if (subcommand === "prefer") {
      if (!name) throw new Error("Usage: asm skill prefer <name> --source <id>");
      if (!options.source) throw new Error("Missing required option: --source <id>");
      const { configStore, indexStore, config, index, state } = await loadStores();
      const fresh = await refreshIndex(config, index, state);
      await indexStore.write(fresh);
      await preferSkill(configStore, indexStore, name, options.source);
      console.log(`Preferred source for ${name}: ${options.source}`);
      console.log("Run `asm refresh` to apply the preference.");
      return;
    }
    throw new Error(`Unknown skill command: ${subcommand}`);
  });

cli.command("install <skillName>", "Install skill for an agent")
  .option("--agent <agent>", "Agent id")
  .option("--dry-run", "Only print install plan")
  .action(async (skillName: string, options: { agent?: string; dryRun?: boolean }) => {
    const { config, index, state, stateStore } = await loadStores();
    const agentId = options.agent ?? config.settings.default_agent;
    const plan = await buildInstallPlan(config, index, skillName, agentId, state);
    printPlan(plan.actions, plan.hasConflict);
    if (options.dryRun) return;
    await applyInstallPlan(plan, stateStore);
    console.log("Install applied");
  });

cli.command("uninstall <skillName>", "Uninstall skill symlink for an agent")
  .option("--agent <agent>", "Agent id")
  .option("--dry-run", "Only print uninstall plan")
  .action(async (skillName: string, options: { agent?: string; dryRun?: boolean }) => {
    const { config, state, stateStore } = await loadStores();
    const agentId = options.agent ?? config.settings.default_agent;
    const plan = await buildUninstallPlan(config, skillName, agentId, state);
    printPlan(plan.actions, plan.hasConflict);
    if (options.dryRun) return;
    await applyUninstallPlan(plan, stateStore);
    console.log("Uninstall applied");
  });

cli.command("source <subcommand> [arg]", "Source commands: list, add, add-repo, sync, remove, enable, disable")
  .option("--id <id>", "Custom source id (for add/add-repo)")
  .option("--branch <branch>", "Branch to clone (for add-repo)")
  .option("--purge", "Also delete the cloned repository directory (for remove)")
  .action(async (subcommand: string, arg?: string, options: { id?: string; branch?: string; purge?: boolean } = {}) => {
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
      if (!arg) throw new Error("Usage: asm source add <path>");
      const { configStore } = await loadStores();
      const source = await addSource(configStore, arg, { id: options.id });
      console.log(`Added source ${source.id} (${source.type}) -> ${source.path}`);
      console.log("Run `asm refresh` to index skills from this source.");
      return;
    }
    if (subcommand === "add-repo") {
      if (!arg) throw new Error("Usage: asm source add-repo <url>");
      const { configStore } = await loadStores();
      const source = await addRepoSource(configStore, arg, { id: options.id, branch: options.branch });
      console.log(`Cloned and added source ${source.id} (git-repo) -> ${source.path}`);
      console.log("Run `asm refresh` to index skills from this source.");
      return;
    }
    if (subcommand === "sync") {
      const { configStore, indexStore, stateStore, config, index } = await loadStores();
      const results = await syncSources(configStore, arg, stateStore);
      if (!results.length) {
        console.log("No git-repo sources to sync.");
        return;
      }
      for (const result of results) {
        const status = result.success ? "ok" : `failed${result.error ? `: ${result.error}` : ""}`;
        const details = [
          result.updatedSkills?.length ? `updated=${result.updatedSkills.join(",")}` : "",
          result.conflicts?.length ? `conflicts=${result.conflicts.length}` : ""
        ].filter(Boolean).join("\t");
        console.log(`${result.sourceId}\t${result.action}\t${status}${details ? `\t${details}` : ""}`);
      }
      const refreshed = await refreshIndex(config, index, await stateStore.read());
      await indexStore.write(refreshed);
      console.log(`Refreshed ${Object.keys(refreshed.skills).length} skills after sync.`);
      return;
    }
    if (subcommand === "remove") {
      if (!arg) throw new Error("Usage: asm source remove <id>");
      const { configStore } = await loadStores();
      await removeSource(configStore, arg, { purge: options.purge });
      console.log(`Removed source ${arg}`);
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

cli.command("discover", "List discovered, external, broken-link, and conflict items").action(async () => {
  const { index } = await loadStores();
  const entries = listDiscover(index);
  if (!entries.length) {
    console.log("No discoverable items.");
    return;
  }
  for (const entry of entries) console.log(`${entry.kind}\t${entry.skillName}\t${entry.detail}`);
});

cli.command("adopt <skill>", "Import a discovered skill into SSOT and symlink it back").action(async (skill: string) => {
  const { configStore, indexStore, stateStore } = await loadStores();
  const result = await adoptSkill(configStore, indexStore, skill, stateStore);
  console.log(`Adopted ${result.skillName}: ${result.sourcePath} -> ${result.targetPath}`);
  if (result.sourcePath !== result.targetPath) console.log(`Reinstalled symlink at ${result.sourcePath}`);
});

cli.command("ignore <skill>", "Ignore a discoverable skill").action(async (skill: string) => {
  const { configStore, indexStore, stateStore } = await loadStores();
  await setIgnored(configStore, indexStore, skill, true, stateStore);
  console.log(`Ignored ${skill}`);
});

cli.command("unignore <skill>", "Stop ignoring a skill").action(async (skill: string) => {
  const { configStore, indexStore, stateStore } = await loadStores();
  await setIgnored(configStore, indexStore, skill, false, stateStore);
  console.log(`Unignored ${skill}`);
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
