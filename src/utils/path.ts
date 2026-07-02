import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function getAsmHome(): string {
  return process.env.ASM_HOME ? path.resolve(expandHome(process.env.ASM_HOME)) : path.join(os.homedir(), ".agent-skills-mesh");
}

export function resolveConfiguredPath(input: string): string {
  if (input === "~/.agent-skills-mesh") return getAsmHome();
  if (input.startsWith("~/.agent-skills-mesh/")) return path.join(getAsmHome(), input.slice("~/.agent-skills-mesh/".length));
  return path.resolve(expandHome(input));
}

export function toPosixId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
