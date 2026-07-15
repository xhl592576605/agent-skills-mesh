import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, pathExists } from "../../utils/fs.js";
import { getAsmHome } from "../../utils/path.js";
import { createEmptyState, type StateFile } from "../models/state.js";

export class StateStore {
  readonly home: string;
  readonly statePath: string;

  constructor(home = getAsmHome()) {
    this.home = home;
    this.statePath = path.join(home, "state.json");
  }

  async exists(): Promise<boolean> {
    return pathExists(this.statePath);
  }

  async init(options: { force?: boolean } = {}): Promise<StateFile> {
    if ((await this.exists()) && !options.force) {
      return this.read();
    }
    const state = createEmptyState();
    await this.write(state);
    return state;
  }

  async read(): Promise<StateFile> {
    if (!(await this.exists())) return createEmptyState();
    const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8")) as Partial<StateFile>;
    return {
      version: 1,
      installedSkills: parsed.installedSkills ?? {},
      sourceSnapshots: parsed.sourceSnapshots ?? {}
    };
  }

  async write(state: StateFile): Promise<void> {
    await atomicWriteFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
