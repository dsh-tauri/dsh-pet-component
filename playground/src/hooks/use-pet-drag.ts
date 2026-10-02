import type { UseDraggableOptions } from '@reause/core'
import type { RefObject } from 'react'
import type { DragSample } from '../physics'
import { useDraggable } from '@reause/core'
import { useCallback, useRef, useState } from 'react'

/** 拖拽的水平方向。 */
export type DragDirection = 'left' | 'right'

/** 判定「真正开始拖拽」的累计位移阈值（px）——与 dsh-pet 的 `DRAG_THRESHOLD` 同量级。 */
const DRAG_START_THRESHOLD = 8

/** 判定方向的水平位移阈值（px），滤除拖拽起步的抖动。 */
const DRAG_DIRECTION_THRESHOLD = 3

export interface PetDragOptions {
  /**
   * 拖动边界容器（通常是舞台）：给了它 `useDraggable` 会把位置夹在容器内，
   * 宠物不会被拖出舞台。
   */
  containerRef?: RefObject<HTMLElement | null>
  /** 起拖时取消宿主当前飞行。 */
  onStart?: () => void
  /** 真拖动后的 pointerup；取消手势、单击不发松手请求。 */
  onRelease?: (trail: readonly DragSample[], now: number) => void
}

export interface PetDragResult {
  /** 绑到拖拽容器的 ref（`useDraggable` 的 target：被移动的元素） */
  boxRef: RefObject<HTMLDivElement | null>
  /** 绑到组件 `hitboxRef`（`useDraggable` 的 handle：只有命中箱能起拖） */
  handleRef: RefObject<HTMLDivElement | null>
  /** 位置（来自 `useDraggable` 的 `x` / `y`） */
  x: number
  y: number
  /** 宿主飞行与拖拽共用同一份位置。 */
  setPosition: (position: { x: number, y: number }) => void
  /**
   * 拖动会话进行中。**超过位移阈值才为 true**（与参考实现一致）：单击/抖动不算拖拽，
   * 不会播放「被抓起」动画。组件把它接到 `dragging` prop 上。
   */
  dragging: boolean
  /** 当前拖动方向；未拖动 / 位移不足时为 `undefined` */
  direction: DragDirection | undefined
  /** 命中箱按下会话进行中（单击也包含），用于按下反馈 */
  pressed: boolean
  /** 命中箱的 pointerdown（接到组件的 `onHitboxPointerDown`） */
  onHitboxPointerDown: () => void
  onHitboxPointerUp: () => void
  reset: () => void
}

/**
 * Playground 的宠物拖拽 —— 机械部分交给 reause 的 `useDraggable`
 * （VueUse `useDraggable` 的 React 移植：target 被移动、handle 起拖、
 * draggingElement 收 `pointermove` / `pointerup`），这里只补两件它不管的手势语义：
 *
 * 1. **位移阈值**：`useDraggable` 在 `pointerdown` 就进入拖动态，而桌宠要求累计位移
 *    超过阈值才算拖动（单击不播「被抓起」动画，与 dsh-pet / deepseek-harness-desktop 一致）；
 * 2. **方向采样**：逐次 `dx` 过阈值才更新方向。
 *
 * 双击（点击回应）是 `<Pet>` 的内置行为，不在这里判定。
 *
 * 手势结果（`dragging` / `direction`）不掺协议：dsh-pet 用它播 `animations.drag` 的悬浮，
 * Codex 用它播左右行走行。
 */
export function usePetDrag({ containerRef, onStart: onDragStart, onRelease }: PetDragOptions = {}): PetDragResult {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)

  const [dragging, setDragging] = useState(false)
  const [direction, setDirection] = useState<DragDirection | undefined>(undefined)
  const [pressed, setPressed] = useState(false)

  /** 本次按下会话是否已经真的拖动过（决定后续移动是否还要过阈值） */
  const engagedRef = useRef(false)
  const startRef = useRef<{ x: number, y: number } | null>(null)
  const lastXRef = useRef<number | undefined>(undefined)
  const trailRef = useRef<DragSample[]>([])

  const onStart: UseDraggableOptions['onStart'] = useCallback((_position, event) => {
    onDragStart?.()
    engagedRef.current = false
    // useDraggable 的 onStart 给的是抓取偏移，不是位置；阈值用同一套 client 坐标。
    startRef.current = { x: event.clientX, y: event.clientY }
    lastXRef.current = undefined
    const box = boxRef.current
    trailRef.current = [{ t: event.timeStamp, x: box?.offsetLeft ?? 0, y: box?.offsetTop ?? 0 }]
    setDragging(false)
    setDirection(undefined)
    setPressed(true)
  }, [onDragStart])

  const onMove: UseDraggableOptions['onMove'] = useCallback((position, event) => {
    const start = startRef.current
    if (start === null)
      return

    // 采样的是容器夹取后的实际位置，不把越界的指针距离当作甩动速度。
    const trail = trailRef.current
    trail.push({ t: event.timeStamp, ...position })
    while (trail.length > 1 && trail[0]!.t < event.timeStamp - 200)
      trail.shift()

    // 未达阈值：单击 / 抖动都不算拖拽
    if (!engagedRef.current) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_START_THRESHOLD)
        return
      engagedRef.current = true
      setDragging(true)
      lastXRef.current = position.x
      return
    }

    const lastX = lastXRef.current
    lastXRef.current = position.x
    if (lastX === undefined)
      return
    const stepX = position.x - lastX
    if (Math.abs(stepX) >= DRAG_DIRECTION_THRESHOLD)
      setDirection(stepX > 0 ? 'right' : 'left')
  }, [])

  const onEnd: UseDraggableOptions['onEnd'] = useCallback((_position, event) => {
    const release = engagedRef.current && event.type === 'pointerup'
    const trail = trailRef.current
    trailRef.current = []
    engagedRef.current = false
    startRef.current = null
    lastXRef.current = undefined
    setDragging(false)
    setDirection(undefined)
    setPressed(false)
    if (release)
      onRelease?.(trail, event.timeStamp)
  }, [onRelease])

  const { x, y, setX, setY } = useDraggable(boxRef, {
    handle: handleRef,
    // 给了容器就夹在容器内（`useDraggable` 的 restrictInView 语义），宠物不会被拖出舞台
    containerElement: containerRef,
    initialValue: { x: 0, y: 0 },
    onStart,
    onMove,
    onEnd,
  })

  const onHitboxPointerDown = useCallback(() => setPressed(true), [])
  const onHitboxPointerUp = useCallback(() => setPressed(false), [])
  const setPosition = useCallback((position: { x: number, y: number }) => {
    setX(position.x)
    setY(position.y)
  }, [setX, setY])

  const reset = useCallback(() => setPosition({ x: 0, y: 0 }), [setPosition])

  return {
    boxRef,
    handleRef,
    x,
    y,
    setPosition,
    dragging,
    direction,
    pressed,
    onHitboxPointerDown,
    onHitboxPointerUp,
    reset,
  }
}
