import { describe, expect, test } from "vitest";
import type { IndexFile } from "../src/core/models/index.js";
import type { InstallationRecord } from "../src/core/models/installation.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../src/core/models/skill.js";
import { listDiscover } from "../src/core/services/discover-service.js";

function candidate(skillName: string, sourceId: string, skillPath: string): SkillCandidate {
  return {
    id: `${sourceId}:${skillName}`,
    skillName,
    sourceId,
    sourceType: "agent-dir",
    path: skillPath,
    entry: "SKILL.md",
    tags: [],
    hash: "hash",
    mtimeMs: 1,
    size: 1,
    origin: "agent-dir",
    managed: false
  };
}

function skill(name: string, status: SkillStatus, candidates: SkillCandidate[]): SkillRecord {
  return { name, displayName: name, status, tags: [], candidates };
}

function installation(record: Partial<InstallationRecord> & Pick<InstallationRecord, "skillName" | "agentId" | "status" | "targetPath">): InstallationRecord {
  return { id: `${record.skillName}:${record.agentId}`, ...record };
}

describe("listDiscover", () => {
  test("lists discovered/conflict/external/broken-link entries", () => {
    const index: IndexFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      skills: {
        discovered: skill("discovered", "discovered", [candidate("discovered", "agent", "/tmp/discovered")]),
        conflict: skill("conflict", "conflict", [candidate("conflict", "a", "/tmp/a"), candidate("conflict", "b", "/tmp/b")]),
        external: skill("external", "managed", [candidate("external", "src", "/tmp/external-src")]),
        broken: skill("broken", "managed", [candidate("broken", "src", "/tmp/broken-src")])
      },
      installations: {
        "external:pi": installation({ skillName: "external", agentId: "pi", status: "external", targetPath: "/tmp/pi/external", reason: "target is a real skill directory" }),
        "broken:pi": installation({ skillName: "broken", agentId: "pi", status: "broken-link", targetPath: "/tmp/pi/broken", linkTarget: "/tmp/missing", reason: "symlink target is missing" })
      },
      issues: []
    };

    const entries = listDiscover(index);

    // discovered + conflict（来自 skills）+ external + broken-link（来自 installations）= 4
    expect(entries).toHaveLength(4);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "discovered", skillName: "discovered" }),
      expect.objectContaining({ kind: "conflict", skillName: "conflict" }),
      expect.objectContaining({ kind: "external", skillName: "external" }),
      expect.objectContaining({ kind: "broken-link", skillName: "broken" })
    ]));
  });

  test("returns empty when no discoverable items", () => {
    const index: IndexFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      skills: { managed: skill("managed", "managed", [candidate("managed", "src", "/tmp/managed")]) },
      installations: {},
      issues: []
    };
    expect(listDiscover(index)).toEqual([]);
  });
});
