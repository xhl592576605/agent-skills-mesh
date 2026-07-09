import path from "node:path";
import { bizError } from "../core/errors.js";

/**
 * skill 名非法字符：路径分隔符、空白、控制/格式字符，以及 Windows 文件系统保留字符
 * `< > : " | ? *`。跨平台统一按最严格（Windows）规则校验，保证 SSOT 目录名在任一平台合法。
 */
const INVALID_SKILL_NAME = /[\\/\p{White_Space}\p{Cc}\p{Cf}<>:"|?*]/u;

/** Windows 保留设备名（大小写不敏感），不可作为目录名。 */
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function assertSafeSkillName(skillName: string): void {
  if (!skillName || skillName === "." || skillName === ".." || WIN_RESERVED_NAME.test(skillName) || INVALID_SKILL_NAME.test(skillName)) {
    throw bizError("INVALID_SKILL_NAME", { name: skillName }, `Invalid skill name: ${JSON.stringify(skillName)}`);
  }
}

export function assertPathInside(root: string, target: string, label = "path"): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`${label} escapes root: ${resolvedTarget}`);
}

export function safeJoin(root: string, childName: string, label = "path"): string {
  assertSafeSkillName(childName);
  const target = path.join(root, childName);
  assertPathInside(root, target, label);
  return target;
}
