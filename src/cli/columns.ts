/**
 * CLI 表格列对齐工具（task 07-06-cli-tui-bugfix · R2）。
 *
 * 终端 tab（`\t`）跳列规则因终端/列宽而异，导致 `name\tstatus\t...` 错位。本模块用
 * 固定显示宽度对齐：CJK / 全角字符按双宽计列宽，长字段尾部 `…` 截断，保证列边界稳定。
 *
 * 全部为纯函数，便于在 `tests/columns.test.ts` 直接断言，无需子进程。
 */

/** 单个字符（按 Unicode code point）的显示列宽：CJK / 全角 → 2，其余 → 1。 */
export function charWidthOf(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff))
  ) {
    return 2;
  }
  return 1;
}

/** 字符串显示宽度（按 code point 累加 `charWidthOf`）。 */
export function strWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += charWidthOf(ch);
  return width;
}

/** 按显示宽度截断到 `width`，超宽尾部加 `…`（占 1 宽）；不宽于 `width` 则原样返回。 */
export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  if (strWidth(s) <= width) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const cw = charWidthOf(ch);
    if (used + cw > width - 1) break;
    out += ch;
    used += cw;
  }
  return out + "…";
}

/** 按显示宽度右补空格到 `width`；超宽先截断。`width>0` 时返回值显示宽度恒为 `width`。 */
export function padEnd(s: string, width: number): string {
  if (width <= 0) return "";
  const w = strWidth(s);
  if (w > width) return truncate(s, width);
  return s + " ".repeat(width - w);
}

/**
 * 渲染固定列宽表格（表头 + 分隔线 + 数据行）。
 *
 * - 未传 `widths` 时，列宽 = `max(表头, 各行该列)` 显示宽度 + 2（列间距），自动撑满内容。
 * - 传 `widths[i]` 时，该列固定宽度，超宽单元格按 `truncate` 截断。
 * - 行尾去除多余空格（rstrip），避免末列被 padding 撑长。
 *
 * 返回的字符串数组可直接逐行 `console.log`。
 */
export function renderTable(headers: string[], rows: string[][], widths?: number[]): string[] {
  const cols = headers.length;
  const w: number[] =
    widths ??
    headers.map((header, i) => {
      let max = strWidth(header);
      for (const row of rows) {
        const cellWidth = strWidth(String(row[i] ?? ""));
        if (cellWidth > max) max = cellWidth;
      }
      return max + 2;
    });

  const rstrip = (s: string): string => s.replace(/\s+$/, "");
  const line = (cells: string[]): string => rstrip(cells.map((cell, i) => padEnd(cell, w[i] ?? 0)).join(""));

  const lines: string[] = [line(headers), rstrip(w.map((width) => "─".repeat(width)).join(""))];
  for (const row of rows) {
    lines.push(line(Array.from({ length: cols }, (_, i) => String(row[i] ?? ""))));
  }
  return lines;
}
