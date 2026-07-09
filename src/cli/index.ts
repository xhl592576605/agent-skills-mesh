#!/usr/bin/env node
import { Command } from "commander";
import { ConfigStore } from "../core/storage/config-store.js";
import { IndexStore } from "../core/storage/index-store.js";
import { StateStore } from "../core/storage/state-store.js";
import { refreshIndex } from "../core/services/refresh-service.js";
import { applyInstallPlan, applyUninstallPlan, buildInstallPlan, buildUninstallPlan } from "../core/services/install-service.js";
import { runDoctor } from "../core/services/doctor-service.js";
import { addSource, listSources, removeSource, setSourceEnabled, sourceUpdate } from "../core/services/source-service.js";
import { searchSkills, skillAdd, skillRebind, skillRemove, skillUpdate, listInstalledSkills } from "../core/services/skill-service.js";
import { addAgent, listAgents, removeAgent, setAgentEnabled } from "../core/services/agent-service.js";
import { bizError } from "../core/errors.js";
import { resolveLanguage, t, formatError, detectSystemLocale, type Locale } from "../i18n/index.js";
import { formatSkillRows, formatInstalledRows } from "./skill-format.js";
import { renderTable } from "./columns.js";
import type { SkillRecord } from "../core/models/skill.js";
import type { InstallAction } from "../core/models/install-plan.js";
import fsSync from "node:fs";
import path from "node:path";
import { getAsmHome } from "../utils/path.js";

/**
 * 同步预解析语言（供 commander description/option 在 parse 前绑定用）。
 * 优先级与 resolveCliLang 一致：--lang flag > ASM_LANG > config.language > 系统 locale > en。
 * 同步读 config（fsSync）因 description 在 module 顶层定义；detectSystemLocale 含 macOS defaults 修复。
 */
function readConfigLangSync(): string | undefined {
  try {
    const configPath = path.join(getAsmHome(), "config.toml");
    if (!fsSync.existsSync(configPath)) return undefined;
    const content = fsSync.readFileSync(configPath, "utf8");
    const m = content.match(/^language\s*=\s*"([^"]+)"/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}
function preParseLang(): Locale {
  const argv = process.argv;
  let explicit: string | undefined;
  const idx = argv.indexOf("--lang");
  if (idx !== -1 && argv[idx + 1]) explicit = argv[idx + 1];
  for (const a of argv) {
    if (a.startsWith("--lang=")) { explicit = a.slice("--lang=".length); break; }
  }
  return resolveLanguage({ explicit: explicit ?? process.env.ASM_LANG, config: readConfigLangSync() });
}
const preLang = preParseLang();
const cliVersion = process.env.ASM_VERSION ?? process.env.npm_package_version ?? "0.0.0";

const program = new Command();
program
  .name("asm")
  .description(t("cmd.program.desc", preLang))
  .version(cliVersion)
  // 全局语言选项。commander v15 中 program 级 option 由 program.opts() 在子 command
  // 前/后任意位置统一捕获（实测），故无需在每个子 command 重复声明。
  .option("-L, --lang <lang>", t("cmd.lang.option", preLang));

// commander 的 description()/option() 描述经 preParseLang() 预解析语言后走 t()（--help 双语）。

/**
 * 当前命令的语言。每个 action 首行用 {@link resolveCliLang} 更新；
 * 底部 `parseAsync().catch()` 用它格式化未被 action 捕获的错误（此时已无 action 作用域）。
 * 初始值为系统 locale，作为 action 未执行时的兜底。
 */
let currentLang: Locale = detectSystemLocale();

/**
 * 解析本次命令的最终语言。优先级链（design §3 / AC2）：
 * `--lang` flag（program.opts()） > `$ASM_LANG` > `config.toml settings.language`
 * > 系统 locale > `en`。
 *
 * config 缺失或读取失败时静默回落到 locale/en，不阻塞命令。
 */
async function resolveCliLang(): Promise<Locale> {
  const explicit = (program.opts().lang as string | undefined) ?? process.env.ASM_LANG;
  let configLang: string | undefined;
  try {
    const configStore = new ConfigStore();
    if (await configStore.exists()) configLang = (await configStore.read()).settings.language;
  } catch {
    // config 缺失/损坏时回落 locale/en。
  }
  return resolveLanguage({ explicit, config: configLang });
}

// === 顶层生命周期命令 ===

program
  .command("init")
  .description(t("cmd.init.desc", preLang))
  .option("--force", t("cmd.init.option.force", preLang))
  .action(async (options: { force?: boolean }) => {
    const lang = (currentLang = await resolveCliLang());
    const configStore = new ConfigStore();
    const indexStore = new IndexStore(configStore.home);
    const stateStore = new StateStore(configStore.home);
    await configStore.init({ force: options.force });
    await indexStore.init({ force: options.force });
    await stateStore.init({ force: options.force });
    console.log(t("msg.initialized", lang, { home: String(configStore.home) }));
  });

program
  .command("refresh")
  .description(t("cmd.refresh.desc", preLang))
  .action(async () => {
    const lang = (currentLang = await resolveCliLang());
    const { indexStore, config, state } = await loadStores();
    const next = await refreshIndex(config, state);
    await indexStore.write(next);
    console.log(t("msg.refreshed", lang, { count: Object.keys(next.skills).length }));
  });

program
  .command("doctor")
  .description(t("cmd.doctor.desc", preLang))
  .action(async () => {
    currentLang = await resolveCliLang();
    const configStore = new ConfigStore();
    const indexStore = new IndexStore(configStore.home);
    const config = (await configStore.exists()) ? await configStore.read() : undefined;
    const index = (await indexStore.exists()) ? await indexStore.read() : undefined;
    const checks = await runDoctor(configStore, indexStore, config, index);
    // check.kind（external/broken-link/...）与 check.message（core 层动态诊断文本）保留原文：
    // doctor 返回 typed DoctorCheck[]（非 throw 错误），其 message 翻译不属本次 CLI 接入范围。
    for (const check of checks) console.log(`${symbol(check.status)} ${check.kind}: ${check.message}`);
    if (checks.some((check) => check.status === "error")) process.exitCode = 1;
  });

program
  .command("tui")
  .description(t("cmd.tui.desc", preLang))
  .action(async () => {
    const lang = (currentLang = await resolveCliLang());
    if (!process.stdout.isTTY) {
      console.error(t("msg.tuiRequiresTty", lang));
      process.exitCode = 1;
      return;
    }
    // config 缺失先给终端友好错误（与其它非 init 命令一致）。走底部 catch 的 formatError。
    const configStore = new ConfigStore();
    if (!(await configStore.exists())) throw bizError("CONFIG_NOT_FOUND");
    // 懒加载 TUI（@opentui/solid），避免 CLI 冷启动加载渲染依赖。run() 内部 render(App)。
    const { run } = await import("../tui/index.js");
    run(lang);
  });

// === Layer 1 — Source（来源） ===

const source = program.command("source").description(t("cmd.source.desc", preLang));

source
  .command("add <target>")
  .description(t("cmd.source.add.desc", preLang))
  .option("--type <type>", t("cmd.source.add.option.type", preLang))
  .option("--branch <branch>", t("cmd.source.add.option.branch", preLang))
  .option("--id <id>", t("cmd.source.add.option.id", preLang))
  .action(async (target: string, options: { type?: string; branch?: string; id?: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore } = await loadStores();
    const result = await addSource(configStore, stateStore, target, { id: options.id, branch: options.branch, type: options.type as "repo" | "folder" | "skill" | undefined });
    console.log(t("msg.sourceAdded", lang, { id: result.source.id, type: result.source.type, path: result.source.path }));
    if (result.reboundOrphans.length) console.log(t("msg.reboundOrphans", lang, { list: result.reboundOrphans.join(", ") }));
    console.log(t("msg.runRefreshToIndex", lang));
  });

source
  .command("update [id]")
  .description(t("cmd.source.update.desc", preLang))
  .action(async (id: string | undefined) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, indexStore, stateStore } = await loadStores();
    const reports = await sourceUpdate(configStore, stateStore, id);
    if (!reports.length) {
      console.log(t("msg.noSourcesToUpdate", lang));
      return;
    }
    const updateRows = reports.map((report) => {
      const status = report.success
        ? t("status.ok", lang)
        : report.error
          ? t("status.failedDetail", lang, { error: report.error })
          : t("status.failed", lang);
      const detail = report.updatableSkills.length
        ? t("status.updatable", lang, { list: report.updatableSkills.join(", ") })
        : report.upToDateSkills.length
          ? t("status.upToDate", lang)
          : "—";
      return [report.sourceId, report.action, status, detail];
    });
    for (const line of renderTable([t("table.source", lang), t("table.action", lang), t("table.status", lang), t("table.detail", lang)], updateRows, [18, 8, 24, 48])) console.log(line);
    if (reports.some((r) => r.updatableSkills.length)) console.log(t("msg.runSkillUpdateToApply", lang));
    const refreshed = await refreshIndex(await configStore.read(), await stateStore.read());
    await indexStore.write(refreshed);
  });

source
  .command("remove <id>")
  .description(t("cmd.source.remove.desc", preLang))
  .option("--purge", t("cmd.source.remove.option.purge", preLang))
  .action(async (id: string, options: { purge?: boolean }) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore } = await loadStores();
    const result = await removeSource(configStore, stateStore, id, { purge: options.purge });
    if (options.purge) console.log(t("msg.sourceRemovedPurged", lang, { id, list: result.purged.join(", ") || t("common.none", lang) }));
    else console.log(t("msg.sourceRemovedOrphaned", lang, { id, list: result.orphaned.join(", ") || t("common.none", lang) }));
  });

source
  .command("list")
  .description(t("cmd.source.list.desc", preLang))
  .action(async () => {
    const lang = (currentLang = await resolveCliLang());
    const { config } = await loadStores();
    const sources = listSources(config);
    if (!sources.length) {
      console.log(t("msg.noSourcesConfigured", lang));
      return;
    }
    const sourceRows = sources.map((s) => {
      const meta = [s.url ? `url=${s.url}` : "", s.branch ? `branch=${s.branch}` : ""].filter(Boolean).join(" ");
      return [s.id, s.type, s.enabled ? t("status.enabled", lang) : t("status.disabled", lang), s.path, meta];
    });
    for (const line of renderTable([t("table.id", lang), t("table.type", lang), t("table.enabled", lang), t("table.path", lang), t("table.meta", lang)], sourceRows, [18, 12, 9, 44, 24])) console.log(line);
  });

source
  .command("enable <id>")
  .description(t("cmd.source.enable.desc", preLang))
  .action(async (id: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore } = await loadStores();
    await setSourceEnabled(configStore, id, true);
    console.log(t("msg.sourceEnabled", lang, { id }));
  });

source
  .command("disable <id>")
  .description(t("cmd.source.disable.desc", preLang))
  .action(async (id: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore } = await loadStores();
    await setSourceEnabled(configStore, id, false);
    console.log(t("msg.sourceDisabled", lang, { id }));
  });

// === Layer 2 — Skill 库（SSOT 纳管） ===

const skill = program.command("skill").description(t("cmd.skill.desc", preLang));

skill
  .command("search [query]")
  .description(t("cmd.skill.search.desc", preLang))
  .action(async (query: string | undefined) => {
    const lang = (currentLang = await resolveCliLang());
    const { index } = await loadStores();
    const keyword = query ?? "";
    const skills = searchSkills(index, keyword);
    const empty = keyword.trim()
      ? t("msg.noSkillsMatching", lang, { query: keyword.trim() })
      : t("msg.noSkillsIndexed", lang);
    printSkillLines(skills, lang, empty);
  });

skill
  .command("add <name>")
  .description(t("cmd.skill.add.desc", preLang))
  .option("--source <id>", t("cmd.skill.add.option.source", preLang))
  .action(async (name: string, options: { source?: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore, index } = await loadStores();
    const record = await skillAdd(configStore, stateStore, index, name, { source: options.source });
    const src = record.source.kind === "configured-source" ? record.source.sourceId : "manual";
    console.log(t("msg.skillAdded", lang, { name: record.skillName, path: record.ssotPath, source: src }));
  });

skill
  .command("list")
  .description(t("cmd.skill.list.desc", preLang))
  .action(async () => {
    const lang = (currentLang = await resolveCliLang());
    const { index, state } = await loadStores();
    const rows = listInstalledSkills(state, index);
    if (!rows.length) {
      console.log(t("msg.noSkillsAdded", lang));
      return;
    }
    for (const line of formatInstalledRows(rows, lang)) console.log(line);
  });

skill
  .command("info <name>")
  .description(t("cmd.skill.info.desc", preLang))
  .action(async (name: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { index, state } = await loadStores();
    const item = index.skills[name];
    if (!item) throw bizError("SKILL_NOT_FOUND", { name });
    console.log(`${t("info.name", lang)}: ${item.name}`);
    console.log(`${t("info.status", lang)}: ${item.status}`);
    if (item.description) console.log(`${t("info.description", lang)}: ${item.description}`);
    console.log(t("info.candidates", lang) + ":");
    for (const candidate of item.candidates) console.log(t("info.candidateBlock", lang, { id: candidate.id, source: candidate.sourceId, type: candidate.sourceType, path: candidate.path, desc: candidate.description ?? "" }));
    const installed = state.installedSkills[item.name];
    if (installed) {
      console.log(`${t("info.ssot", lang)}: ${installed.ssotPath}`);
      console.log(`${t("info.contentHash", lang)}: ${installed.contentHash}`);
      console.log(`${t("info.enabledAgents", lang)}: ${Object.keys(installed.enabledAgents).join(", ") || t("common.none", lang)}`);
    }
    console.log(t("info.installations", lang) + ":");
    for (const installation of Object.values(index.installations).filter((record) => record.skillName === item.name)) console.log(t("info.installationLine", lang, { agent: installation.agentId, status: installation.status, target: installation.targetPath }) + (installation.reason ? ` (${installation.reason})` : ""));
  });

skill
  .command("update [name]")
  .description(t("cmd.skill.update.desc", preLang))
  .option("--all", t("cmd.skill.update.option.all", preLang))
  .action(async (name: string | undefined, options: { all?: boolean }) => {
    const lang = (currentLang = await resolveCliLang());
    // 参数校验：直接输出 i18n 提示并退出，不走 throw/C 类前缀包裹。
    if (options.all && name) {
      console.error(t("msg.allWithName", lang));
      process.exitCode = 1;
      return;
    }
    const target = options.all ? "--all" : name;
    if (!target) {
      console.error(t("msg.usageSkillUpdate", lang));
      process.exitCode = 1;
      return;
    }
    const { configStore, stateStore, indexStore } = await loadStores();
    const reports = await skillUpdate(configStore, stateStore, target);
    const skillRows = reports.map((r) => {
      const detail = r.success ? `${r.oldHash?.slice(0, 8) ?? "?"} -> ${r.newHash?.slice(0, 8) ?? "?"}` : t("status.failedDetail", lang, { error: r.error ?? "" });
      return [r.skillName, r.success ? t("status.ok", lang) : t("status.failed", lang), detail];
    });
    for (const line of renderTable([t("table.skill", lang), t("table.status", lang), t("table.detail", lang)], skillRows, [24, 9, 48])) console.log(line);
    const refreshed = await refreshIndex(await configStore.read(), await stateStore.read());
    await indexStore.write(refreshed);
  });

skill
  .command("remove <name>")
  .description(t("cmd.skill.remove.desc", preLang))
  .action(async (name: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore } = await loadStores();
    await skillRemove(configStore, stateStore, name);
    console.log(t("msg.skillRemoved", lang, { name }));
  });

skill
  .command("rebind <name>")
  .description(t("cmd.skill.rebind.desc", preLang))
  .requiredOption("--source <id>", "source id")
  .action(async (name: string, options: { source: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore, index } = await loadStores();
    await skillRebind(configStore, stateStore, index, name, options.source);
    console.log(t("msg.skillRebound", lang, { name, source: options.source }));
  });

// === Layer 3 — Agent 启用（symlink 分发） ===

skill
  .command("enable <name>")
  .description(t("cmd.skill.enable.desc", preLang))
  .requiredOption("--agent <id>", "agent id")
  .action(async (name: string, options: { agent: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { config, index, state, stateStore } = await loadStores();
    const plan = await buildInstallPlan(config, index, name, options.agent, state);
    printPlan(plan.actions, plan.hasConflict, lang);
    await applyInstallPlan(plan, stateStore);
    console.log(t("msg.skillEnabledForAgent", lang, { name, agent: options.agent }));
  });

skill
  .command("disable <name>")
  .description(t("cmd.skill.disable.desc", preLang))
  .requiredOption("--agent <id>", "agent id")
  .action(async (name: string, options: { agent: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { config, state, stateStore } = await loadStores();
    const plan = await buildUninstallPlan(config, name, options.agent, state);
    printPlan(plan.actions, plan.hasConflict, lang);
    await applyUninstallPlan(plan, stateStore);
    console.log(t("msg.skillDisabledForAgent", lang, { name, agent: options.agent }));
  });

// === Agent 启停（R5） ===

const agentCmd = program.command("agent").description(t("cmd.agent.desc", preLang));

agentCmd
  .command("list")
  .description(t("cmd.agent.list.desc", preLang))
  .action(async () => {
    const lang = (currentLang = await resolveCliLang());
    const { config } = await loadStores();
    const rows = await listAgents(config);
    if (!rows.length) {
      console.log(t("msg.noAgentsConfigured", lang));
      return;
    }
    const data = rows.map((r) => [r.id, r.name, r.installed ? t("status.installed", lang) : t("status.missing", lang), r.enabled ? t("status.enabled", lang) : t("status.disabled", lang), r.skills_dir]);
    for (const line of renderTable([t("table.id", lang), t("table.name", lang), t("table.installed", lang), t("table.enabled", lang), t("table.skillsDir", lang)], data, [12, 14, 10, 9, 30])) console.log(line);
  });

agentCmd
  .command("enable <id>")
  .description(t("cmd.agent.enable.desc", preLang))
  .action(async (id: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore } = await loadStores();
    await setAgentEnabled(configStore, id, true);
    console.log(t("msg.agentEnabled", lang, { id }));
  });

agentCmd
  .command("disable <id>")
  .description(t("cmd.agent.disable.desc", preLang))
  .action(async (id: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore } = await loadStores();
    await setAgentEnabled(configStore, id, false);
    console.log(t("msg.agentDisabled", lang, { id }));
  });

agentCmd
  .command("add <id>")
  .description(t("cmd.agent.add.desc", preLang))
  .requiredOption("--skills-dir <path>", "agent skills directory (symlink target)")
  .option("--name <name>", t("cmd.agent.add.option.name", preLang))
  .action(async (id: string, options: { skillsDir: string; name?: string }) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore } = await loadStores();
    const agent = await addAgent(configStore, id, { skillsDir: options.skillsDir, name: options.name });
    console.log(t("msg.agentAdded", lang, { id, path: agent.skills_dir }));
  });

agentCmd
  .command("remove <id>")
  .description(t("cmd.agent.remove.desc", preLang))
  .action(async (id: string) => {
    const lang = (currentLang = await resolveCliLang());
    const { configStore, stateStore } = await loadStores();
    await removeAgent(configStore, stateStore, id);
    console.log(t("msg.agentRemoved", lang, { id }));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // B 类业务错误（bizError，带 code）→ formatError 按 err.<code> 翻译；
  // 其它（含 cli 层 config 缺失 throw、系统错误）→ err.systemPrefix 前缀包裹。
  console.error(formatError(err, currentLang));
  process.exitCode = 1;
});

async function loadStores() {
  const configStore = new ConfigStore();
  const indexStore = new IndexStore(configStore.home);
  const stateStore = new StateStore(configStore.home);
  if (!(await configStore.exists())) throw bizError("CONFIG_NOT_FOUND");
  const config = await configStore.read();
  const index = await indexStore.read();
  const state = await stateStore.read();
  return { configStore, indexStore, stateStore, config, index, state };
}

function printPlan(actions: InstallAction[], hasConflict: boolean, lang: Locale): void {
  console.log(hasConflict ? t("plan.titleConflict", lang) : t("plan.title", lang));
  for (const action of actions) {
    if (action.type === "create-link") console.log(t("plan.createLink", lang, { agent: action.agentId, target: action.targetPath, link: action.linkTarget }));
    else if (action.type === "copy-to-ssot") console.log(t("plan.copyToSsot", lang, { source: action.sourcePath, target: action.targetPath }));
    else if (action.type === "update-state") console.log(t("plan.updateState", lang, { skillName: action.record.skillName }));
    else if (action.type === "remove-link") console.log(t("plan.removeLink", lang, { agent: action.agentId, target: action.targetPath }));
    else if (action.type === "skip") console.log(t("plan.skip", lang, { agent: action.agentId, target: action.targetPath ?? "", reason: action.reason }).trim());
    else if (action.type === "conflict") console.log(t("plan.conflict", lang, { agent: action.agentId, target: action.targetPath, reason: action.reason }).trim());
    else console.log(t("plan.repairBrokenLink", lang, { agent: action.agentId, target: action.targetPath }));
  }
}

function symbol(status: "ok" | "warning" | "error"): string {
  if (status === "ok") return "✓";
  if (status === "warning") return "!";
  return "✗";
}

/** skill list/search 的表格输出；空结果打印 emptyMessage（已由调用方 t() 翻译）。 */
function printSkillLines(skills: readonly SkillRecord[], lang: Locale, emptyMessage: string): void {
  if (!skills.length) {
    console.log(emptyMessage);
    return;
  }
  for (const line of formatSkillRows(skills, lang)) console.log(line);
}
