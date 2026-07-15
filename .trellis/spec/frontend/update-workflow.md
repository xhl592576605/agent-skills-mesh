# TUI Update Workflow Contract

> Executable contract for detecting source/skill updates and applying them from the SolidJS + OpenTUI interface.

## 1. Scope / Trigger

Use this contract whenever a TUI change reads or mutates update state for configured sources or installed skills. The flow crosses persisted `state.json`, core services, `DataProvider`, key routing, dialogs, and table/status rendering.

## 2. Signatures

```ts
checkSources(configStore, stateStore, sourceId?): Promise<SourceCheckResult[]>
checkSkillUpdates(configStore, stateStore, sourceId?): Promise<SkillCheckResult[]>
listUpdatableSkillNames(state): string[]
skillUpdate(configStore, stateStore, name): Promise<SkillUpdateReport[]>
```

TUI keys:

- Source tab `u`: pull/rescan the selected source, then re-check that source and its installed skills.
- Skill tab `u`: confirm and update the selected installed skill.
- Skill tab `U`: confirm and update only `listUpdatableSkillNames(state)`.
- Source detail `u`: available only for `[✓]` installed entries.

## 3. Contracts

Persisted optional fields:

```ts
StateFile.sourceSnapshots?: Record<string, SourceSnapshot>
InstalledSkillRecord.sourceHash?: string
```

Derived states:

- Source update: `snapshot.hasUpdate === true && !snapshot.error`.
- Skill update: `sourceHash !== undefined && sourceHash !== contentHash`.
- Missing optional fields mean "not checked", never "has update".
- Update markers use a fixed-width `"* "` / `"  "` slot and `theme.danger`; names and headers must start in the same column.
- Automatic checks run after initial snapshot load and must not block initial rendering.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Old `state.json` lacks update fields | Read successfully; show no false update marker |
| Git fetch/upstream resolution fails | Preserve the prior trustworthy flag, store `error`, continue other checks |
| Source detail `u` on uninstalled item | Do not mutate; show "add first" feedback |
| Skill tab `U` with zero updates | Do not open an apply flow; show "no skills have updates" |
| One item fails during `U` | Continue remaining items and report succeeded/failed counts |
| Repeated `u`/`U` while busy | Ignore duplicate mutation until the current update finishes |

## 5. Good / Base / Bad Cases

- Good: source pull clears the source marker, re-checks installed skills, and exposes any resulting skill markers.
- Base: no update fields exist yet; TUI renders immediately and markers appear only after background checking.
- Bad: calling `skillUpdate("--all")` from `U`; it includes installed records that are not currently marked updatable and may include orphan/manual records.

## 6. Tests Required

- Core: git/local source detection, skill hash comparison, optional-field fallback, stable `listUpdatableSkillNames()` filtering.
- Routing: lowercase `u` invokes one-item update; shifted `U` invokes update-all only.
- Rendering helpers: updated and non-updated rows reserve equal marker width; header/name offsets match.
- Source detail: installed options trigger update; uninstalled options do not.
- Full gate: `bun run typecheck` and `bun run test`.

## 7. Wrong vs Correct

### Wrong

```ts
if (key.name === "U") updateAll()
await skillUpdate(configStore, stateStore, "--all")
```

OpenTUI reports letter names in lowercase with `key.shift`; `--all` is broader than the visible update set.

### Correct

```ts
if (key.name === "u" && key.shift) {
  const names = listUpdatableSkillNames(state)
  for (const name of names) await skillUpdate(configStore, stateStore, name)
}
```
