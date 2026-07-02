# Directory Structure

> How backend code is organized in this project.

---

## Overview

Agent Skills Mesh is a TypeScript CLI application with a layered backend structure. CLI files should translate command-line input into service calls; services contain use-case logic; scanners inspect skill directories; storage owns TOML/JSON persistence; utilities contain reusable filesystem, path, hash, and git helpers.

---

## Directory Layout

```txt
src/
├── cli/
│   └── index.ts              # cac CLI entrypoint and command wiring
├── core/
│   ├── models/               # Type-only domain contracts
│   ├── scanners/             # Filesystem scanners that produce candidates
│   ├── services/             # Use cases: refresh, install, doctor, etc.
│   └── storage/              # config.toml / index.json persistence
└── utils/                    # Cross-cutting helpers: fs, hash, path, git

tests/                        # Vitest tests for scanners, services, storage
```

---

## Module Organization

- `src/cli/**` should contain command parsing, option defaults, and human-readable output only.
- `src/core/models/**` should define serializable domain contracts such as config, index, skill candidates, installation records, and install plans.
- `src/core/scanners/**` should inspect source directories and return typed records without writing to user directories.
- `src/core/services/**` should implement use cases and enforce safety rules. Prefer pure plan-building functions plus explicit apply functions for filesystem mutations.
- `src/core/storage/**` should be the only layer that knows exact storage file paths such as `config.toml` and `index.json`.
- `src/utils/**` should contain small reusable helpers. Search for existing helpers before adding new ones.

---

## Naming Conventions

- Use kebab-case filenames for modules: `config-store.ts`, `install-service.ts`, `skill-scanner.ts`.
- Use `*-service.ts` for application use cases.
- Use `*-store.ts` for persistence wrappers.
- Use `*-scanner.ts` for filesystem discovery logic.
- Keep model files singular and domain-focused: `skill.ts`, `config.ts`, `installation.ts`.

---

## Examples

### Plan/apply split

```ts
const plan = await buildInstallPlan(config, index, "foo", "pi");
// CLI may print plan or stop for --dry-run here.
await applyInstallPlan(plan);
```

This keeps dry-run behavior reliable and makes mutation rules testable without invoking the CLI.

### Storage path isolation

```ts
const configStore = new ConfigStore(process.env.ASM_HOME);
```

Tests and smoke tests should pass a temp home or set `ASM_HOME` so they never mutate the user's real Agent directories.
