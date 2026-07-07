import { createContext, useContext, createSignal, type ParentProps } from "solid-js"
import { ConfigStore } from "../../core/storage/config-store.js"
import { t as i18nT, type Locale, type Params, type TKey } from "../../i18n/index.js"

/**
 * TUI 响应式 i18n（design §6.1）。
 *
 * 与 `theme.tsx` 同构的 Provider/use 模式：`I18nProvider` 持有语言 signal，`useI18n()`
 * 暴露 `{ locale, t, setLocale, toggle }`。`t()` 内部读 `locale()`——语言切换（`shift+L`
 * → `toggle()`）后所有在 JSX 内以 `{t("key")}` 形式调用的文本响应式重渲。
 *
 * **Owner Context**（solid-patterns）：组件体捕获 `useI18n()` 返回值后，再在
 * `useKeyboard`/async 回调里闭包使用 `t`/`locale`，不在回调内直接调 `useI18n()`。
 *
 * 持久化：`setLocale`/`toggle` 异步写回 `config.toml` 的 `settings.language`；写回失败
 * 不阻塞 UI（下次启动按原 config 语言）。`ConfigStore` 无状态（home 经 `ASM_HOME` 推断），
 * 故本 Provider 自建实例与 `DataProvider` 的实例等价。
 */

/** 绑定当前 locale 的翻译函数（纯渲染组件经 props 接收，与 `theme` prop 对称）。 */
export type TranslateFn = (key: TKey, params?: Params) => string

export interface I18nContextValue {
  /** 当前语言（响应式 accessor）。 */
  locale: () => Locale
  /** 翻译：内部读 `locale()`，故在 JSX getter 内响应式。 */
  t: TranslateFn
  /** 设置语言并异步写回 config.toml。 */
  setLocale: (l: Locale) => Promise<void>
  /** zh↔en 互切并写回。 */
  toggle: () => Promise<void>
}

const I18nContext = createContext<I18nContextValue>()

export function I18nProvider(props: ParentProps<{ initial: Locale }>) {
  const [locale, setLocaleSig] = createSignal<Locale>(props.initial)

  const t: TranslateFn = (key, params) => i18nT(key, locale(), params)

  /** 写回 config（失败静默：不阻塞 UI，下次启动沿用磁盘 config）。 */
  const setLocale = async (l: Locale): Promise<void> => {
    setLocaleSig(l)
    try {
      const configStore = new ConfigStore()
      const cfg = await configStore.read()
      cfg.settings.language = l
      await configStore.write(cfg)
    } catch {
      // 持久化失败不影响本次切换（signal 已更新），重启后回退到磁盘旧值。
    }
  }

  const toggle = async (): Promise<void> => {
    await setLocale(locale() === "zh-CN" ? "en" : "zh-CN")
  }

  const value: I18nContextValue = { locale, t, setLocale, toggle }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used within an I18nProvider")
  return value
}
