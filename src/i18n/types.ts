/**
 * i18n 类型定义（design §2.1）。
 *
 * Locale 联合与 TKey 反推为新增语言留扩展点：追加一份字典 + 在 `DICTS` 注册即可，
 * 无需改业务组件。`TKey` 从基准英文字典（`en.ts`）反推，保证类型安全与字典完整性
 * （zh-CN 字典标注 `Dict` 后，TS 会强制其 key 集合与 en 一致）。
 */

/** 支持的语言集合。新增语言在此追加，并在 `index.ts` 的 `DICTS` 注册字典。 */
export type Locale = "en" | "zh-CN";

/** 插值参数：`{{name}}` → 值替换。 */
export type Params = Record<string, string | number>;

/**
 * 字典 key 联合类型，从基准英文字典反推（`keyof typeof en.dict`）。
 * 业务代码引用 `TKey` 而非裸字符串，拼写错误在编译期暴露。
 */
export type TKey = keyof typeof import("./en.js").dict;

/** 完整字典类型：每个 `TKey` 映射到字符串。非基准字典用 `Partial<Dict>`。 */
export type Dict = Record<TKey, string>;
