/**
 * 基准英文字典（design §2.2）。
 *
 * `as const` 使 `TKey` 反推得到精确的字面量联合类型。所有 key 按点分命名空间组织：
 * `err` / `common` / `status` / `btn` / `tab` / `hint` / `help` / `msg` / `plan` /
 * `table` / `info` / `detail` / `inspector` / `search` / `prompt` / `select` /
 * `multiSelect` / `addAgent` / `addSource` / `agentManager` / `skillMd` /
 * `skillDetail` / `skillView` / `sourceView` / `doctorView` / `cmd` / `doctor`。
 *
 * 英文值取自现有 UI 原文（`src/cli/**` 与 `src/tui/**`），动态片段用 `{{name}}` 插值。
 * zh-CN 字典的 key 集合必须与本文件完全一致（由 `tests/i18n.test.ts` 断言）。
 */
export const dict = {
  // === 错误码（B 类业务错误，对应 design §5.2；key = `err.<ErrorCode>`）===
  "err.SKILL_NOT_FOUND": "Skill not found: {{name}}",
  "err.AGENT_NOT_FOUND": "Agent not found: {{id}}",
  "err.NO_INSTALLABLE_CANDIDATE": "No installable candidate for skill: {{name}}",
  "err.INSTALL_PLAN_CONFLICT": "Install plan has conflicts",
  "err.UNINSTALL_PLAN_CONFLICT": "Uninstall plan has conflicts",
  "err.REPAIR_PLAN_CONFLICT": "Repair plan has conflicts",
  "err.REPAIR_TARGET_MISSING": "Repair target does not exist: {{path}}",
  "err.REPAIR_TARGET_NOT_SYMLINK":
    "Repair target is not a symlink (refusing to delete real directory or file): {{path}}",
  "err.SOURCE_NOT_FOUND": "Source skill is missing SKILL.md: {{sourceDir}}",
  "err.INVALID_TOML": "Invalid TOML assignment: {{line}}",
  "err.COPIED_SKILL_INVALID": "Copied skill is invalid (missing SKILL.md): {{tempPath}}",
  "err.SSOT_TARGET_NOT_DIRECTORY": "SSOT target exists and is not a real directory: {{ssotPath}}",
  "err.SSOT_TARGET_EXISTS": "SSOT target already exists: {{ssotPath}}",
  // source-service 业务错误（W1 补齐）
  "err.SOURCE_PATH_NOT_EXIST": "Source path does not exist: {{path}}",
  "err.SOURCE_PATH_NOT_DIRECTORY": "Source path is not a directory: {{path}}",
  "err.SOURCE_ALREADY_REGISTERED": "Source already registered: id={{id}} path={{path}}",
  "err.SOURCE_NOT_SKILL_DIR": "Not a skill directory (missing SKILL.md): {{path}}",
  "err.GIT_REPO_ALREADY_REGISTERED": "Git repo already registered: id={{id}} url={{url}}",
  "err.REPO_TARGET_EXISTS": "Repo target already exists: {{dest}}",
  "err.PURGE_REFUSED_NOT_UNDER_REPOS": "--purge refused: git repo path is not under repos dir: {{path}}",
  "err.SOURCE_ID_EXISTS": "Source id already exists: {{id}}",
  "err.SOURCE_ID_UNKNOWN": "Unknown source id: {{id}}",
  // skill-service 业务错误（W1 补齐）
  "err.SKILL_ALREADY_INSTALLED": "Skill already installed: {{name}}",
  "err.SKILL_NOT_IN_INDEX": "Skill not found in index: {{name}} (run `asm refresh` first)",
  "err.SKILL_NO_CANDIDATE": "No candidate for skill: {{name}}",
  "err.SKILL_MULTIPLE_CANDIDATES": "Multiple candidates for {{name}}: {{sources}}; specify --source <id>",
  "err.SKILL_NOT_INSTALLED": "Skill not installed: {{name}}",
  "err.SOURCE_NOT_PROVIDE_SKILL": "Source {{sourceId}} does not provide skill {{name}}",
  "err.CANDIDATE_NOT_CONFIGURED_SOURCE": "Source {{sourceId}} candidate is not a configured-source",
  // agent-service 业务错误（W1 补齐）
  "err.AGENT_ID_INVALID": "Invalid agent id: {{id}} (allowed: lowercase [a-z0-9-])",
  "err.AGENT_ALREADY_EXISTS": "Agent already exists: {{id}}",
  "err.AGENT_BUILTIN_NO_REMOVE": "Cannot remove builtin agent: {{id}} (disable it via space instead)",
  // C 类系统错误前缀（原始 message 透传）
  "err.systemPrefix": "Operation failed: {{message}}",

  // === 通用词 / 状态词（CLI 表格 cell 与 TUI 复用）===
  "common.none": "none",
  "common.customSuffix": " · custom",
  "common.loading": "Loading...",
  "common.loadingShort": "loading",
  "common.errorShort": "error",
  "common.errorLine": "Error: {{message}}",
  "common.name": "Name",
  "common.esc": "esc",

  // 状态值（表格 STATUS 列、单元格、agent 列表等）
  "status.ok": "ok",
  "status.failed": "failed",
  "status.failedDetail": "failed: {{error}}",
  "status.installed": "installed",
  "status.missing": "missing",
  "status.enabled": "enabled",
  "status.disabled": "disabled",
  "status.upToDate": "up-to-date",
  "status.updatable": "updatable: {{list}}",

  // === 按钮 label（ConfirmDialog 等默认值 + 显式传入）===
  "btn.confirm": "confirm",
  "btn.cancel": "cancel",
  "btn.delete": "delete",
  "btn.remove": "remove",
  "btn.apply": "apply",
  "btn.update": "update",
  "btn.add": "add",
  "btn.fix": "fix",
  "btn.fixAll": "fix all",
  "btn.purge": "purge",
  "btn.ok": "ok",

  // === TUI Tab 标签（App.tsx TABS，含数字前缀）===
  "tab.skill": "1 Skill×Agent",
  "tab.source": "2 Source",
  "tab.doctor": "3 Doctor",

  // === TUI StatusBar hints（App.tsx TAB_HINTS；跨 tab 复用 help/refresh/tabs/moveV）===
  "hint.move": "↑↓←→ move",
  "hint.toggle": "space toggle",
  "hint.rowOn": "a row-on",
  "hint.delete": "d delete",
  "hint.review": "enter review",
  "hint.agents": "m agents",
  "hint.search": "/ search",
  "hint.moveV": "↑↓ move",
  "hint.add": "a add",
  "hint.update": "u update",
  "hint.remove": "d remove",
  "hint.enDis": "e/x en/dis",
  "hint.detail": "enter detail",
  "hint.refresh": "ctrl+r refresh",
  "hint.tabs": "1/2/3 tabs",
  "hint.fix": "f fix",
  "hint.fixAll": "F fix-all",
  "hint.help": "? help",

  // === TUI 帮助弹窗（App.tsx showHelp）===
  "help.title": "Keybindings",
  "help.esc": "esc",
  "help.globalSection": "global",
  "help.globalLine": "1/2/3 tabs · ctrl+r refresh · L lang · ? help · esc/ctrl+c exit",
  "help.skillSection": "skill×agent",
  "help.skillLine":
    "↑↓←→/hjkl move · space toggle · a row-on · d delete · enter review · i info · m agents (space toggle · a add) · / search",
  "help.sourceSection": "source",
  "help.sourceLine": "a add · u update · d remove · e/x enable/disable · enter detail",
  "help.doctorSection": "doctor",
  "help.doctorLine": "f fix selected · F fix all · ↑↓ move",
  "help.close": "esc to close",

  // === CLI console 成功 / 状态消息（cli/index.ts）===
  "msg.initialized": "Initialized {{home}}",
  "msg.refreshed": "Refreshed {{count}} skills",
  "err.CONFIG_NOT_FOUND": "config.toml not found. Run `asm init` first.",
  "msg.tuiRequiresTty": "TUI requires an interactive terminal.",
  "msg.sourceAdded": "Added source {{id}} ({{type}}) -> {{path}}",
  "msg.reboundOrphans": "Rebound orphans: {{list}}",
  "msg.runRefreshToIndex": "Run `asm refresh` to index skills from this source.",
  "msg.noSourcesToUpdate": "No sources to update.",
  "msg.runSkillUpdateToApply":
    "Run `asm skill update <name>` or `asm skill update --all` to apply.",
  "msg.sourceRemovedPurged": "Removed source {{id}} (purged: {{list}})",
  "msg.sourceRemovedOrphaned": "Removed source {{id}} (orphaned: {{list}})",
  "msg.noSourcesConfigured": "No sources configured.",
  "msg.sourceEnabled": "Enabled source {{id}}",
  "msg.sourceDisabled": "Disabled source {{id}}",
  "msg.noSkillsMatching": "No skills matching '{{query}}'",
  "msg.noSkillsIndexed": "No skills indexed. Run `asm refresh` first.",
  "msg.skillAdded": "Added skill {{name}} -> {{path}} (source: {{source}})",
  "msg.noSkillsAdded":
    "No skills added yet. Run `asm skill search` then `asm skill add <name>`.",
  "msg.skillRemoved": "Removed skill {{name}} (SSOT + agent symlinks)",
  "msg.skillRebound": "Rebound skill {{name}} -> source {{source}}",
  "msg.skillEnabledForAgent": "Enabled {{name}} for {{agent}}",
  "msg.skillDisabledForAgent": "Disabled {{name}} for {{agent}}",
  "msg.noAgentsConfigured": "No agents configured.",
  "msg.agentEnabled": "Enabled agent {{id}}",
  "msg.agentDisabled": "Disabled agent {{id}}",
  "msg.agentAdded": "Added agent {{id}} -> {{path}}",
  "msg.agentRemoved":
    "Removed agent {{id}} (detached ASM-managed symlinks; left other files untouched)",
  "msg.allWithName": "--all cannot be combined with a skill name",
  "msg.usageSkillUpdate": "Usage: asm skill update <name|--all>",

  // === CLI install/uninstall 计划输出（cli/index.ts printPlan）===
  "plan.title": "Plan:",
  "plan.titleConflict": "Plan has conflicts:",
  "plan.createSymlink": "- create symlink [{{agent}}] {{target}} -> {{link}}",
  "plan.copyToSsot": "- copy to SSOT {{source}} -> {{target}}",
  "plan.updateState": "- update state {{skillName}}",
  "plan.removeSymlink": "- remove symlink [{{agent}}] {{target}}",
  "plan.skip": "- skip [{{agent}}] {{target}} {{reason}}",
  "plan.conflict": "- conflict [{{agent}}] {{target}} {{reason}}",
  "plan.repairBrokenLink": "- repair-broken-link [{{agent}}] {{target}}",

  // === CLI 表头原子（renderTable headers，组合成行）===
  "table.name": "NAME",
  "table.status": "STATUS",
  "table.sources": "SOURCES",
  "table.source": "SOURCE",
  "table.description": "DESCRIPTION",
  "table.detail": "DETAIL",
  "table.id": "ID",
  "table.type": "TYPE",
  "table.enabled": "ENABLED",
  "table.path": "PATH",
  "table.meta": "META",
  "table.action": "ACTION",
  "table.agents": "AGENTS",
  "table.installed": "INSTALLED",
  "table.skillsDir": "SKILLS_DIR",
  "table.skill": "SKILL",

  // === CLI skill info 详情标签（cli/index.ts skill info）===
  "info.name": "Name",
  "info.status": "Status",
  "info.description": "Description",
  "info.candidates": "Candidates",
  "info.ssot": "SSOT",
  "info.contentHash": "Content hash",
  "info.enabledAgents": "Enabled agents",
  "info.installations": "Installations",
  "info.source": "source",
  "info.path": "path",
  "info.candidateBlock":
    "- {{id}}\n  source: {{source}} ({{type}})\n  path: {{path}}\n  description: {{desc}}",
  "info.installationLine": "- {{agent}}: {{status}} {{target}}",

  // === TUI SkillDetailDialog 标签（前缀含冒号，与 CLI info 区分）===
  "detail.status": "status:",
  "detail.desc": "desc:",
  "detail.candidates": "candidates:",
  "detail.installed": "installed:",
  "detail.ssot": "ssot:",
  "detail.hash": "hash:",
  "detail.agents": "agents:",
  "detail.installations": "installations:",
  "detail.path": "path:",
  "detail.noAgents": "(none)",

  // === TUI Inspector ===
  "inspector.noSkill": "No skill selected.",
  "inspector.noDesc": "(no description)",
  "inspector.summary": "({{name}}) · status: {{status}} · candidates: {{count}}",

  // === TUI SearchBar ===
  "search.label": "search: ",
  "search.placeholder": "(press / to filter skills)",

  // === TUI 输入/选择弹窗 footer ===
  "prompt.footer": "return confirm · backspace delete · esc cancel",
  "select.footer": "↑↓ move · return select · esc cancel",
  "multiSelect.footer": "↑↓ move · space toggle · i view md · return add · esc cancel",

  // === TUI AddAgentDialog（PromptDialog 标题/占位）===
  "addAgent.titleId": "Add agent — id",
  "addAgent.skillsDir": "skills_dir",
  "addAgent.nameOptional": "Name (optional)",
  "addAgent.placeholderId": "lowercase [a-z0-9-]",
  "addAgent.placeholderDir": "agent skills dir (symlink target)",
  "addAgent.placeholderName": "empty = use id",

  // === TUI AddSourceDialog ===
  "addSource.title": "Add source",
  "addSource.placeholder": "git url or local path",

  // === TUI AgentManagerDialog ===
  "agentManager.title": "Agents",
  "agentManager.footer": "space toggle · a add · d remove · esc close",
  "agentManager.enabled": "{{id}} enabled",
  "agentManager.disabled": "{{id}} disabled",
  "agentManager.toggleFail": "toggle failed: {{message}}",
  "agentManager.addFail": "add failed: {{message}}",
  "agentManager.removeFail": "remove failed: {{message}}",
  "agentManager.builtinCannotRemove":
    "{{id}} is builtin, cannot remove (use space to disable)",
  "agentManager.removeTitle": "Remove agent {{id}}?",
  "agentManager.removeMsg": "detach ASM-managed symlinks under {{dir}} + delete config",

  // === TUI SkillMdDialog ===
  "skillMd.readFail": "Failed to read SKILL.md: {{message}}",
  "skillMd.footer": "↑↓ scroll · esc close",

  // === TUI SkillDetailDialog 确认/失败弹窗 ===
  "skillDetail.updateTitle": "Update skill?",
  "skillDetail.updateMsg": "{{name}}\nSSOT -> source latest version",
  "skillDetail.removeTitle": "Remove skill?",
  "skillDetail.removeMsg": "{{name}}\ndelete SSOT + detach all agent symlinks",
  "skillDetail.addTitle": "Add skill to SSOT?",
  "skillDetail.addMsg": "{{name}}\ncopy from source into SSOT",
  "skillDetail.noRebindTitle": "No rebind candidates",
  "skillDetail.noRebindMsg": "{{name}} has no source candidates",
  "skillDetail.rebindSelectTitle": "Rebind to source",
  "skillDetail.updateFailed": "Update failed",
  "skillDetail.removeFailed": "Remove failed",
  "skillDetail.rebindFailed": "Rebind failed",
  "skillDetail.addFailed": "Add failed",
  "skillDetail.footerInstalled": "u update · d remove · b rebind ·",
  "skillDetail.footerAdd": "+ add ·",

  // === TUI SkillAgentView（tab 1）===
  "skillView.deleteTitle": "Delete skill?",
  "skillView.deleteMsg": "{{name}}\ndelete from SSOT + detach all agent symlinks",
  "skillView.deleted": "deleted skill {{name}}",
  "skillView.deleteFail": "delete failed: {{message}}",
  "skillView.applyTitle": "Apply pending changes?",
  "skillView.summaryTotal": "{{installs}} install / {{uninstalls}} uninstall",
  "skillView.summaryRow": "{{skill}}: {{parts}}",
  "skillView.appliedPartial": "applied {{ok}}, {{failed}} failed (kept for retry)",
  "skillView.appliedOk": "applied {{count}} ok",
  "skillView.pressReview": "press r to review {{count}} pending",
  "skillView.skillCount": "{{count}} skill(s)",
  "skillView.someConflicts": "some changes had conflicts — see `asm doctor` or retry",
  "skillView.conflictFallback": "conflict",

  // === TUI SourceView（tab 2）===
  "sourceView.headerId": "id",
  "sourceView.headerType": "type",
  "sourceView.headerEnabled": "enabled",
  "sourceView.headerPathMeta": "path / meta",
  "sourceView.noSource": "no source selected",
  "sourceView.noSources": "No sources. Press `a` to add one.",
  "sourceView.sourceCount": "{{count}} source(s)",
  "sourceView.updateTitle": "Update source?",
  "sourceView.updateMsg": "{{id}} ({{type}})\n{{target}}",
  "sourceView.updateFail": "update failed: {{message}}",
  "sourceView.addOk": "added {{id}} ({{type}})",
  "sourceView.reboundSuffix": " · rebound: {{list}}",
  "sourceView.addFail": "add failed: {{message}}",
  "sourceView.removeTitleKeep": "Remove {{id}}",
  "sourceView.keepSsot": "keep SSOT (orphan skills)",
  "sourceView.keepDesc": "skills remain, become orphan",
  "sourceView.purgeOpt": "purge (cascade delete)",
  "sourceView.purgeDesc": "delete SSOT + agent symlinks",
  "sourceView.confirmRemove": "Remove source?",
  "sourceView.confirmPurge": "Purge-remove source?",
  "sourceView.cascadeDelete": "cascade-delete SSOT + symlinks",
  "sourceView.becomeOrphan": "skills become orphan",
  "sourceView.removedPurged": "removed {{id}} (purged: {{list}})",
  "sourceView.removedOrphaned": "removed {{id}} (orphaned: {{list}})",
  "sourceView.removeFail": "remove failed: {{message}}",
  "sourceView.enabled": "enabled {{id}}",
  "sourceView.disabled": "disabled {{id}}",
  "sourceView.enableFail": "enable failed: {{message}}",
  "sourceView.disableFail": "disable failed: {{message}}",
  "sourceView.noIndexedSkills": "{{id}} has no indexed skills (run update/refresh)",
  "sourceView.skillsTitle": "{{id}} skills",
  "sourceView.addedResult": "added: {{list}}",
  "sourceView.failedSuffix": " · failed: {{list}}",
  "sourceView.noSourcesUpdated": "no sources updated",
  "sourceView.reportLine": "{{sourceId}}: {{detail}}",

  // === TUI DoctorView（tab 3）===
  "doctorView.headerState": "state",
  "doctorView.headerKind": "kind",
  "doctorView.headerMsg": "message · fix",
  "doctorView.running": "Running doctor...",
  "doctorView.fixable": "  [fixable]",
  "doctorView.noFix": "{{kind}}: no auto-fix (manual action needed)",
  "doctorView.fixTitle": "Fix {{kind}}?",
  "doctorView.fixOk": "fixed: {{kind}}",
  "doctorView.fixFail": "fix failed: {{message}}",
  "doctorView.noFixable": "no fixable issues",
  "doctorView.fixAllTitle": "Fix all fixable?",
  "doctorView.fixAllMsg": "{{count}} issue(s): {{kinds}}",
  "doctorView.fixAllResultPartial": "fixed with {{count}} error(s): {{errors}}",
  "doctorView.fixAllResultOk": "fixed {{count}} issue(s)",
  "doctorView.doctorFail": "doctor failed: {{message}}",
  "doctorView.working": "working...",
  "doctorView.statusLine": "{{count}} check(s) · {{errors}} error · {{warns}} warn",
  "doctorView.snapshotNotLoaded": "snapshot not loaded",
  "doctorView.repairConflict": "repair conflict: {{warnings}}",
  "doctorView.unsupportedFix": "unsupported fix type: {{type}}",

  // === doctor 状态文本标签（DoctorView statusLabel，与表格 status 区分）===
  "doctor.statusOk": "ok",
  "doctor.statusWarn": "warn",
  "doctor.statusError": "error",

  // === CLI commander descriptions / options（cli/index.ts）===
  "cmd.program.desc": "Agent Skills Mesh — three-layer skill manager (source / skill / agent)",
  "cmd.lang.option": "language: zh | en | auto (default: auto)",
  "cmd.init.desc": "Initialize Agent Skills Mesh home",
  "cmd.init.option.force": "Overwrite existing config and index",
  "cmd.refresh.desc": "Scan sources and rebuild index",
  "cmd.doctor.desc":
    "Run health checks: external / broken-link / orphan / source-missing / conflict",
  "cmd.tui.desc": "Open interactive TUI",
  "cmd.source.desc": "Source commands: add, update, remove, list, enable, disable",
  "cmd.source.add.desc":
    "Register a source (auto-infers type: url→repo, SKILL.md dir→skill, multi-skill dir→folder)",
  "cmd.source.add.option.type": "repo|folder|skill (auto-inferred if omitted)",
  "cmd.source.add.option.branch": "git branch (for repo)",
  "cmd.source.add.option.id": "custom source id",
  "cmd.source.update.desc":
    "Pull/rescan source(s); report skills with new versions (does NOT update SSOT)",
  "cmd.source.remove.desc":
    "Remove source (default keeps SSOT skills as orphans; --purge cascade-deletes)",
  "cmd.source.remove.option.purge": "cascade-delete SSOT skill + agent symlinks",
  "cmd.source.list.desc": "List configured sources",
  "cmd.source.enable.desc": "Enable a source (refresh will scan it again)",
  "cmd.source.disable.desc": "Disable a source (refresh will skip it)",
  "cmd.skill.desc":
    "Skill commands: search, add, list, info, update, remove, rebind, enable, disable",
  "cmd.skill.search.desc":
    "Search indexable skills (matches name/displayName/description/tags)",
  "cmd.skill.add.desc": "Copy a skill from source into SSOT",
  "cmd.skill.add.option.source":
    "source id (required when multiple sources provide the skill)",
  "cmd.skill.list.desc": "List skills copied into SSOT (installed)",
  "cmd.skill.info.desc": "Show skill details: SSOT path / source / hash / enabled agents",
  "cmd.skill.update.desc": "Update SSOT to source's latest version",
  "cmd.skill.update.option.all": "update all installed managed skills",
  "cmd.skill.remove.desc": "Remove skill from SSOT + detach all agent symlinks",
  "cmd.skill.rebind.desc": "Re-associate an orphan/existing skill with a source",
  "cmd.skill.rebind.option.source": "source id",
  "cmd.skill.enable.desc": "Enable a skill for an agent (SSOT → agent symlink)",
  "cmd.skill.enable.option.agent": "agent id",
  "cmd.skill.disable.desc": "Disable a skill for an agent (remove symlink)",
  "cmd.skill.disable.option.agent": "agent id",
  "cmd.agent.desc": "Agent commands: list, add, remove, enable, disable",
  "cmd.agent.list.desc": "List configured agents with install status",
  "cmd.agent.enable.desc": "Enable an agent (matrix column + symlink target)",
  "cmd.agent.disable.desc": "Disable an agent (hide column, skip symlink)",
  "cmd.agent.add.desc": "Add a custom agent with its skills_dir (then appears in matrix)",
  "cmd.agent.add.option.skillsDir": "agent skills directory (symlink target)",
  "cmd.agent.add.option.name": "display name (defaults to id)",
  "cmd.agent.remove.desc":
    "Remove a custom agent (builtin cannot be removed; disable instead). Detaches only ASM-managed symlinks under its skills_dir, then deletes config.",
} as const;
