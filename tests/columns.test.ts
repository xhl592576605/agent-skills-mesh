import { describe, expect, test } from "vitest";
import { charWidthOf, padEnd, renderTable, strWidth, truncate } from "../src/cli/columns.js";

describe("cli columns — 显示宽度", () => {
  test("charWidthOf: ASCII/半角单宽，CJK/全角双宽", () => {
    expect(charWidthOf("a")).toBe(1);
    expect(charWidthOf(" ")).toBe(1);
    expect(charWidthOf("中")).toBe(2);
    expect(charWidthOf("＿")).toBe(2); // 全角下划线 U+FF3F
    expect(charWidthOf("ﾈ")).toBe(1); // 半角片假名 U+FF88
    expect(charWidthOf("─")).toBe(1); // box drawing U+2500
    expect(charWidthOf("…")).toBe(1); // U+2026
  });

  test("strWidth 按 code point 累加", () => {
    expect(strWidth("abc")).toBe(3);
    expect(strWidth("你好world")).toBe(9); // 2+2+5
  });
});

describe("cli columns — 截断与补齐", () => {
  test("truncate: 超宽加 …，不超原样", () => {
    expect(truncate("abcde", 3)).toBe("ab…");
    expect(truncate("你好世界", 5)).toBe("你好…"); // 你(2)+好(2)=4 ≤ 4，下一个 2 会超
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abc", 0)).toBe("");
  });

  test("padEnd: 补空格 / 超宽截断到固定宽度", () => {
    expect(padEnd("ab", 5)).toBe("ab   ");
    expect(padEnd("你好", 3)).toBe("你…"); // 4>3 → truncate(你好,3)="你…"
    expect(padEnd("abc", 3)).toBe("abc");
    expect(padEnd("x", 0)).toBe("");
  });
});

describe("cli columns — renderTable", () => {
  test("固定 widths：表头 + 分隔线 + 对齐行 + rstrip", () => {
    const lines = renderTable(["A", "B"], [["x", "y"], ["abc", "d"]], [4, 4]);
    expect(lines[0]).toBe("A   B"); // padEnd("A",4)+padEnd("B",4) → rstrip
    expect(lines[1]).toBe("────────"); // 4+4 个 ─
    expect(lines[2]).toBe("x   y");
    expect(lines[3]).toBe("abc d"); // padEnd("abc",4)+padEnd("d",4) → "abc d  " → rstrip
  });

  test("未传 widths：自动撑满 + 列间距 2", () => {
    const lines = renderTable(["A", "B"], [["abc", "x"]]);
    // col0 = max(1,3)+2 = 5；col1 = max(1,1)+2 = 3
    expect(lines[0]).toBe("A    B"); // "A    "(5) + "B  "(3) → rstrip → "A    B"
    expect(lines[1]).toBe("────────"); // 5+3
    expect(lines[2]).toBe("abc  x"); // "abc  "(5) + "x  "(3) → rstrip → "abc  x"
  });

  test("CJK 内容双宽计入列宽，不错位", () => {
    const lines = renderTable(["名字", "状态"], [["技能甲", "ok"]]);
    // col0 = max(strWidth("名字")=4, strWidth("技能甲")=6) + 2 = 8
    // col1 = max(4, 2) + 2 = 6
    expect(lines[1]).toBe("──────────────"); // 8+6=14 个 ─
    expect(lines[2]).toBe("技能甲  ok"); // padEnd("技能甲",8)="技能甲  " + padEnd("ok",6)="ok    " → rstrip → "技能甲  ok"
  });

  test("长单元格按 width 截断", () => {
    const lines = renderTable(["A"], [["abcdefghij"]], [4]);
    expect(lines[2]).toBe("abc…"); // truncate 到 4
  });
});
