import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { scanSource } from "../src/core/scanners/skill-scanner.js";
import { mergeCandidates } from "../src/core/services/refresh-service.js";
import { assertSafeSkillName } from "../src/utils/safe-path.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "asm-scanner-"));
}

async function writeSkill(dir: string, content = "---\nname: custom-name\ndescription: hello\n---\nbody"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf8");
}

describe("skill scanner", () => {
  test("scans repo skills/foo/SKILL.md", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "foo"));
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].skillName).toBe("custom-name");
    expect(candidates[0].description).toBe("hello");
  });

  test("scans repo foo/SKILL.md", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "foo"), "# no frontmatter");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates[0].skillName).toBe("foo");
  });

  test("scans single skill directory", async () => {
    const root = await tempDir();
    await writeSkill(root, "---\nname: single\n---\nbody");
    const candidates = await scanSource({ id: "single", name: "Single", type: "single-skill", path: root, enabled: true });
    expect(candidates.map((candidate) => candidate.skillName)).toEqual(["single"]);
  });

  test("rejects path traversal skill names from frontmatter", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "foo"), "---\nname: ../escape\n---\nbody");
    await expect(scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true })).rejects.toThrow(/Invalid skill name/);
  });

  test("rejects whitespace and control characters in skill names", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "foo"), "---\nname: bad name\n---\nbody");
    await expect(scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true })).rejects.toThrow(/Invalid skill name/);

    expect(() => assertSafeSkillName("bad\u0007name")).toThrow(/Invalid skill name/);
    expect(() => assertSafeSkillName("bad\u200bname")).toThrow(/Invalid skill name/);
  });

  test("candidate id stays stable when content hash changes", async () => {
    const root = await tempDir();
    const skillDir = path.join(root, "skills", "foo");
    await writeSkill(skillDir, "---\nname: stable\n---\none");
    const first = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    await writeSkill(skillDir, "---\nname: stable\n---\ntwo");
    const second = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });

    expect(second[0].hash).not.toBe(first[0].hash);
    expect(second[0].id).toBe(first[0].id);
  });

  test("detects same-name multi-source conflict", async () => {
    const one = await tempDir();
    const two = await tempDir();
    await writeSkill(path.join(one, "foo"), "---\nname: shared\n---\none");
    await writeSkill(path.join(two, "foo"), "---\nname: shared\n---\ntwo");
    const candidates = [
      ...(await scanSource({ id: "one", name: "One", type: "local-dir", path: one, enabled: true })),
      ...(await scanSource({ id: "two", name: "Two", type: "local-dir", path: two, enabled: true }))
    ];
    const skills = mergeCandidates(candidates);
    expect(skills.shared.status).toBe("conflict");
    expect(skills.shared.candidates).toHaveLength(2);
  });

  test("scans nested skills/<category>/<skill>/SKILL.md (depth-2)", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "engineering", "tdd"), "# body");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName)).toEqual(["tdd"]);
  });

  test("does not descend past a discovered SKILL.md (no examples noise)", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "my-skill"), "# body");
    await writeSkill(path.join(root, "skills", "my-skill", "examples", "inner"), "# body");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName)).toEqual(["my-skill"]);
  });

  test("skips SKIP_DIRS (node_modules, .git, dist, build, __pycache__)", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "real"), "# body");
    await writeSkill(path.join(root, "skills", "node_modules", "evil"), "# body");
    await writeSkill(path.join(root, "skills", ".git", "evil2"), "# body");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName).sort()).toEqual(["real"]);
  });

  test("root stays depth-1: examples/foo/SKILL.md not surfaced when priority hits", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "real"), "# body");
    await writeSkill(path.join(root, "examples", "foo"), "# body");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName).sort()).toEqual(["real"]);
  });

  test("discovers skills declared in .claude-plugin/plugin.json", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "deep", "special"), "# body");
    await fs.mkdir(path.join(root, ".claude-plugin"), { recursive: true });
    await fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p", skills: ["./deep/special"] }), "utf8");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName)).toContain("special");
  });

  test("ignores plugin manifest skill paths missing ./ prefix", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "skills", "normal"), "# body");
    await writeSkill(path.join(root, "deep", "special"), "# body");
    await fs.mkdir(path.join(root, ".claude-plugin"), { recursive: true });
    await fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p", skills: ["deep/special"] }), "utf8");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName).sort()).toEqual(["normal"]);
  });

  test("falls back to recursive scan when priority dirs are empty", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "a", "b", "c", "deep-skill"), "# body");
    const candidates = await scanSource({ id: "repo", name: "Repo", type: "local-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName)).toEqual(["deep-skill"]);
  });

  test("agent-dir source stays depth-1 (flat install dir)", async () => {
    const root = await tempDir();
    await writeSkill(path.join(root, "installed"), "# body");
    await writeSkill(path.join(root, "installed", "sub", "inner"), "# body");
    const candidates = await scanSource({ id: "agent-x-skills", name: "X", type: "agent-dir", path: root, enabled: true });
    expect(candidates.map((c) => c.skillName).sort()).toEqual(["installed"]);
  });
});
