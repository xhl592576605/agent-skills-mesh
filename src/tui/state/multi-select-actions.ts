export interface UpdatableMultiSelectOption<T> {
  value: T
  locked?: boolean
}

/**
 * 仅允许已安装（locked）的列表项触发更新。
 * 返回 true 表示按键已被有效消费，false 表示当前项不可更新。
 */
export function triggerInstalledOptionUpdate<T>(
  options: readonly UpdatableMultiSelectOption<T>[],
  index: number,
  onUpdate: ((value: T) => void | Promise<void>) | undefined
): boolean {
  const option = options[index]
  if (!option?.locked || !onUpdate) return false
  void onUpdate(option.value)
  return true
}
