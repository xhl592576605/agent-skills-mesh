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
}
