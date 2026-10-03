import { useStateAutoReset } from '@reause/core'
import { useCallback, useEffect, useMemo } from 'react'

/**
 * 双击判定窗口 ms —— 与 dsh-pet / `deepseek-harness-desktop` 的 `DOUBLE_CLICK_MS` 同量级。
 */
export const DOUBLE_CLICK_MS = 500

export interface UseDoubleClickOptions {
  /** 判定窗口 ms，默认 `DOUBLE_CLICK_MS` */
  window?: number
  /**
   * 置 `true` 作废当前窗口 —— 拖拽这类「按下了但不算点击」的手势会打断双击链，
   * 免得「拖一下再快速点一下」被判成双击（与参考实现一致）。
   */
  interrupted?: boolean
}

/**
 * 双击判定 —— 命中框每次 `pointerdown` 调一次，两次按下间隔小于窗口即命中；
 * 命中后窗口立刻归零（三连按 = 一次双击 + 重新开窗）。
 *
 * 窗口用 reause 的 `useStateAutoReset` 表达：`armed` 为 `true` 表示「窗口还开着」，
 * 超时自动回到 `false`，不需要自己存时间戳。
 *
 * ```tsx
 * const onDoubleClick = useDoubleClick(() => pet.motion({ type: 'waving', replay: true }))
 * ```
 */
export function useDoubleClick(onDoubleClick: () => void, options: UseDoubleClickOptions = {}): (() => void) & { reset: () => void } {
  const { window = DOUBLE_CLICK_MS, interrupted = false } = options
  const [armed, setArmed] = useStateAutoReset(false, window)

  // 拖动开始就作废窗口：拖过的那次按下不算「第一下」
  useEffect(() => {
    if (interrupted)
      setArmed(false)
  }, [interrupted, setArmed])

  const reset = useCallback(() => setArmed(false), [setArmed])
  const press = useCallback(() => {
    if (!armed) {
      setArmed(true) // 第一次按下：开窗等第二下
      return
    }
    setArmed(false)
    onDoubleClick()
  }, [armed, onDoubleClick, setArmed])
  return useMemo(() => Object.assign(press, { reset }), [press, reset])
}
