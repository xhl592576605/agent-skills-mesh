import { describe, expect, test } from "vitest";
import { listInstalledSkills } from "../src/core/services/skill-service.js";
import type { IndexFile } from "../src/core/models/index.js";
import type { InstalledSkillRecord, StateFile } from "../src/core/models/state.js";
import type { SkillRecord } from "../src/core/models/skill.js";

function installedRecord(
  name: string,
  opts: { sourceId?: string; agents?: string[]; description?: string } = {}
): InstalledSkillRecord {
  return {
    skillName: name,
    displayName: name,
    description: opts.description,
    tags: [],
    ssotPath: `/tmp/ssot/${name}`,
    source: opts.sourceId
      ? { kind: "configured-source", sourceId: opts.sourceId, sourceType: "local-dir", sourcePath: "/tmp/s", relativePath: name }
      : { kind: "manual-import" },
    contentHash: "abc",
    installedAt: "t",
    updatedAt: "t",
    enabledAgents: Object.fromEntries(
      (opts.agents ?? []).map((a) => [a, { agentId: a, targetPath: `/tmp/${a}/${name}`, linkedAt: "t" }])
    ),
  };
}

function indexWith(skills: Record<string, SkillRecord>): IndexFile {
  return { version: 1, skills, installations: {}, updatedAt: "t" } as unknown as IndexFile;
}

describe("listInstalledSkills (R1)", () => {
  test("从 state.installedSkills 投影，按 name 排序；sourceId/agents/description 正确", () => {
    const state: StateFile = {
      version: 1,
      installedSkills: {
        zebra: installedRecord("zebra", { sourceId: "repo-a", agents: ["claude"] }),
        alpha: installedRecord("alpha", { sourceId: "repo-b", agents: ["claude", "codex"] }),
      },
    };
    const index = indexWith({
      zebra: { name: "zebra", displayName: "zebra", description: undefined, tags: [], status: "managed", candidates: [] },
      alpha: { name: "alpha", displayName: "alpha", description: "a tool", tags: [], status: "managed", candidates: [] },
    });
    const rows = listInstalledSkills(state, index);
    expect(rows.map((r) => r.name)).toEqual(["alpha", "zebra"]);
    expect(rows[0]).toEqual({
      name: "alpha",
      status: "managed",
      sourceId: "repo-b",
      agents: ["claude", "codex"],
      description: "a tool",
    });
  });

  test("manual-import 无 sourceId → undefined；index 缺失时 status=managed、description 回退 record", () => {
    const state: StateFile = {
      version: 1,
      installedSkills: { orphan: installedRecord("orphan", { description: "from record" }) },
    };
    const rows = listInstalledSkills(state, indexWith({}));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("managed");
    expect(rows[0].sourceId).toBeUndefined();
    expect(rows[0].description).toBe("from record");
  });

  test("空 installedSkills → []", () => {
    const state: StateFile = { version: 1, installedSkills: {} };
    expect(listInstalledSkills(state, indexWith({}))).toEqual([]);
  });
});
