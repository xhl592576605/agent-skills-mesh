/**
 * 更新检测派生纯函数测试（阶段1）。
 *
 * 覆盖 isSkillUpdatable / isSourceUpdatable / countUpdatableSources / countUpdatableSkills
 * 的边界：未检测、已最新、有更新、error 不可信、缺省兜底。
 */
import { describe, expect, test } from "vitest";
import {
  countUpdatableSkills,
  countUpdatableSources,
  isSkillUpdatable,
  isSourceUpdatable,
  listUpdatableSkillNames
} from "../src/core/services/update-check-service.js";
import type { InstalledSkillRecord, SourceSnapshot, StateFile } from "../src/core/models/state.js";

function makeRecord(overrides: Partial<InstalledSkillRecord> = {}): InstalledSkillRecord {
  return {
    skillName: "foo",
    displayName: "foo",
    tags: [],
    ssotPath: "/tmp/ssot/foo",
    source: {
      kind: "configured-source",
      sourceId: "s1",
      sourceType: "git-repo",
      sourcePath: "/tmp/s1",
      relativePath: "foo"
    },
    contentHash: "h1",
    installedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    enabledAgents: {},
    ...overrides
  };
}

describe("isSkillUpdatable", () => {
  test("false when sourceHash undefined (未检测)", () => {
    expect(isSkillUpdatable(makeRecord())).toBe(false);
  });
  test("false when sourceHash === contentHash (已最新)", () => {
    expect(isSkillUpdatable(makeRecord({ contentHash: "h1", sourceHash: "h1" }))).toBe(false);
  });
  test("true when sourceHash !== contentHash (有更新)", () => {
    expect(isSkillUpdatable(makeRecord({ contentHash: "h1", sourceHash: "h2" }))).toBe(true);
  });
});

describe("isSourceUpdatable", () => {
  const snaps: Record<string, SourceSnapshot> = {
    s1: { fingerprint: "f1", hasUpdate: true, checkedAt: "t" },
    s2: { fingerprint: "f2", hasUpdate: false, checkedAt: "t" },
    s3: { fingerprint: "f3", hasUpdate: true, checkedAt: "t", error: "fetch failed" }
  };
  test("true when hasUpdate && !error", () => {
    expect(isSourceUpdatable(snaps, "s1")).toBe(true);
  });
  test("false when !hasUpdate", () => {
    expect(isSourceUpdatable(snaps, "s2")).toBe(false);
  });
  test("false when error present (不可信)", () => {
    expect(isSourceUpdatable(snaps, "s3")).toBe(false);
  });
  test("false when snapshot missing", () => {
    expect(isSourceUpdatable(snaps, "sX")).toBe(false);
  });
  test("false when empty snapshots", () => {
    expect(isSourceUpdatable({}, "s1")).toBe(false);
  });
});

describe("countUpdatableSources", () => {
  test("counts only hasUpdate && !error", () => {
    const snaps: Record<string, SourceSnapshot> = {
      a: { fingerprint: "f", hasUpdate: true, checkedAt: "t" },
      b: { fingerprint: "f", hasUpdate: true, checkedAt: "t", error: "x" },
      c: { fingerprint: "f", hasUpdate: false, checkedAt: "t" }
    };
    expect(countUpdatableSources(snaps)).toBe(1);
  });
  test("empty → 0", () => {
    expect(countUpdatableSources({})).toBe(0);
  });
});

describe("countUpdatableSkills", () => {
  test("counts isSkillUpdatable records only", () => {
    const state: StateFile = {
      version: 1,
      installedSkills: {
        a: makeRecord({ skillName: "a", contentHash: "h1", sourceHash: "h2" }), // updatable
        b: makeRecord({ skillName: "b", contentHash: "h1", sourceHash: "h1" }), // upToDate
        c: makeRecord({ skillName: "c" }) // 未检测
      },
      sourceSnapshots: {}
    };
    expect(countUpdatableSkills(state)).toBe(1);
    expect(listUpdatableSkillNames(state)).toEqual(["a"]);
  });
  test("returns only updatable names in stable order", () => {
    const state: StateFile = {
      version: 1,
      installedSkills: {
        z: makeRecord({ skillName: "z", contentHash: "h1", sourceHash: "h2" }),
        a: makeRecord({ skillName: "a", contentHash: "h1", sourceHash: "h3" }),
        current: makeRecord({ skillName: "current", contentHash: "h1", sourceHash: "h1" })
      }
    };
    expect(listUpdatableSkillNames(state)).toEqual(["a", "z"]);
  });

  test("empty installedSkills → 0", () => {
    const state: StateFile = { version: 1, installedSkills: {}, sourceSnapshots: {} };
    expect(countUpdatableSkills(state)).toBe(0);
    expect(listUpdatableSkillNames(state)).toEqual([]);
  });
});
