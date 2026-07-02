import { useCallback, useEffect, useState } from "react";
import { refreshIndex } from "../../core/services/refresh-service.js";
import { ConfigStore } from "../../core/storage/config-store.js";
import { IndexStore } from "../../core/storage/index-store.js";
import { createEmptyIndex } from "../../core/models/index.js";
import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";

/**
 * `createEmptyIndex()` 写出的 updatedAt（epoch），用作「index 尚未 refresh」的哨兵：
 * IndexStore.read() 在文件缺失时也返回 createEmptyIndex()，故两者统一为「需要首次 refresh」。
 */
const EMPTY_INDEX_SENTINEL = createEmptyIndex().updatedAt;

export interface UseIndexStateResult {
  config: AppConfig | null;
  index: IndexFile | null;
  loading: boolean;
  error: Error | null;
  /** refreshIndex(config, index) → 写回 store → 返回新 index 并更新 state。 */
  refresh: () => Promise<IndexFile>;
  /** 重新从 store 读取 config + index（不触发 refresh）。 */
  reload: () => Promise<void>;
}

/**
 * 加载并维护 config/index 快照的 TUI hook（.ts，无 JSX）。
 *
 * 复用现有存储与服务，不重写扫描逻辑：
 * - ConfigStore / IndexStore 构造方式与 `src/cli/index.ts` 的 loadStores 一致
 *   （home 默认 getAsmHome，受 ASM_HOME 影响）。
 * - 首次加载时若 index 为空哨兵，先 refreshIndex(config) 并写回（等价 cli 的 refresh）。
 * - refresh() 走 refreshIndex + indexStore.write，与 cli refresh 命令同源。
 */
export function useIndexState(): UseIndexStateResult {
  // stores 只创建一次，避免每次 render 重建导致 effect 反复触发。
  const [configStore] = useState(() => new ConfigStore());
  const [indexStore] = useState(() => new IndexStore(configStore.home));

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        setLoading(true);
        // 与 cli loadStores 一致：config 缺失即报错，提示先 init。
        if (!(await configStore.exists())) {
          throw new Error("config.toml not found. Run `asm init` first.");
        }
        const loadedConfig = await configStore.read();
        let loadedIndex = await indexStore.read();
        if (loadedIndex.updatedAt === EMPTY_INDEX_SENTINEL) {
          loadedIndex = await refreshIndex(loadedConfig);
          await indexStore.write(loadedIndex);
        }
        if (cancelled) return;
        setConfig(loadedConfig);
        setIndex(loadedIndex);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [configStore, indexStore]);

  const refresh = useCallback(async () => {
    if (!config) throw new Error("config not loaded yet");
    const next = await refreshIndex(config, index ?? createEmptyIndex());
    await indexStore.write(next);
    setIndex(next);
    return next;
  }, [config, index, indexStore]);

  const reload = useCallback(async () => {
    const reloadedConfig = await configStore.read();
    const reloadedIndex = await indexStore.read();
    setConfig(reloadedConfig);
    setIndex(reloadedIndex);
  }, [configStore, indexStore]);

  // config/index 的 setter 不通过返回值暴露：App 用 SET_SNAPSHOT dispatch 持有快照，
  // refresh/reload 已覆盖运行时更新场景。
  return { config, index, loading, error, refresh, reload };
}
