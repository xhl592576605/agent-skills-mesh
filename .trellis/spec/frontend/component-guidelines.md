# Component Guidelines

> SolidJS + OpenTUI component conventions for `src/tui/**`.

---

## Current State

TUI components live under `src/tui/components/`, `src/tui/dialogs/`, and
`src/tui/views/`. They render OpenTUI primitives (`<box>`, `<text>`) and consume
typed data from core services via Solid Context (`useData`, `useTheme`,
`useDialog`, `useViewKey`).

Core service outputs consumed by components:

- `DoctorCheck[]` / `DoctorFix` from `src/core/services/doctor-service.ts` →
  `DoctorView`.
- `InstallPlan` / `UninstallPlan` / repair plans from
  `src/core/services/install-service.ts` → dialogs + views after confirmation.
- `IndexFile.skills` / `IndexFile.installations` from
  `src/core/models/index.ts` → `Matrix` via `projection.ts`.
- `AppConfig` / `StateFile` snapshot from `ConfigStore` / `StateStore` →
  `DataProvider`.

---

## Primitives

OpenTUI exposes layout primitives, not DOM elements:

- `<box>` — flex container. Common props: `flexDirection` (`"row"` | `"column"`),
  `flexGrow`, `width`, `height`, `paddingLeft/Right/Top/Bottom`, `left`, `top`,
  `position` (`"absolute"` for overlays), `zIndex`, `backgroundColor` (RGBA),
  `alignItems`, `justifyContent`, `gap`, `onMouseUp`.
- `<text>` — inline text. Common props: `fg` (RGBA), `bg`, `width`, `wrapMode`
  (`"none"` to clip), `attributes` (`TextAttributes.BOLD`).

Colors are `RGBA` instances from `@opentui/core` (`RGBA.fromHex`,
`RGBA.fromInts`). Read them from `useTheme()`, never hardcode hex in components.

Dimensions come from `useTerminalDimensions()`, which returns an **accessor**:
call it as `dim().width`, not `dim.width`.

---

## Component Structure

Components are kept small, typed, and close to pure render. Patterns observed
in the real tree:

- `Matrix.tsx` is a **pure render component**: all state (cursor, pending,
  scroll) arrives via the `matrix: MatrixState` prop; the component only maps
  state to rows/labels/cursor highlight.
- `Dialog.tsx` is the **base overlay** used by every modal: `position="absolute"`
  + `zIndex={3000}` + a translucent `theme.overlay` background that fills the
  terminal; the inner panel is centered. Clicking the outer mask calls
  `onClose`; clicking the inner panel calls `event.stopPropagation()`.
- `ConfirmDialog.tsx` / `SelectDialog.tsx` / `PromptDialog.tsx` render inside
  `Dialog` and expose a static `show(dialog, ...)` that returns a `Promise`
  resolved by their `onConfirm`/`onCancel`/`onClose` paths.

Prefer this layered shape for new modals: base `Dialog` (overlay mechanics) +
content component (focus/keys) + `show()` helper returning a typed `Promise`.

---

## Props Conventions

- Use explicit TypeScript interfaces for props (`MatrixProps`, `DialogProps`,
  `ConfirmDialogProps`). Reuse core model types (`SkillRecord`,
  `InstallationRecord`, `DoctorCheck`) instead of redefining UI copies.
- Props that come from loaded snapshot are treated as readonly data; mutations
  happen through services after confirmation, then the snapshot is refreshed.
- Callbacks express **user intent** (`onConfirm`, `onCancel`, `onClose`,
  `onReview`); they must not perform filesystem writes directly. The component's
  caller routes intent to a core service.
- `StatusBar` accepts a `hints: readonly string[]` prop (per-tab key hints) per
  the cross-child contract — extenders inject hints, they do not restructure the
  component.

---

## Element Factories and Owner Context (critical)

SolidJS resolves context via the **owner** in which JSX is created. OpenTUI's
`useKeyboard` and event handlers run outside the component's owner, so creating
JSX that calls `useDialog`/`useTheme` inside such a callback loses the provider
and throws.

The dialog stack solves this by storing each dialog as a **factory function**
`element: () => JSX.Element` and calling it inside the `DialogProvider`'s render
context (correct owner). This pattern comes from the reference dialog
implementation.

```ts
// dialogs/ConfirmDialog.tsx (show): pass a factory, not a pre-built element
dialog.replace(
  () => <ConfirmDialog title={title} message={message} onConfirm={...} />,
  () => resolve(false)   // onClose → resolve(false)
)
```

Rules:

- When you need deferred JSX that touches context, store `() => JSX.Element`
  and render it inside a `<Show>` in the provider that owns the context.
- Never call `useContext`-based hooks (`useDialog`, `useTheme`, `useData`)
  inside `useKeyboard` callbacks or async functions; capture their values in the
  component body first, then close over the captured value.

---

## Styling and Symbols

- Use OpenTUI layout + RGBA theme tokens only. No CSS, no browser styling libs.
- Keep status indicators readable **without color** — always pair color with a
  text/symbol label. Matrix cell labels: `[on]` / `[off]` / `[+]` (pending
  install) / `[-]` (pending uninstall) / `[!]` (warning) / `—` (disabled).
- Doctor status: `ok` / `warn` / `error` text labels paired with
  `theme.success` / `theme.warning` / `theme.danger`.

---

## Common Mistakes

- Do not put scanning, install, repair, or doctor logic inside components —
  call the core service and read its typed result.
- Do not bypass `buildInstallPlan()` / `buildRepairPlan()` from UI actions;
  always confirm via a dialog, then apply the returned plan.
- Do not create context-consuming JSX inside `useKeyboard`/event/async callbacks
  — use an element factory rendered in the provider's owner (see above).
- Do not hardcode `RGBA.fromHex(...)` in components; read tokens from
  `useTheme()`.
- Do not introduce browser primitives (`div`, `span`, DOM events).
