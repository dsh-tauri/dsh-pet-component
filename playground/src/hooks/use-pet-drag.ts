import type { RefObject } from 'react'
import type { DragSample, ThrowBounds } from '../physics'
import { useRafFn } from '@reause/core'
import { useCallback, useEffect, useRef, useState } from 'react'

export type DragDirection = 'left' | 'right'
export interface PetDragOptions {
  containerRef?: RefObject<HTMLElement | null>
  onStart?: () => void
  onRelease?: (trail: readonly DragSample[], now: number) => void
  throwPower?: number
  getBounds?: (box: HTMLDivElement) => ThrowBounds | null
}
export interface PetDragResult {
  boxRef: RefObject<HTMLDivElement | null>
  handleRef: RefObject<HTMLDivElement | null>
  x: number
  y: number
  setPosition: (position: { x: number, y: number }) => void
  dragging: boolean
  direction: DragDirection | undefined
  pressed: boolean
  onHitboxPointerDown: () => void
  onHitboxPointerUp: () => void
  reset: () => void
  cancel: () => void
}

/**
 * 上游 5px 手势门槛、指针轨迹与 K=200/C=30 弹簧；位置只在门槛之后更新。
 * 舞台夹取是 playground 宿主边界，不将夹取后的慢位移误作指针甩动速度。
 */
export function usePetDrag({ containerRef, onStart, onRelease, throwPower = 1, getBounds }: PetDragOptions = {}): PetDragResult {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const positionRef = useRef({ x: 0, y: 0 })
  const gestureRef = useRef<{ id: number, x: number, y: number, start: { x: number, y: number }, target: { x: number, y: number }, vx: number, vy: number, engaged: boolean, trail: DragSample[] } | null>(null)
  const [point, setPoint] = useState(positionRef.current)
  const [dragging, setDragging] = useState(false)
  const [direction, setDirection] = useState<DragDirection>()
  const [pressed, setPressed] = useState(false)
  const latestRef = useRef({ onStart, onRelease })
  latestRef.current = { onStart, onRelease }
  const setPosition = useCallback((next: { x: number, y: number }) => {
    positionRef.current = { x: next.x, y: next.y }
    // 当帧写入，释放初始点读取真实 spring-follow 位置而非指针目标。
    if (boxRef.current) {
      boxRef.current.style.left = `${next.x}px`
      boxRef.current.style.top = `${next.y}px`
    }
    setPoint(positionRef.current)
  }, [])

  useRafFn(({ delta }) => {
    const active = gestureRef.current
    if (!active?.engaged)
      return
    // 小子步避免大帧下显式弹簧发散，总时间上限与飞行一致。
    let remaining = Math.min(0.05, Math.max(0, delta / 1000))
    let { x, y } = positionRef.current
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120)
      active.vx += ((active.target.x - x) * 200 - active.vx * 30) * throwPower * dt
      active.vy += ((active.target.y - y) * 200 - active.vy * 30) * throwPower * dt
      x += active.vx * dt
      y += active.vy * dt
      remaining -= dt
    }
    const stage = containerRef?.current
    const box = boxRef.current
    if (stage && box) {
      // 与飞行共用身体/脚底边界，重新抓取贴边或落地宠物不会跳回透明画布边缘。
      const bounds = getBounds?.(box) ?? { minX: 0, minY: 0, maxX: stage.clientWidth - box.offsetWidth, maxY: stage.clientHeight - box.offsetHeight }
      x = Math.max(bounds.minX, Math.min(Math.max(bounds.minX, bounds.maxX), x))
      y = Math.max(bounds.minY, Math.min(Math.max(bounds.minY, bounds.maxY), y))
    }
    setPosition({ x, y })
  })

  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || gestureRef.current || !handleRef.current?.contains(event.target as Node))
        return
      latestRef.current.onStart?.()
      gestureRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: { ...positionRef.current },
        target: { ...positionRef.current },
        vx: 0,
        vy: 0,
        engaged: false,
        trail: [],
      }
      setPressed(true)
      // 真指针捕获保证出窗口也能收尾；测试派发的非活动指针不能捕获。
      if (event.isTrusted)
        handleRef.current?.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const move = (event: PointerEvent) => {
      const active = gestureRef.current
      if (!active || active.id !== event.pointerId)
        return
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      if (!active.engaged) {
        if (Math.hypot(dx, dy) < 5)
          return
        active.engaged = true
        setDragging(true)
      }
      const last = active.trail.at(-1)
      if (last && Math.abs(event.clientX - last.x) >= 3)
        setDirection(event.clientX > last.x ? 'right' : 'left')
      active.trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY })
      active.trail = active.trail.filter(sample => sample.t >= event.timeStamp - 200)
      active.target = { x: active.start.x + dx, y: active.start.y + dy }
      event.preventDefault()
    }
    const end = (event: PointerEvent) => {
      const active = gestureRef.current
      if (!active || active.id !== event.pointerId)
        return
      gestureRef.current = null
      setDragging(false)
      setDirection(undefined)
      setPressed(false)
      // 取消不抛：保留当前点，这里比上游共享 pointerup 路径更安全。
      if (active.engaged && event.type === 'pointerup')
        latestRef.current.onRelease?.(active.trail, event.timeStamp)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      gestureRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    const active = gestureRef.current
    gestureRef.current = null
    if (active && handleRef.current?.hasPointerCapture(active.id))
      handleRef.current.releasePointerCapture(active.id)
    setDragging(false)
    setDirection(undefined)
    setPressed(false)
  }, [])
  useEffect(() => {
    const lost = (event: PointerEvent) => {
      if (gestureRef.current?.id === event.pointerId)
        cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('lostpointercapture', lost)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('lostpointercapture', lost)
    }
  }, [cancel])
  const onHitboxPointerDown = useCallback(() => {}, [])
  const onHitboxPointerUp = useCallback(() => {}, [])
  const reset = useCallback(() => {
    cancel()
    setPosition({ x: 0, y: 0 })
  }, [cancel, setPosition])
  return { boxRef, handleRef, x: point.x, y: point.y, setPosition, dragging, direction, pressed, onHitboxPointerDown, onHitboxPointerUp, reset, cancel }
}
