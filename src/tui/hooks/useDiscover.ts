import { listDiscover } from "../../core/services/discover-service.js";
import type { DiscoverEntry } from "../../core/services/discover-service.js";
import type { IndexFile } from "../../core/models/index.js";

export interface UseDiscoverInput {
  /** 当前快照的 index（派生 discover 条目的数据源）。 */
  readonly index: IndexFile;
  /** 预留：交互完成后由 App 触发重新读取（当前 adopt/ignore 已禁用，未使用）。 */
  readonly reload: () => Promise<void>;
}

export interface UseDiscoverResult {
  readonly entries: readonly DiscoverEntry[];
  readonly adopt: (skillName: string) => Promise<void>;
  readonly ignore: (skillName: string) => Promise<void>;
  readonly unignore: (skillName: string) => Promise<void>;
}

/**
 * Discover 屏的域行为封装（.ts，无 JSX）。
 *
 * CLI 重构后 adopt/ignore 语义由 `asm doctor` + `asm skill enable/disable` 流程替代；
 * 此处仅保留 entries 投影与接口签名以维持 DiscoverScreen 编译，实际交互将在
 * `07-03-tui-redesign` 任务中随四屏重设计一并处理。
 */
export function useDiscover({ index }: UseDiscoverInput): UseDiscoverResult {
  const entries = listDiscover(index);

  const unsupported = async (): Promise<void> => {
    throw new Error("adopt/ignore is disabled; use `asm doctor` and `asm skill enable/disable` instead");
  };

  return { entries, adopt: unsupported, ignore: unsupported, unignore: unsupported };
}
