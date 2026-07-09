# 技术设计 — 跨平台兼容性修复（V2 junction 方案）

> V2 撤销 V1 的 copy 回退，改为 junction(Win) / symlink(POSIX) 统一软连接。

## 1. 架构与边界

改动集中在以下层，**不引入新依赖**（仅 node 内置 `fs`/`Intl`）：

| 层 | 文件 | 改动 |
|---|---|---|
| utils | `src/utils/fs.ts` | `createLink`→`createSymlink`（平台分支 junction/dir，无回退）；新增 `normalizeLinkTarget`；移除 `LinkMethod` |
| utils | `src/utils/safe-path.ts` | `INVALID_SKILL_NAME` 扩展 + 保留名（同 V1，已实现） |
| models | `src/core/models/state.ts` | 移除 `InstalledAgentRecord.syncMethod`（回退 V1） |
| models | `src/core/models/config.ts` | `install_strategy` 还原 `"symlink"`（回退 V1 的 `"auto"\|"symlink"`） |
| models | `src/core/models/install-plan.ts` | `create-link` 移除 `allowFallback`（保留 create-link/remove-link 名） |
| core | `src/core/services/ssot-service.ts` | `samePath` 大小写（同 V1）；`ensure/replaceSymlink` 用 `createSymlink`；readlink 用 `normalizeLinkTarget` |
| core | `src/core/services/install-service.ts` | `applyInstallPlan` 用 `createSymlink`（撤销 method 注入）；`detectInstallation`/`buildPlan` readlink 规范化；撤销 copy 识别 / copy 卸载 |
| core | `src/core/services/skill-service.ts` | `skillUpdate` 还原纯 `ensureSymlinkToSsot`（撤销 re-copy 分支） |
| core | `src/core/storage/config-store.ts` | `createDefaultConfig` 默认还原 `"symlink"` |
| i18n/cli | `i18n/index.ts` + 字典 + `cli/index.ts` | locale + 文案（同 V1，已实现） |

## 2. R1 — 跨平台软连接（junction）

### 2.1 `createSymlink`（utils/fs.ts）

```ts
/**
 * 跨平台创建「source → target」软连接。
 * Windows 用 junction（无需特权，只指目录绝对路径）；POSIX 用 symlink（type 被忽略）。
 * 调用方须保证 targetPath 不存在。失败（路径错误等）原样抛出。
 */
export async function createSymlink(targetPath: string, sourcePath: string): Promise<void> {
  const type: fs.symlink.Type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(sourcePath, targetPath, type);
}
```

- Win junction 无需 `SeCreateSymbolicLinkPrivilege`，自动归一化 target 为绝对路径，只指目录（SSOT 满足）。
- libuv 把 junction 识别为 symlink（`lstat.isSymbolicLink() === true`），`readlink` 可读目标。

### 2.2 `normalizeLinkTarget`（utils/fs.ts）

```ts
/**
 * 规范化 readlink 结果：strip Windows 的 `\\?\` 与 `\\?\UNC\` 前缀。
 * junction / symlink 的 readlink 在 Windows 可能返回带前缀的路径，导致 samePath 误判。
 */
export function normalizeLinkTarget(raw: string): string {
  if (raw.startsWith("\\\\?\\")) return raw.slice(4);
  if (raw.startsWith("\\\\?\\UNC\\")) return "\\" + raw.slice(7);
  return raw;
}
```

- `detectInstallation` / `ensureSymlinkToSsot` / `buildInstallPlan` 读 `readlink` 后先 `normalizeLinkTarget`，再 `path.resolve` / `samePath`。

### 2.3 apply 链路（install-service.ts）

- install-plan action `create-link`（保留名，泛指链接）：`{ type: "create-link"; agentId; targetPath; linkTarget }`（移除 `allowFallback`）。
- `applyInstallPlan` create-link → `await createSymlink(action.targetPath, action.linkTarget)`（无 method 注入，无 `methodByAgent`）。
- `update-state` record 不再填 `syncMethod`。

### 2.4 `detectInstallation`（install-service.ts）

- `isSymbolicLink()` 分支：`const linkTarget = path.resolve(dirname(targetPath), normalizeLinkTarget(await fs.readlink(targetPath)))` → `samePath(linkTarget, expected)` 判 installed/broken-link/external/conflict。
- **撤销 V1 的 copy 目录识别**（`else if isDirectory + syncMethod=copy` 分支移除）→ 还原原逻辑：真实目录 → `external`/`conflict`。

### 2.5 `ensureSymlinkToSsot` / `replaceSymlinkToSsot`（ssot-service.ts）

- `ensureSymlinkToSsot`：target 不存在 → `createSymlink`；存在 symlink → `readlink + normalizeLinkTarget + samePath` 判 ok/conflict。
- `replaceSymlinkToSsot`：`unlink` 旧 + `createSymlink` 重建。
- 二者保持 symlink 专属语义（无 stateStore），Win 下实际创建 junction。

### 2.6 卸载（install-service.ts）

- `buildUninstallPlan` 还原：`isSymbolicLink` → `remove-link`；真实目录 → `conflict`（**撤销 V1 的 copy 三重保护**）。
- `applyUninstallPlan` remove-link → `fs.unlink`（**撤销 `fs.rm` 目录**；junction/symlink 都用 unlink）。

### 2.7 `skillUpdate`（skill-service.ts）

- 还原纯 `ensureSymlinkToSsot` 循环（**撤销 V1 的 `syncMethod === "copy"` re-copy 分支**）。junction/symlink 都是链接，SSOT 更新自动同步。

## 3. R2 — `samePath` 大小写（ssot-service.ts，同 V1）

```ts
export function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "linux" ? a === b : a.toLowerCase() === b.toLowerCase();
}
```

## 4. R3 — skill 名校验（safe-path.ts，同 V1，已实现）

`INVALID_SKILL_NAME` 含 Windows 字符 + `WIN_RESERVED_NAME` + `bizError("INVALID_SKILL_NAME")`；errors.ts + en/zh 字典同步。

## 5. R4 — locale（i18n/index.ts，同 V1，已实现）

`detectIntlLocale()` 插入 LANG 与 macOS 之间。

## 6. 数据流

```
enable:  buildPlan(create-link) → applyInstallPlan(createSymlink: Win junction / POSIX symlink) → detect(installed)
refresh: 纯只读，detect 识别 junction 为 installed（isSymbolicLink + readlink 规范化 + samePath）
uninstall: fs.unlink（junction/symlink 统一）
```

## 7. 兼容性 / 迁移

- **撤销 `syncMethod`**：旧 state 若含 `syncMethod` 字段，`JSON.parse` 多一字段无碍（消费方不读它）。
- **`install_strategy`** 还原 `"symlink"`（V1 的 `"auto"` 回退）。
- **action `create-link`** 保留名（V1 已从 `create-symlink` 改名），移除 `allowFallback`。CLI/i18n `plan.createLink`/`plan.removeLink` 保留。

## 8. 测试策略

vitest，不依赖真机，真实 fs 用 `os.tmpdir()` 隔离：

| 用例 | mock 手段 | 验证 |
|---|---|---|
| `createSymlink` 平台分支 | `Object.defineProperty(process,"platform")` + `vi.spyOn(fs,"symlink")` | Win→`"junction"`，POSIX→`"dir"` |
| `normalizeLinkTarget` | 纯函数 | `\\?\C:\x`→`C:\x`；`\\?\UNC\h\s`→`\\h\s`；无前缀不变 |
| `detectInstallation` junction | mock `safeLstat` 返回 isSymbolicLink + readlink 带 `\\?\` | 规范化后 samePath → installed |
| `samePath` 大小写 | `withPlatform` helper | win32/darwin 不敏感；linux 敏感 |
| `assertSafeSkillName` | 传入 `:`/`CON`/`<` | bizError INVALID_SKILL_NAME |
| `detectSystemLocale` Intl | stubEnv + stubGlobal Intl | zh-CN |

## 9. 风险 / 回滚

- **`readlink` 对 junction 的返回格式** 需 Windows 真机验证；`normalizeLinkTarget` 兜底 `\\?\` 前缀。若真机发现其它格式，扩展规范化。
- **撤销 V1 代码** 涉及多文件回退（state/install-plan/install-service/skill-service/fs），需仔细逐文件核对，避免残留 copy 逻辑。
- 回滚点：`createSymlink` + `normalizeLinkTarget` 独立工具函数；`samePath`/skill 名/locale 已验证。
