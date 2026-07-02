import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, pathExists } from "../../utils/fs.js";
import { getAsmHome } from "../../utils/path.js";
import { createEmptyIndex, type IndexFile } from "../models/index.js";

export class IndexStore {
  readonly home: string;
  readonly indexPath: string;

  constructor(home = getAsmHome()) {
    this.home = home;
    this.indexPath = path.join(home, "index.json");
  }

  async exists(): Promise<boolean> {
    return pathExists(this.indexPath);
  }

  async init(options: { force?: boolean } = {}): Promise<IndexFile> {
    if ((await this.exists()) && !options.force) {
      return this.read();
    }
    const index = createEmptyIndex();
    await this.write(index);
    return index;
  }

  async read(): Promise<IndexFile> {
    if (!(await this.exists())) return createEmptyIndex();
    return JSON.parse(await fs.readFile(this.indexPath, "utf8")) as IndexFile;
  }

  async write(index: IndexFile): Promise<void> {
    await atomicWriteFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
}
