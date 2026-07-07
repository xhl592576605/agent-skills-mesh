import { renderTable } from "./columns.js";
import { t, type Locale } from "../i18n/index.js";
import type { SkillRecord } from "../core/models/skill.js";
import type { InstalledSkillRow } from "../core/services/skill-service.js";

/**
 * `asm skill search` 的表格输出（task 07-06-cli-tui-bugfix · R2）：
 * NAME / STATUS / SOURCES / DESCRIPTION，固定列宽 + 表头，CJK 双宽对齐、长字段截断。
 * 空结果由调用侧（`printSkillLines`）打印 emptyMessage。
 *
 * 表头走 i18n 字典（`table.*`）；列宽固定（中文表头更窄不会溢出，仅左侧多空格）。
 *
 * 抽成独立模块而非内联 `src/cli/index.ts`：后者在模块顶层执行 `cli.parseAsync()`，
 * 无法被测试安全导入。此处为纯函数，便于直接断言 CLI 输出格式而无需子进程。
 */
export function formatSkillRows(skills: readonly SkillRecord[], lang: Locale): string[] {
  const rows = skills.map((item) => [
    item.name,
    item.status,
    // 多来源候选去重拼接；无来源（如 manual）显示 —。
    Array.from(new Set(item.candidates.map((c) => c.sourceId))).join(",") || "—",
    item.description ?? "",
  ]);
  return renderTable(
    [t("table.name", lang), t("table.status", lang), t("table.sources", lang), t("table.description", lang)],
    rows,
    [24, 11, 18, 48],
  );
}

/**
 * `asm skill list` 的表格输出（R1）：只列已 add 到 SSOT 的技能。
 * NAME / STATUS / SOURCE / AGENTS / DESCRIPTION，固定列宽 + 表头（走 i18n 字典）。
 */
export function formatInstalledRows(rows: readonly InstalledSkillRow[], lang: Locale): string[] {
  const data = rows.map((r) => [r.name, r.status, r.sourceId ?? "—", r.agents.join(", ") || "—", r.description ?? ""]);
  return renderTable(
    [t("table.name", lang), t("table.status", lang), t("table.source", lang), t("table.agents", lang), t("table.description", lang)],
    data,
    [24, 11, 14, 18, 40],
  );
}
