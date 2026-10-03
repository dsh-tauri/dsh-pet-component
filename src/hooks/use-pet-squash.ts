import type { RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

/** 上游 Q 弹：前 45% 下压，easeOutBack 回弹；只改变媒体，不改变几何/动作。 */
export function squashScale(progress: number, depth: number): number {
  if (progress < 0.45)
    return 1 - (1 - depth) * (progress / 0.45) ** 2
  const p = (progress - 0.45) / 0.55 - 1
  const back = 1 + 2.70158 * p ** 3 + 1.70158 * p ** 2
  return Math.min(1.12, depth + (1 - depth) * Math.max(back, 0))
}

export function landingSquash(impactSpeed: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(impactSpeed) - 300) / 1200))
  return Math.min(0.8, 1 - t * 0.45)
}

export function usePetSquash(shellRef: RefObject<HTMLDivElement | null>, dragging: boolean) {
  const frameRef = useRef<number | null>(null)
  const stopSquash = useCallback(() => {
    if (frameRef.current !== null)
      cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    shellRef.current?.style.removeProperty('--dsh-pet-squash')
  }, [shellRef])

  const squash = useCallback((impactSpeed?: number) => {
    // 非有限参数是真正的空操作，不能打断正在播放的合法反馈。
    if (impactSpeed !== undefined && !Number.isFinite(impactSpeed))
      return
    stopSquash()
    const shell = shellRef.current
    if (!shell || dragging || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const depth = impactSpeed === undefined ? 0.55 : landingSquash(impactSpeed)
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / 220))
      shell.style.setProperty('--dsh-pet-squash', String(squashScale(progress, depth)))
      if (progress < 1)
        frameRef.current = requestAnimationFrame(step)
      else
        stopSquash()
    }
    frameRef.current = requestAnimationFrame(step)
  }, [dragging, shellRef, stopSquash])

  useEffect(() => {
    if (dragging)
      stopSquash()
  }, [dragging, stopSquash])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => {
      if (media.matches)
        stopSquash()
    }
    media.addEventListener('change', changed)
    return () => {
      media.removeEventListener('change', changed)
      stopSquash()
    }
  }, [stopSquash])

  return { squash, stopSquash }
}
