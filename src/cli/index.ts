#!/usr/bin/env node
import { cac } from "cac";
import { ConfigStore } from "../core/storage/config-store.js";
import { IndexStore } from "../core/storage/index-store.js";
import { refreshIndex } from "../core/services/refresh-service.js";
import { applyInstallPlan, applyUninstallPlan, buildInstallPlan, buildUninstallPlan } from "../core/services/install-service.js";
import { runDoctor } from "../core/services/doctor-service.js";

const cli = cac("asm");

cli.command("init", "Initialize Agent Skills Mesh home")
  .option("--force", "Overwrite existing config and index")
  .action(async (options: { force?: boolean }) => {
    const configStore = new ConfigStore();
    const indexStore = new IndexStore(configStore.home);
    await configStore.init({ force: options.force });
    await indexStore.init({ force: options.force });
    console.log(`Initialized ${configStore.home}`);
  });

cli.command("refresh", "Scan sources and update index").action(async () => {
  const { configStore, indexStore, config, index } = await loadStores();
  const next = await refreshIndex(config, index);
  await indexStore.write(next);
  console.log(`Refreshed ${Object.keys(next.skills).length} skills from ${Object.keys(next.sources).length} sources`);
  void configStore;
});

cli.command("skill <subcommand> [name]", "Skill commands: list, info <name>").action(async (subcommand: string, name?: string) => {
  if (subcommand === "list") {
    const { index } = await loadStores();
    const skills = Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name));
    if (!skills.length) {
      console.log("No skills indexed. Run `asm refresh` first.");
      return;
    }
    for (const item of skills) console.log(`${item.name}\t${item.status}\t${item.description ?? ""}`);
    return;
  }
  if (subcommand === "info") {
    if (!name) throw new Error("Usage: asm skill info <name>");
    const { index } = await loadStores();
    const item = index.skills[name];
    if (!item) throw new Error(`Skill not found: ${name}`);
    console.log(`Name: ${item.name}`);
    console.log(`Status: ${item.status}`);
    if (item.description) console.log(`Description: ${item.description}`);
    if (item.preferredSourceId) console.log(`Preferred source: ${item.preferredSourceId}`);
    console.log("Candidates:");
    for (const candidate of item.candidates) console.log(`- ${candidate.id}\n  source: ${candidate.sourceId} (${candidate.sourceType})\n  path: ${candidate.path}\n  description: ${candidate.description ?? ""}`);
    console.log("Installations:");
    for (const installation of Object.values(index.installations).filter((record) => record.skillName === item.name)) console.log(`- ${installation.agentId}: ${installation.status} ${installation.targetPath}${installation.reason ? ` (${installation.reason})` : ""}`);
    return;
  }
  throw new Error(`Unknown skill command: ${subcommand}`);
});

cli.command("install <skillName>", "Install skill for an agent")
  .option("--agent <agent>", "Agent id")
  .option("--dry-run", "Only print install plan")
  .action(async (skillName: string, options: { agent?: string; dryRun?: boolean }) => {
    const { config, index } = await loadStores();
    const agentId = options.agent ?? config.settings.default_agent;
    const plan = await buildInstallPlan(config, index, skillName, agentId);
    printPlan(plan.actions, plan.hasConflict);
    if (options.dryRun) return;
    await applyInstallPlan(plan);
    console.log("Install applied");
  });

cli.command("uninstall <skillName>", "Uninstall skill symlink for an agent")
  .option("--agent <agent>", "Agent id")
  .option("--dry-run", "Only print uninstall plan")
  .action(async (skillName: string, options: { agent?: string; dryRun?: boolean }) => {
    const { config } = await loadStores();
    const agentId = options.agent ?? config.settings.default_agent;
    const plan = await buildUninstallPlan(config, skillName, agentId);
    printPlan(plan.actions, plan.hasConflict);
    if (options.dryRun) return;
    await applyUninstallPlan(plan);
    console.log("Uninstall applied");
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

cli.help();
cli.parse();

async function loadStores() {
  const configStore = new ConfigStore();
  const indexStore = new IndexStore(configStore.home);
  if (!(await configStore.exists())) throw new Error("config.toml not found. Run `asm init` first.");
  const config = await configStore.read();
  const index = await indexStore.read();
  return { configStore, indexStore, config, index };
}

function printPlan(actions: Array<{ type: string; agentId: string; targetPath?: string; reason?: string; linkTarget?: string }>, hasConflict: boolean): void {
  console.log(hasConflict ? "Plan has conflicts:" : "Plan:");
  for (const action of actions) {
    if (action.type === "create-symlink") console.log(`- create symlink [${action.agentId}] ${action.targetPath} -> ${action.linkTarget}`);
    else console.log(`- ${action.type} [${action.agentId}] ${action.targetPath ?? ""} ${action.reason ?? ""}`.trim());
  }
}

function symbol(status: "ok" | "warning" | "error"): string {
  if (status === "ok") return "✓";
  if (status === "warning") return "!";
  return "✗";
}
