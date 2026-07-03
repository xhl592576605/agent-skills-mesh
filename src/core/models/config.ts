export type SourceType = "git-repo" | "local-dir" | "single-skill" | "global-dir" | "agent-dir";

export interface SourceConfig {
  id: string;
  name: string;
  type: SourceType;
  path: string;
  enabled: boolean;
  readonly?: boolean;
  url?: string;
  branch?: string;
}

export interface AgentConfig {
  name: string;
  enabled: boolean;
  skills_dir: string;
}

/**
 * 用户对单个 skill 的意图（持久化到 config.toml 的 `[skill-overrides.<name>]` 表）。
 * index.json 只保存扫描事实，不再保存意图。
 */
export interface SkillOverride {
  /** prefer / discover adopt 时忽略该 skill，后续 refresh/discover 不再提示。 */
  ignored?: boolean;
  /** adopt 标记：强制该 skill 状态为 managed（跳过 discovered/conflict）。 */
  managed?: boolean;
  /** prefer：为同名多来源 skill 指定消歧 source。 */
  preferredSourceId?: string;
  /** prefer：为同名多来源 skill 指定消歧具体 candidate。 */
  preferredCandidateId?: string;
}

export interface AppConfig {
  version: 1;
  settings: {
    install_strategy: "symlink";
    default_agent: string;
    auto_refresh_on_start: boolean;
  };
  paths: {
    home: string;
    repos: string;
    local: string;
    cache: string;
    skills: string;
  };
  sources: SourceConfig[];
  agents: Record<string, AgentConfig>;
  /** 用户意图层：skill name → override。键名需为 `[a-zA-Z0-9-]`（合法 TOML key）。 */
  skillOverrides: Record<string, SkillOverride>;
}
