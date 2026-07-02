import { describe, expect, test } from "vitest";
import type { IndexFile } from "../src/core/models/index.js";
import type { SkillRecord } from "../src/core/models/skill.js";
import { searchSkills } from "../src/core/services/skill-service.js";

function skill(record: Partial<SkillRecord> & Pick<SkillRecord, "name">): SkillRecord {
  return {
    displayName: record.name,
    tags: [],
    status: "managed",
    candidates: [],
    ...record
  };
}

function indexWith(skills: SkillRecord[]): IndexFile {
  const map: Record<string, SkillRecord> = {};
  for (const entry of skills) map[entry.name] = entry;
  return { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: map, installations: {}, issues: [] };
}

describe("searchSkills", () => {
  const index = indexWith([
    skill({ name: "react-helper", displayName: "React Helper", description: "UI components", tags: ["react", "frontend"] }),
    skill({ name: "backend-tools", displayName: "Backend Tools", description: "server utils", tags: ["node", "backend"] }),
    skill({ name: "react", description: "core react skill", tags: ["framework"] })
  ]);

  test("returns all skills sorted by name when keyword is empty", () => {
    const result = searchSkills(index, "");
    expect(result.map((entry) => entry.name)).toEqual(["backend-tools", "react", "react-helper"]);
  });

  test("returns all skills when keyword is whitespace-only", () => {
    expect(searchSkills(index, "   ").map((entry) => entry.name)).toEqual(["backend-tools", "react", "react-helper"]);
  });

  test("matches by name substring (case-insensitive)", () => {
    expect(searchSkills(index, "REACT").map((entry) => entry.name)).toEqual(["react", "react-helper"]);
  });

  test("matches by displayName substring", () => {
    expect(searchSkills(index, "helper").map((entry) => entry.name)).toEqual(["react-helper"]);
  });

  test("matches by description substring", () => {
    expect(searchSkills(index, "server").map((entry) => entry.name)).toEqual(["backend-tools"]);
  });

  test("matches by tag substring", () => {
    expect(searchSkills(index, "frontend").map((entry) => entry.name)).toEqual(["react-helper"]);
  });

  test("returns empty array when no match", () => {
    expect(searchSkills(index, "nonexistent")).toEqual([]);
  });
});
