# Backend Development Guidelines

> Backend and CLI development guidance for Agent Skills Mesh.

---

## Overview

Agent Skills Mesh is a TypeScript Node.js CLI. Its backend is the local command, service, scanner, storage, model, and filesystem code under `src/**`. There is no HTTP server and no database layer today; persistence is local TOML/JSON under the ASM home directory.

Use these guidelines when changing:

- CLI command wiring in `src/cli/index.ts`.
- Domain models in `src/core/models/**`.
- Scanners in `src/core/scanners/**`.
- Services in `src/core/services/**`.
- Storage in `src/core/storage/**`.
- Cross-cutting utilities in `src/utils/**`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Current TypeScript CLI module organization and naming | Active |
| [Database Guidelines](./database-guidelines.md) | Current no-database state, TOML/JSON persistence, and future database constraints | Active |
| [Error Handling](./error-handling.md) | CLI errors, typed domain statuses, filesystem absence handling | Active |
| [Quality Guidelines](./quality-guidelines.md) | Safety contracts for storage, symlinks, tests, and reviews | Active |
| [Logging Guidelines](./logging-guidelines.md) | Current CLI output conventions and no-logger boundary | Active |
| [Scanner Conventions](./scanner-conventions.md) | skill-scanner discovery: priority dirs, depth-2 nesting, no-descent, SKIP_DIRS, plugin manifest, fallback | Active |

---

## Core Local Pattern

Follow the existing flow demonstrated by `src/cli/index.ts`, `src/core/services/refresh-service.ts`, and `src/core/services/install-service.ts`:

1. CLI reads config/index through stores.
2. Services receive typed inputs and return typed outputs or plans.
3. CLI formats human-readable output.
4. Apply functions perform explicit filesystem mutations only after conflicts are checked.

---

**Language**: All documentation in this spec directory is written in **English**.
