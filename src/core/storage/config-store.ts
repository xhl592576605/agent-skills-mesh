import fs from "node:fs/promises";
import path from "node:path";
import type { AgentConfig, AppConfig, SkillOverride, SourceConfig, SourceType } from "../models/config.js";
import { atomicWriteFile, ensureDir, pathExists } from "../../utils/fs.js";
import { getAsmHome } from "../../utils/path.js";

export function createDefaultConfig(): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: {
      home: "~/.agent-skills-mesh",
      repos: "~/.agent-skills-mesh/repos",
      local: "~/.agent-skills-mesh/local",
      cache: "~/.agent-skills-mesh/cache",
      skills: "~/.agent-skills-mesh/skills"
    },
    sources: [],
    agents: {
      claude: { name: "Claude Code", enabled: true, skills_dir: "~/.claude/skills" },
      codex: { name: "Codex", enabled: true, skills_dir: "~/.codex/skills" },
      pi: { name: "Pi", enabled: true, skills_dir: "~/.pi/agent/skills" },
      gemini: { name: "Gemini", enabled: false, skills_dir: "~/.gemini/skills" },
      opencode: { name: "OpenCode", enabled: false, skills_dir: "~/.config/opencode/skills" },
      openclaw: { name: "OpenClaw", enabled: false, skills_dir: "~/.openclaw/skills" },
      hermes: { name: "Hermes", enabled: false, skills_dir: "~/.hermes/skills" },
    },
    skillOverrides: {}
  };
}

export class ConfigStore {
  readonly home: string;
  readonly configPath: string;

  constructor(home = getAsmHome()) {
    this.home = home;
    this.configPath = path.join(home, "config.toml");
  }

  async exists(): Promise<boolean> {
    return pathExists(this.configPath);
  }

  async init(options: { force?: boolean } = {}): Promise<AppConfig> {
    await ensureDir(this.home);
    await Promise.all(["repos", "local", "cache", "skills"].map((name) => ensureDir(path.join(this.home, name))));

    if ((await this.exists()) && !options.force) {
      return this.read();
    }

    const config = createDefaultConfig();
    await fs.writeFile(this.configPath, serializeConfig(config), "utf8");
    const statePath = path.join(this.home, "state.json");
    if (options.force || !(await pathExists(statePath))) {
      await fs.writeFile(statePath, `${JSON.stringify({ version: 1, installedSkills: {} }, null, 2)}\n`, "utf8");
    }
    return config;
  }

  async read(): Promise<AppConfig> {
    const content = await fs.readFile(this.configPath, "utf8");
    return parseConfig(content);
  }

  /** 原子写回 config（读→改→写流程的写出口）。 */
  async write(config: AppConfig): Promise<void> {
    await atomicWriteFile(this.configPath, serializeConfig(config));
  }
}

export function serializeConfig(config: AppConfig): string {
  const lines: string[] = [
    `version = ${config.version}`,
    "",
    "[settings]",
    `install_strategy = ${quote(config.settings.install_strategy)}`,
    `default_agent = ${quote(config.settings.default_agent)}`,
    `auto_refresh_on_start = ${config.settings.auto_refresh_on_start}`,
    "",
    "[paths]",
    `home = ${quote(config.paths.home)}`,
    `repos = ${quote(config.paths.repos)}`,
    `local = ${quote(config.paths.local)}`,
    `cache = ${quote(config.paths.cache)}`,
    `skills = ${quote(config.paths.skills ?? "~/.agent-skills-mesh/skills")}`,
    ""
  ];
  for (const source of config.sources) {
    lines.push("[[sources]]", `id = ${quote(source.id)}`, `name = ${quote(source.name)}`, `type = ${quote(source.type)}`, `path = ${quote(source.path)}`, `enabled = ${source.enabled}`);
    if (source.readonly !== undefined) lines.push(`readonly = ${source.readonly}`);
    if (source.url) lines.push(`url = ${quote(source.url)}`);
    if (source.branch) lines.push(`branch = ${quote(source.branch)}`);
    lines.push("");
  }
  for (const [agentId, agent] of Object.entries(config.agents)) {
    lines.push(`[agents.${agentId}]`, `name = ${quote(agent.name)}`, `enabled = ${agent.enabled}`, `skills_dir = ${quote(agent.skills_dir)}`, "");
  }
  for (const [name, override] of Object.entries(config.skillOverrides)) {
    assertValidOverrideName(name);
    lines.push(`[skill-overrides.${name}]`);
    if (override.managed !== undefined) lines.push(`managed = ${override.managed}`);
    if (override.ignored !== undefined) lines.push(`ignored = ${override.ignored}`);
    if (override.preferredSourceId !== undefined) lines.push(`preferredSourceId = ${quote(override.preferredSourceId)}`);
    if (override.preferredCandidateId !== undefined) lines.push(`preferredCandidateId = ${quote(override.preferredCandidateId)}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function parseConfig(content: string): AppConfig {
  const config = createDefaultConfig();
  config.sources = [];
  config.agents = {};
  let section = "";
  let currentSource: SourceConfig | undefined;
  let currentAgent: [string, AgentConfig] | undefined;
  let currentOverrideName: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[sources]]") {
      currentSource = { id: "", name: "", type: "local-dir", path: "", enabled: true };
      config.sources.push(currentSource);
      section = "sources";
      currentAgent = undefined;
      continue;
    }
    const agentMatch = /^\[agents\.([\w-]+)]$/.exec(line);
    if (agentMatch) {
      currentAgent = [agentMatch[1], { name: agentMatch[1], enabled: true, skills_dir: "" }];
      config.agents[agentMatch[1]] = currentAgent[1];
      section = "agent";
      currentSource = undefined;
      continue;
    }
    const overrideMatch = /^\[skill-overrides\.(.+)]$/.exec(line);
    if (overrideMatch) {
      const name = overrideMatch[1];
      assertValidOverrideName(name);
      currentOverrideName = name;
      config.skillOverrides[name] = {};
      section = "skill-overrides";
      currentSource = undefined;
      currentAgent = undefined;
      continue;
    }
    const sectionMatch = /^\[(\w+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      currentSource = undefined;
      currentAgent = undefined;
      continue;
    }
    const [key, valueRaw] = splitAssignment(line);
    const value = parseValue(valueRaw);
    if (key === "version") config.version = 1;
    else if (section === "settings") (config.settings as Record<string, unknown>)[key] = value;
    else if (section === "paths") (config.paths as Record<string, string>)[key] = String(value);
    else if (section === "sources" && currentSource) (currentSource as unknown as Record<string, unknown>)[key] = key === "type" ? (String(value) as SourceType) : value;
    else if (section === "agent" && currentAgent) (currentAgent[1] as unknown as Record<string, unknown>)[key] = value;
    else if (section === "skill-overrides" && currentOverrideName) applyOverride(config.skillOverrides[currentOverrideName], key, value);
  }
  return config;
}

function assertValidOverrideName(name: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error(`Invalid skill-overrides section name: ${name}`);
}

function applyOverride(override: SkillOverride, key: string, value: string | boolean | number): void {
  if (key === "managed") override.managed = Boolean(value);
  else if (key === "ignored") override.ignored = Boolean(value);
  else if (key === "preferredSourceId") override.preferredSourceId = String(value);
  else if (key === "preferredCandidateId") override.preferredCandidateId = String(value);
}

function splitAssignment(line: string): [string, string] {
  const index = line.indexOf("=");
  if (index === -1) throw new Error(`Invalid TOML assignment: ${line}`);
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseValue(value: string): string | boolean | number {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return value;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
