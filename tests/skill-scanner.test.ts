import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { scanSource } from "../src/core/scanners/skill-scanner.js";
import { mergeCandidates } from "../src/core/services/refresh-service.js";

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
});
