import { constants } from "node:fs";
import fs from "node:fs/promises";
import type { AppConfig } from "../models/config.js";
import type { IndexFile } from "../models/index.js";
import { ConfigStore } from "../storage/config-store.js";
import { IndexStore } from "../storage/index-store.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";

/** 一键修复动作（「哪些可修复」的知识留在 service 层，UI 只按 fix.type 调度）。 */
export interface DoctorFix {
  type: "refresh-index" | "mkdir-agent-dir" | "repair-broken-link";
  /** repair-broken-link 用。 */
  skillName?: string;
  /** repair-broken-link / mkdir-agent-dir 用。 */
  agentId?: string;
  /** mkdir / repair 用。 */
  targetPath?: string;
}

export interface DoctorCheck {
  status: "ok" | "warning" | "error";
  kind: string;
  message: string;
  /** 存在则该检查项可一键修复。 */
  fix?: DoctorFix;
}

export async function runDoctor(configStore: ConfigStore, indexStore: IndexStore, config?: AppConfig, index?: IndexFile): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push((await configStore.exists()) ? ok("config", `config exists: ${configStore.configPath}`) : error("config", `config missing: ${configStore.configPath}`));
  checks.push(
    (await indexStore.exists())
      ? ok("index", `index exists: ${indexStore.indexPath}`)
      : error("index", `index missing: ${indexStore.indexPath}`, { type: "refresh-index" })
  );
  if (!config) return checks;
  for (const source of config.sources) {
    const sourcePath = resolveConfiguredPath(source.path);
    checks.push((await pathExists(sourcePath)) ? ok("source", `source reachable: ${source.id}`) : warn("source", `source missing: ${source.id} (${sourcePath})`));
  }
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (!agent.enabled) {
      checks.push(warn("agent-dir", `agent disabled: ${agentId}`));
      continue;
    }
    const dir = resolveConfiguredPath(agent.skills_dir);
    if (!(await pathExists(dir))) {
      checks.push(warn("agent-dir", `agent skills_dir missing: ${agentId} (${dir})`, { type: "mkdir-agent-dir", agentId, targetPath: dir }));
      continue;
    }
    try {
      await fs.access(dir, constants.W_OK);
      checks.push(ok("agent-dir", `agent skills_dir writable: ${agentId}`));
    } catch {
      checks.push(error("agent-dir", `agent skills_dir not writable: ${agentId} (${dir})`));
    }
  }
  if (index) {
    // index.issues 已含 orphan / installed-source-missing / broken-link / conflict（refresh 时派生）。
    // index.issues 已含 orphan / installed-source-missing / broken-link / conflict（refresh 时派生）。
    // severity 映射：error→error、info→ok（降级避免噪音；info 当前不产出，预留）、warning→warn。
    for (const issue of index.issues) {
      let fix: DoctorFix | undefined;
      if (issue.kind === "broken-link") {
        const installation = index.installations[issue.ref ?? ""];
        if (installation) fix = { type: "repair-broken-link", skillName: installation.skillName, agentId: installation.agentId, targetPath: installation.targetPath };
      }
      if (issue.severity === "error") checks.push(error(issue.kind, issue.message, fix));
      else if (issue.severity === "info") checks.push(ok(issue.kind, issue.message));
      else checks.push(warn(issue.kind, issue.message, fix));
    }
    // external（agent 目录真实目录 / 外部 symlink）不进入 issues，单独报告。
    for (const installation of Object.values(index.installations)) {
      if (installation.status === "external") checks.push(warn("external", `external skill: ${installation.targetPath}${installation.reason ? ` (${installation.reason})` : ""}`));
    }
  }
  return checks;
}

const ok = (kind: string, message: string, fix?: DoctorFix): DoctorCheck => ({ status: "ok", kind, message, ...(fix ? { fix } : {}) });
const warn = (kind: string, message: string, fix?: DoctorFix): DoctorCheck => ({ status: "warning", kind, message, ...(fix ? { fix } : {}) });
const error = (kind: string, message: string, fix?: DoctorFix): DoctorCheck => ({ status: "error", kind, message, ...(fix ? { fix } : {}) });
