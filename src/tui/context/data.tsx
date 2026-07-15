import { createContext, onMount, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { ConfigStore } from "../../core/storage/config-store.js"
import { IndexStore } from "../../core/storage/index-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import { refreshIndex } from "../../core/services/refresh-service.js"
import { checkSkillUpdates, checkSources } from "../../core/services/update-check-service.js"
import { bizError } from "../../core/errors.js"
import type { AppConfig } from "../../core/models/config.js"
import type { IndexFile } from "../../core/models/index.js"
import type { StateFile } from "../../core/models/state.js"

/**
 * TUI 数据快照（替代旧 React `useIndexState`）。
 *
 * 安全模型不变（design §1）：TUI 只读 config/index/state 快照用于渲染；
 * 所有 FS 写操作经 core service（install/uninstall/source/doctor）+ ConfirmDialog，
 * 完成后调 `refresh()` 回写本快照。TUI 本身不直接写 SSOT。
 */
export interface DataSnapshot {
  config: AppConfig | null
  index: IndexFile | null
  state: StateFile | null
  loading: boolean
  error: Error | null
  /** 进入 TUI 自动检查更新进行中（后台异步，不阻塞交互）。 */
  checking: boolean
}

export interface DataContextValue {
  snapshot: DataSnapshot
  /** 重扫源重建 index（写回磁盘）并刷新快照。 */
  refresh: () => Promise<void>
  /** 重新从磁盘读 config/state/index（外部修改后用）。 */
  reload: () => Promise<void>
  /** 全量检测维度1+维度2，写 state 并刷新快照（进入 TUI 时后台调用）。 */
  checkUpdates: () => Promise<void>
}

const DataContext = createContext<DataContextValue>()

export function DataProvider(props: ParentProps) {
  const [snapshot, setSnapshot] = createStore<DataSnapshot>({
    config: null,
    index: null,
    state: null,
    loading: true,
    error: null,
    checking: false
  })

  // store 实例在 Provider 生命周期内复用（与 cli/index.ts loadStores 同款）。
  const configStore = new ConfigStore()
  const indexStore = new IndexStore(configStore.home)
  const stateStore = new StateStore(configStore.home)

  /** 首次加载：config 缺失报错；index 缺失自动 refresh（design §3 DataProvider 契约）。 */
  async function load() {
    setSnapshot("loading", true)
    setSnapshot("error", null)
    try {
      if (!(await configStore.exists())) {
        throw bizError("CONFIG_NOT_FOUND")
      }
      const config = await configStore.read()
      const state = await stateStore.read()
      let index: IndexFile | null = (await indexStore.exists()) ? await indexStore.read() : null
      // auto_refresh_on_start=true（默认）时启动即重建 index，避免 agent 目录被外部清理/变更后
      // index 陈旧（否则 doctor/matrix 会报告已不存在的 external/ghost installation）。
      if (!index || config.settings.auto_refresh_on_start) {
        index = await refreshIndex(config, state)
        await indexStore.write(index)
      }
      setSnapshot({ config, index, state, loading: false, error: null })
    } catch (err) {
      setSnapshot({
        loading: false,
        error: err instanceof Error ? err : new Error(String(err))
      })
    }
  }

  /** refresh：重扫源重建 index 并写回，刷新快照中的 index（不重读 config/state）。 */
  async function refresh() {
    if (!snapshot.config || !snapshot.state) {
      await load()
      return
    }
    try {
      const next = await refreshIndex(snapshot.config, snapshot.state)
      await indexStore.write(next)
      setSnapshot("index", next)
      setSnapshot("error", null)
    } catch (err) {
      setSnapshot("error", err instanceof Error ? err : new Error(String(err)))
    }
  }

  /** reload：从磁盘重读 config/state/index（config 可能被外部命令改）。 */
  async function reload() {
    await load()
  }

  /**
   * 全量检测维度1（source 有更新）+ 维度2（skill 与 SSOT 有差异），写回 state 并刷新快照。
   * 进入 TUI 时后台异步调用，不阻塞渲染；检测失败静默降级（单 source 失败不阻断）。
   */
  async function checkUpdates() {
    if (!snapshot.config) return
    setSnapshot("checking", true)
    try {
      await checkSources(configStore, stateStore)
      await checkSkillUpdates(configStore, stateStore)
      const state = await stateStore.read()
      setSnapshot("state", state)
    } catch {
      // 检测失败不设全局 error：降级为「无标记」，不影响主流程。
    } finally {
      setSnapshot("checking", false)
    }
  }

  onMount(() => {
    void load().then(() => checkUpdates())
  })

  const value: DataContextValue = { snapshot, refresh, reload, checkUpdates }

  return <DataContext.Provider value={value}>{props.children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const value = useContext(DataContext)
  if (!value) throw new Error("useData must be used within a DataProvider")
  return value
}
