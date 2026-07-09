# 实施清单 — 跨平台兼容性修复（V2 junction 方案）

> V2 撤销 V1 copy 回退，改 junction(Win)/symlink(POSIX) 统一软连接。**前置：V1 代码已实现 copy 方案，需回退 copy 相关 + 加 junction。**

## 有序步骤

### Step 1 — models 还原（撤销 V1 copy 模型）
- [ ] `src/core/models/state.ts`：移除 `InstalledAgentRecord.syncMethod`。
- [ ] `src/core/models/config.ts`：`install_strategy` 还原 `"symlink"`（移除 `"auto"|"symlink"`）。
- [ ] `src/core/storage/config-store.ts`：`createDefaultConfig` 默认还原 `"symlink"`。
- [ ] `src/core/models/install-plan.ts`：`create-link` 移除 `allowFallback` 字段。

### Step 2 — utils
- [ ] `src/utils/fs.ts`：`createLink`→`createSymlink`（平台分支 `junction`/`dir`，**移除 `LinkMethod`/copy 回退**）；新增 `normalizeLinkTarget`。
- [ ] `src/utils/safe-path.ts`、`src/core/errors.ts`：V1 已实现（INVALID_SKILL_NAME + 保留名 + bizError），保留。

### Step 3 — ssot-service
- [ ] `samePath`：V1 已实现（平台大小写），保留。
- [ ] `ensureSymlinkToSsot`：target 不存在 → `createSymlink`；readlink 用 `normalizeLinkTarget`。
- [ ] `replaceSymlinkToSsot`：unlink + `createSymlink`。
- [ ] `createInstalledAgentRecord`：移除 `syncMethod` 参数（还原原签名）。

### Step 4 — install-service（核心）
- [ ] `applyInstallPlan`：create-link → `createSymlink`；**移除 `methodByAgent` / method 注入**；update-state 不填 syncMethod。
- [ ] `detectInstallation`：readlink → `normalizeLinkTarget` → path.resolve → samePath；**撤销 copy 目录识别分支**（还原真实目录 external/conflict）。
- [ ] `buildInstallPlan`：create-link 构造移除 `allowFallback`；**撤销 copy skip 分支**。
- [ ] `buildUninstallPlan`：**撤销 copy 三重保护**（还原 isSymbolicLink→remove-link，真实目录→conflict）。
- [ ] `applyUninstallPlan`：remove-link → `fs.unlink`（**撤销 `fs.rm` 目录 + removeRecursive import**）。
- [ ] 移除 `createLink`/`LinkMethod`/`removeRecursive` import（若不再用）。

### Step 5 — skill-service
- [ ] `skillUpdate` 循环：**撤销 `syncMethod === "copy"` re-copy 分支**，还原纯 `ensureSymlinkToSsot`。

### Step 6 — i18n + cli（V1 已实现，保留）
- [ ] `i18n/index.ts` detectIntlLocale、en/zh 字典（INVALID_SKILL_NAME / plan.createLink / plan.removeLink）、cli printPlan（create-link/remove-link）—— 均已实现，无需改。

### Step 7 — 测试（撤销 copy 测试 + 加 junction 测试）
- [ ] `tests/cross-platform.test.ts`：移除 `createLink` 降级测试；改 `createSymlink` 平台分支 + `normalizeLinkTarget` + `detectInstallation` junction（mock readlink 带 `\\?\`）+ 旧 state 兼容（移除 syncMethod 断言）。
- [ ] `tests/install-service.test.ts`：移除 AC2 copy 回退 / AC3 copy detect / copy 卸载三测试；create-symlink 断言改 create-link（无 allowFallback）。
- [ ] `tests/skill-service.test.ts`：移除 AC4 re-copy 测试。
- [ ] `tests/biz-errors.test.ts`：ERR_CODES 数量还原（INVALID_SKILL_NAME 保留，仍 34）。

## 验证命令

```bash
bun run typecheck        # tsc --noEmit
bun run test             # vitest run
bun run src/cli/index.ts doctor    # macOS 本地冒烟
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚策略 |
|---|---|---|
| `src/utils/fs.ts` | createSymlink 平台分支 + normalizeLinkTarget | 独立工具，可单测验证 |
| `src/core/services/install-service.ts` | 撤销 V1 copy 逻辑多处，易残留 | 逐函数核对 + typecheck 把关 |
| `src/core/services/ssot-service.ts` | readlink 规范化点 | detect/ensure/buildPlan 三处统一用 normalizeLinkTarget |
| readlink junction 格式 | 需 Windows 真机验证 | normalizeLinkTarget 兜底 `\\?\` |

## 实现前检查

- [ ] PRD/design/implement（V2）用户已 review
- [ ] typecheck + test 基线（V1 当前绿）确认起点
