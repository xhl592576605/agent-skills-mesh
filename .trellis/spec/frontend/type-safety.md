# Type Safety

> Type safety patterns for frontend-adjacent and future TUI code.

---

## Current State

The project uses strict TypeScript for the CLI/core code and has no implemented frontend. Future TUI code should follow the same TypeScript conventions instead of creating separate untyped UI models.

Evidence:

- `tsconfig.json` enables `strict`, `moduleResolution: "NodeNext"`, and `forceConsistentCasingInFileNames`.
- Domain contracts live in `src/core/models/**`.
- Services use explicit imported types, for example `src/core/services/install-service.ts` imports `AppConfig`, `IndexFile`, `InstallationRecord`, `InstallAction`, `InstallPlan`, `UninstallPlan`, `SkillCandidate`, and `SkillRecord`.

---

## Type Organization

Use existing core types as the source of truth:

- Config and agents: `src/core/models/config.ts`.
- Index and issues: `src/core/models/index.ts`.
- Skills and candidates: `src/core/models/skill.ts`.
- Install records: `src/core/models/installation.ts`.
- Install plans/actions: `src/core/models/install-plan.ts`.

Future TUI-specific types should stay close to the UI feature only when they describe display state, not domain data. For example, a selected row id can be a TUI type, but a skill candidate should use `SkillCandidate`.

---

## Validation

There is no runtime validation library today. The current code uses lightweight parsing and TypeScript types:

- `src/core/storage/config-store.ts` parses simple TOML-like assignments into `AppConfig`.
- `src/core/scanners/skill-scanner.ts` narrows `gray-matter` frontmatter values with `typeof` and `Array.isArray` checks.
- `src/core/storage/index-store.ts` casts parsed JSON to `IndexFile`; there is no schema validation yet.

If future UI accepts user-edited config values, validate at the boundary before calling core services. Do not rely on React props alone for filesystem paths or agent ids.

---

## Common Patterns

- Use discriminated unions for action/status handling, as in `InstallAction` and installation status types.
- Use explicit function return types for exported service/storage functions.
- Preserve ESM import extensions (`.js`) in TypeScript source, matching current files such as `src/cli/index.ts`.
- Prefer typed service outputs over parsing CLI text in tests or UI.

---

## Forbidden Patterns

- Do not duplicate core model types in future TUI code.
- Do not use `any` for plan actions, skill records, or config values when a model type exists.
- Do not cast untrusted user input directly to `AgentConfig`, `SourceConfig`, or `InstallAction` without validation.
- Do not introduce browser-only types for the planned Ink TUI unless a real Web frontend is added.
