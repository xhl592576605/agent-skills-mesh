# Agent Skills Mesh Technical Design

## Architecture Overview

Agent Skills Mesh 采用分层架构：

```txt
CLI / TUI
  ↓
Application Services
  ↓
Core Domain Models
  ↓
Storage Layer
  ↓
File System / Git
```

- CLI/TUI 只负责交互和展示。
- Application Services 负责 source、skill、refresh、install、doctor 等用例。
- Core Domain Models 负责 Source、Skill、Candidate、Agent、Installation、Issue 等抽象。
- Storage Layer 负责 `config.toml`、`index.json`、`state.json` 的读写。
- File System / Git 层负责扫描目录、创建 symlink、clone/pull repo。

## Storage Design

### User Home

```txt
~/.agent-skills-mesh/
  config.toml
  index.json
  state.json
  repos/
  local/
  cache/
```

### `config.toml`

保存用户显式意图，不保存扫描事实。

```toml
version = 1

[settings]
install_strategy = "symlink"
default_agent = "pi"
auto_refresh_on_start = true

[paths]
home = "~/.agent-skills-mesh"
repos = "~/.agent-skills-mesh/repos"
local = "~/.agent-skills-mesh/local"
cache = "~/.agent-skills-mesh/cache"

[[sources]]
id = "global-agents-skills"
name = "Global Agents Skills"
type = "global-dir"
path = "~/.agents/skills"
enabled = true
readonly = false

[agents.claude]
name = "Claude Code"
enabled = true
skills_dir = "~/.claude/skills"

[agents.codex]
name = "Codex"
enabled = true
skills_dir = "~/.codex/skills"

[agents.pi]
name = "Pi"
enabled = true
skills_dir = "~/.pi/agent/skills"

[agents.gemini]
name = "Gemini"
enabled = false
skills_dir = "~/.gemini/skills"
```

### `index.json`

保存 `refresh` 后的当前事实。

```json
{
  "version": 1,
  "updatedAt": "2026-07-02T00:00:00.000Z",
  "sources": {},
  "skills": {},
  "installations": {},
  "issues": []
}
```

MVP 采用 JSON，写入时使用临时文件 + rename 的原子写策略，避免异常中断导致索引损坏。

## Domain Models

### Source

```ts
export type SourceType =
  | "git-repo"
  | "local-dir"
  | "single-skill"
  | "global-dir"
  | "agent-dir";

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
```

### SkillCandidate

具体的 Skill 来源实例。同名 Skill 可以有多个 candidate。

```ts
export interface SkillCandidate {
  id: string;
  skillName: string;
  sourceId: string;
  sourceType: SourceType;
  path: string;
  entry: "SKILL.md";
  description?: string;
  frontmatter?: Record<string, unknown>;
  tags: string[];
  hash: string;
  mtimeMs: number;
  size: number;
  origin:
    | "configured-source"
    | "global-dir"
    | "agent-dir"
    | "manual-add"
    | "manual-import";
  managed: boolean;
}
```

### SkillRecord

```ts
export interface SkillRecord {
  name: string;
  displayName: string;
  description?: string;
  tags: string[];
  status: "managed" | "discovered" | "conflict" | "ignored" | "missing";
  preferredCandidateId?: string;
  preferredSourceId?: string;
  candidates: SkillCandidate[];
  supportedAgents?: string[];
  ignored?: boolean;
}
```

### InstallationRecord

```ts
export interface InstallationRecord {
  id: string;
  skillName: string;
  agentId: string;
  status:
    | "installed"
    | "available"
    | "unsupported"
    | "conflict"
    | "broken-link"
    | "external"
    | "missing";
  targetPath: string;
  linkTarget?: string;
  expectedLinkTarget?: string;
  installedCandidateId?: string;
  reason?: string;
}
```

## Scanner Design

### Supported Structures

```txt
repo/skills/foo/SKILL.md
repo/foo/SKILL.md
single-skill/SKILL.md
~/.agents/skills/foo/SKILL.md
~/.pi/agent/skills/foo/SKILL.md
```

### `scanSource(source)` Algorithm

```txt
if source.path/SKILL.md exists:
  treat source.path as single skill
else:
  scan source.path/*/SKILL.md
  if source.path/skills exists:
    scan source.path/skills/*/SKILL.md
```

Name priority:

```txt
1. SKILL.md frontmatter.name
2. directory name
```

Description priority:

```txt
1. SKILL.md frontmatter.description
2. empty
```

## Refresh Algorithm

```txt
1. Load config.toml
2. Load previous index.json
3. Scan enabled configured sources
4. Scan global dirs such as ~/.agents/skills
5. Scan each enabled Agent skills_dir as agent-dir source
6. Parse SKILL.md frontmatter
7. Compute candidate hash, mtime, size
8. Group candidates by skillName
9. Merge to SkillRecord
10. Detect conflict / discovered / managed / ignored / missing
11. Detect installations for each skill + agent
12. Generate issues
13. Atomically write index.json
```

### Skill Status

```txt
ignored:
  if ignored by user

missing:
  if previously tracked but no candidates remain

conflict:
  if candidates.length > 1 and no preferredCandidateId/source

discovered:
  if all candidates come from global-dir or agent-dir and are not explicitly managed

managed:
  otherwise
```

## Installation Detection

For each `skill + agent`:

```txt
targetPath = agent.skillsDir / skillName
```

Rules:

```txt
target does not exist:
  available

target is symlink:
  linkTarget exists and points to preferred candidate: installed
  linkTarget missing: broken-link
  linkTarget points to another candidate: conflict
  linkTarget points to unknown location: external

target is real directory:
  contains SKILL.md: external
  otherwise: conflict

agent unsupported:
  unsupported
```

## Install Plan

All install/uninstall operations generate a plan before applying changes.

```ts
export interface InstallPlan {
  id: string;
  skillName: string;
  sourceCandidateId: string;
  sourcePath: string;
  actions: InstallAction[];
  hasConflict: boolean;
  warnings: string[];
}
```

```ts
export type InstallAction =
  | {
      type: "create-symlink";
      agentId: string;
      targetPath: string;
      linkTarget: string;
    }
  | {
      type: "skip";
      agentId: string;
      reason: string;
    }
  | {
      type: "conflict";
      agentId: string;
      targetPath: string;
      reason: string;
    }
  | {
      type: "repair-broken-link";
      agentId: string;
      targetPath: string;
      oldTarget: string;
      newTarget: string;
    };
```

Install rules:

```txt
target missing: create-symlink
target same symlink: skip
target broken symlink: repair-broken-link or conflict depending options
target different symlink: conflict
target real directory: conflict
multiple candidates without preference: conflict requiring --source or skill prefer
```

## CLI Design

First round CLI closure:

```txt
asm init
asm refresh
asm skill list
asm skill info <name>
asm install <skill> --agent <agent> --dry-run
asm install <skill> --agent <agent>
asm uninstall <skill> --agent <agent>
asm doctor
```

Full MVP command tree:

```txt
asm
├── init
├── refresh
├── doctor
├── discover
├── source
│   ├── list
│   ├── add <path>
│   ├── add-repo <git-url>
│   ├── sync [id]
│   ├── remove <id>
│   ├── enable <id>
│   └── disable <id>
├── skill
│   ├── list
│   ├── search <keyword>
│   ├── info <name>
│   ├── add <path>
│   ├── import <path>
│   └── prefer <name> --source <source-id>
├── install <skill>
└── uninstall <skill>
```

## TUI Design

TUI 只操作 pending plan，不直接改文件系统。

### State Machine

```txt
Idle
 ↓
SelectingSkill
 ↓
EditingMatrix
 ↓
PendingPlan
 ↓
ReviewPlan
 ↓
Applying
 ↓
RefreshIndex
 ↓
Idle
```

### MVP Screens

- Matrix：Skill × Agent 状态矩阵。
- Discover：外部发现、断链、冲突、未托管 Skill。
- Doctor：配置、索引、目录、symlink、冲突检查。

Matrix symbols:

```txt
✓ installed
○ available
× unsupported
! conflict
~ pending
```

## Project Source Layout

```txt
src/
  cli/
    index.ts
    commands/
      init.ts
      refresh.ts
      install.ts
      uninstall.ts
      skill.ts
      source.ts
      doctor.ts
  core/
    models/
      source.ts
      skill.ts
      agent.ts
      installation.ts
      install-plan.ts
      index.ts
      config.ts
    services/
      refresh-service.ts
      source-service.ts
      skill-service.ts
      install-service.ts
      doctor-service.ts
    scanners/
      skill-scanner.ts
      agent-dir-scanner.ts
      repo-scanner.ts
    storage/
      config-store.ts
      index-store.ts
  tui/
    App.tsx
    screens/
      MatrixScreen.tsx
      DiscoverScreen.tsx
      DoctorScreen.tsx
    components/
      Layout.tsx
      SkillInspector.tsx
      InstallPlanModal.tsx
  utils/
    fs.ts
    git.ts
    hash.ts
    path.ts
```

## Trade-offs

- JSON index instead of SQLite：降低 MVP 复杂度，但大规模仓库搜索性能较弱；后续可迁移。
- symlink-only install：符合用户偏好，便于 repo 更新后自动生效；需要对断链、覆盖真实目录做严格保护。
- Source 抽象而不是 Repo 抽象：可以覆盖仓库、单 Skill、全局目录和 Agent 原生目录，避免过早绑定到 Git 仓库模型。
- TUI 第二阶段实现：先验证 CLI 和数据模型，避免 UI 早期拖慢核心闭环。

## Rollback / Safety

- 所有写操作先生成 plan。
- 默认不覆盖真实目录。
- uninstall 默认只删除 symlink。
- index 写入使用原子写。
- Git repo sync 不自动删除用户未跟踪文件。
- `--force` 行为必须显式且可审计，MVP 可暂缓。
