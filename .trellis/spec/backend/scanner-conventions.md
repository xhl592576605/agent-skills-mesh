# Skill Scanner Conventions

> How `skill-scanner.ts` discovers skills across varied source layouts. Aligned with skills.sh (`vercel-labs/skills`) discovery semantics.

---

## Scope / Trigger

- Trigger: Agent Skills Mesh scanner was upgraded to support nested `skills/<category>/<skill>/SKILL.md` layouts and `.claude-plugin/` plugin manifests.
- Applies to: `src/core/scanners/skill-scanner.ts` and `src/core/scanners/plugin-manifest.ts`.
- Required because configured sources (git repos, local dirs) have unknown layouts, and the scanner must find skills reliably without producing noise.

## Dispatch by Source Type

`scanSource(source)` routes by `source.type`:

| sourceType | Scan path | Rationale |
|---|---|---|
| `git-repo` / `local-dir` / `single-skill` | `discoverSkillDirs` (full priority + plugin + fallback) | Configured source, layout unknown → full discovery |
| `agent-dir` / `global-dir` | `flatScan` (depth-1 only) | Flat install dir (e.g. `~/.claude/skills`); depth-1 matches skills.sh agent-prefix handling, avoids regression |

Candidate-level dedup by resolved path happens inside `scanSource`; skill-level dedup by name happens in `refresh-service.mergeCandidates` (cross-source).

## discoverSkillDirs Strategy (configured sources)

1. **Root is a skill** — if `<root>/SKILL.md` exists, return `[root]` (aligns skills.sh non-fullDepth early return).
2. **Priority dirs, in order**: `root` → `skills/` → `skills/.curated` → `skills/.experimental` → `skills/.system` → plugin manifest paths.
3. **Depth-1 set** = `root` + plugin manifest paths. Root stays depth-1 to avoid `examples/foo/SKILL.md` noise; plugin paths already point at skill parent dirs.
4. **Container dirs** (`skills/`, `.curated`, etc.) walk **depth-2** to support `skills/<category>/<skill>/SKILL.md`.
5. **No descent past a SKILL.md** — a child that contains `SKILL.md` is collected and its grandchildren are never scanned.
6. **SKIP_DIRS** = `node_modules`, `.git`, `dist`, `build`, `__pycache__`.
7. **Fallback** — if priority yields 0 candidates, recursive scan `maxDepth=5` (collect on SKILL.md, do not descend past, SKIP_DIRS-filtered).
8. **Dedup** — candidate-level by resolved path (within a source); skill-level by name via `mergeCandidates` (cross-source).

## Plugin Manifest (`.claude-plugin/`)

`getPluginSkillPaths(root)`:

- Reads `marketplace.json` (multi-plugin catalog) then `plugin.json` (root single plugin).
- `skill` / `source` / `pluginRoot` paths **must start with `./`** (Claude Code convention); `isContainedIn` blocks `..` and absolute-path escape.
- Remote sources (`{ source, repo }` objects) are skipped; only local string `source` values are resolved.
- Returns skill **parent dirs** plus the conventional `skills/` dir of each plugin base; the priority walk finds the actual `SKILL.md`.

## Compatibility

- `SkillCandidate` / `SkillRecord` models are unchanged; `scanSource` signature is unchanged → `refresh` / `merge` / `install` / TUI are unaffected.
- depth-2 is a **superset** of the prior depth-1 behavior → no regression for existing flat layouts.

## Tests Required (scanner)

- `path/SKILL.md`, `path/*/SKILL.md`, `path/skills/*/SKILL.md` (existing, preserved).
- `path/skills/<category>/<skill>/SKILL.md` (depth-2).
- `examples/<x>/SKILL.md` under a discovered skill is **not** surfaced (no-descent).
- `node_modules` / `.git` / `dist` / `build` / `__pycache__` skipped.
- `.claude-plugin/plugin.json` declared skills discovered; skill paths missing `./` prefix ignored.
- Fallback recursive discovery (≤5 levels) when no priority dir matches.
- `agent-dir` source stays depth-1.

## Forbidden Patterns

- Do not descend into a directory that already contains `SKILL.md` (produces duplicate/noise candidates).
- Do not add filesystem writes to the scanner; it only reads and returns typed candidates.
- Do not surface `SKILL.md` files inside ignored dirs (`node_modules`, `.git`, etc.).
- Do not trust plugin manifest paths without `./` prefix and `isContainedIn` validation (path traversal).
