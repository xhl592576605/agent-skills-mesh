import { useState } from "react";
import { adoptSkill, listDiscover, setIgnored } from "../../core/services/discover-service.js";
import type { DiscoverEntry } from "../../core/services/discover-service.js";
import { ConfigStore } from "../../core/storage/config-store.js";
import { IndexStore } from "../../core/storage/index-store.js";
import type { IndexFile } from "../../core/models/index.js";

export interface UseDiscoverInput {
  /** 当前快照的 index（派生 discover 条目的数据源）。 */
  readonly index: IndexFile;
  /**
   * adopt/ignore 完成后由 App 触发「重新读取 config+index」。
   *
   * 复用 useIndexState.reload（与 useIndexState 构造同一 home 的 store）：service 已把
   * config.toml + index.json 写到磁盘，reload 重新读取即可让 App effect 回写 SET_SNAPSHOT，
   * 各屏据此重算（含 config 的 skillOverrides 变更，避免 refresh 闭包用到过期 config）。
   */
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
 * 组件只渲染条目 + 收集按键意图；adopt/ignore 全部走 service（写 config.toml + index.json），
 * 完成后 reload 让 App 单一数据源更新。本 hook 不复制扫描/adopt/ignore 逻辑。
 */
export function useDiscover({ index, reload }: UseDiscoverInput): UseDiscoverResult {
  // stores 与 useIndexState 同 home（getAsmHome，受 ASM_HOME 影响），按需构造且渲染期稳定。
  const [configStore] = useState(() => new ConfigStore());
  const [indexStore] = useState(() => new IndexStore(configStore.home));

  const entries = listDiscover(index);

  const adopt = async (skillName: string): Promise<void> => {
    await adoptSkill(configStore, indexStore, skillName);
    await reload();
  };

  const ignore = async (skillName: string): Promise<void> => {
    await setIgnored(configStore, indexStore, skillName, true);
    await reload();
  };

  const unignore = async (skillName: string): Promise<void> => {
    await setIgnored(configStore, indexStore, skillName, false);
    await reload();
  };

  return { entries, adopt, ignore, unignore };
}
