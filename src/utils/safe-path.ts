import path from "node:path";

const INVALID_SKILL_NAME = /[\\/\p{White_Space}\p{Cc}\p{Cf}]/u;

export function assertSafeSkillName(skillName: string): void {
  if (!skillName) throw new Error(`Invalid skill name: ${JSON.stringify(skillName)}`);
  if (skillName === "." || skillName === "..") throw new Error(`Invalid skill name: ${skillName}`);
  if (INVALID_SKILL_NAME.test(skillName)) throw new Error(`Invalid skill name: ${JSON.stringify(skillName)}`);
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
