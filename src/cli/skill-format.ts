import type { SkillRecord } from "../core/models/skill.js";

/**
 * `asm skill list` / `asm skill search` 共用的表格行格式（`name\tstatus\tdescription`）。
 *
 * 抽成独立模块而非内联在 `src/cli/index.ts`：后者在模块顶层执行 `cli.parse()`，
 * 无法被测试安全导入。此处为纯函数，便于直接断言 CLI 输出格式而无需子进程。
 */
export function formatSkillRows(skills: readonly SkillRecord[]): string[] {
  return skills.map((item) => `${item.name}\t${item.status}\t${item.description ?? ""}`);
}
