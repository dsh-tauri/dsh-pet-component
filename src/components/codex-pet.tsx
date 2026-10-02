import type { CSSProperties } from 'react'
import type { CodexPetConfig, CodexPetProps, PetAnimationInfo, PetConfigSource, PetRenderMotion } from '../types'
import { useEventListener, usePreferredReducedMotion } from '@reause/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CODEX_DEFAULT_SIZE,
  CODEX_FRAME_HEIGHT,
  CODEX_FRAME_WIDTH,
  CODEX_LOOK_RADIUS_FACTOR,
  CODEX_MOTION_ACTION,
  isCodexLookSupported,
  resolveCodexColumns,
  resolveCodexFrame,
  resolveCodexRows,
  resolveLookIndex,
  resolvePetSize,
} from '../config'
import { useCachedMediaUrl } from '../hooks/use-cached-media'
import { useConfig } from '../hooks/use-config'
import { usePetMotion } from '../hooks/use-pet-motion'
import { useSpritePlayer } from '../hooks/use-sprite-player'
import { mountPetStyles } from '../styles'
import { useIsomorphicLayoutEffect } from '../utils/react'

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/**
 * 雪碧图地址解析：
 * 1. 显式 `uri` 优先；
 * 2. `config.spritesheetPath` + 配置文件所在目录（`pet.json` 的相对路径语义）；
 * 3. 都没有 → 只在对象配置下退化为相对路径。
 */
function resolveSpritesheetUrl(
  uri: string | undefined,
  source: PetConfigSource,
  config: CodexPetConfig | null,
): string | null {
  if (uri !== undefined && uri !== '')
    return uri
  const relative = config?.spritesheetPath
  if (relative === undefined || relative === '')
    return null
  if (typeof source !== 'string')
    return relative
  const base = source.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '')
  return `${base}/${relative.replace(/^\/+/, '')}`
}

/**
 * **Codex 精灵图渲染器** —— 单张 8 列雪碧图，每行一个动作（格子 192×208，
 * 9 行 v1 / 11 行 v2）。
 *
 * v2 图集支持**鼠标追踪 look 格**（行 9-10 共 16 格）：`idle` 循环期间指针移动时
 * 暂停帧推进、改画对应方向的 look 格，指针进入死区即恢复待机帧。
 *
 * 拖动（`dragging`）按方向落到左右行走行 —— 图集没有专门的拖拽悬浮行，
 * 左右行走就是 Codex 协议表达「被拖着走」的方式。
 *
 * ```tsx
 * <CodexPet
 *   size={192}
 *   config="/pets/nastya/pet.json"
 *   uri="/pets/nastya/spritesheet.webp"
 *   motion={{ type: dragging ? 'moving-left' : 'idle', loop: true }}
 *   dragging={isDragging}
 * />
 * ```
 */
export function CodexPet(props: CodexPetProps) {
  const {
    size,
    config: configSource,
    uri,
    motion,
    dragging = false,
    cache = true,
    hitboxRef,
    onHitboxPointerDown,
    onHitboxPointerMove,
    onHitboxPointerUp,
    onHitboxPointerCancel,
    mirrored,
    hidden,
    className,
    style,
    lookAtPointer = true,
    lookDeadzone = 24,
    lookRadius,
    onMotionChange,
    onAnimationChange,
    onReady,
    onError,
    ref,
  } = props

  useIsomorphicLayoutEffect(() => {
    mountPetStyles()
  }, [])

  const { config, error: configError } = useConfig<CodexPetConfig>(configSource)
  const { state, finish } = usePetMotion({ motion, ref, onMotionChange, dragging })
  // 减少动效跟随系统偏好（`prefers-reduced-motion`，reause 的媒体查询 hook）
  const reducedMotion = usePreferredReducedMotion() === 'reduce'

  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (configError !== null)
      onErrorRef.current?.(configError)
  }, [configError])

  /* --------------------------------- 几何 ---------------------------------- */

  const columns = resolveCodexColumns(config)
  const rows = resolveCodexRows(config)
  const cellWidth = config?.frameWidth ?? CODEX_FRAME_WIDTH
  const cellHeight = config?.frameHeight ?? CODEX_FRAME_HEIGHT
  // 默认基准是「一半」（`CODEX_DEFAULT_SIZE`）：图集格子里人物基本铺满，而 dsh-pet 的
  // 16:9 视频画布里人物只占中间一块 —— 同样宽度下 Codex 会大出约一倍。
  const width = resolvePetSize({ size, config, fallbackSize: CODEX_DEFAULT_SIZE })
  const height = width * (cellHeight / cellWidth)

  // 手势态优先：图集没有专门的拖拽行，拖动时按方向落到左右行走行 ——
  // `motion` 给了方向就用，否则回落 moving-right（与参考实现 spriteAction 的 dragging 回落一致）。
  // 这正是「Codex 协议靠左右动画表达拖动」的地方（dsh-pet 那边则是悬浮，不用左右）。
  const renderMotion: PetRenderMotion = dragging
    ? (state.type === 'moving-left' || state.type === 'moving-right' ? state.type : 'moving-right')
    : state.type

  // 帧定义只由动作与配置决定；「强制重播要回到第 0 帧」由 useSpritePlayer 的 revision 依赖负责
  const frame = useMemo(
    () => resolveCodexFrame(renderMotion, config),
    [config, renderMotion],
  )

  /* --------------------------------- 资源 ---------------------------------- */

  const spritesheetUrl = resolveSpritesheetUrl(uri, configSource, config)
  const src = useCachedMediaUrl(spritesheetUrl, cache, onError)

  useEffect(() => {
    // 图集是普通图片：加载完成/失败都通过一次性 Image 探测上报（不额外挂可见元素）。
    // 回调走 ref —— 消费方常写成内联箭头函数，直接进依赖会让探测每渲染重跑一次
    // （极端情况下 onReady 里 setState 会形成「渲染 → 探测 → onReady → 渲染」的环）。
    if (src === null)
      return undefined
    const image = new Image()
    const handleLoad = () => onReadyRef.current?.()
    const handleError = () => onErrorRef.current?.(new Error(`Failed to load pet spritesheet: ${src}`))
    image.addEventListener('load', handleLoad)
    image.addEventListener('error', handleError)
    image.src = src
    return () => {
      image.removeEventListener('load', handleLoad)
      image.removeEventListener('error', handleError)
    }
  }, [src])

  /* ------------------------------ 鼠标追踪 look ----------------------------- */

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [lookIndex, setLookIndex] = useState<number | undefined>(undefined)

  const lookSupported = lookAtPointer
    && !reducedMotion
    && !dragging
    && state.type === 'idle'
    && state.loop
    && isCodexLookSupported(config)

  // 监听交给 reause 的 `useEventListener`（默认目标就是 window，SSR 安全）：
  // 不用自己维护 add / remove 与依赖重绑；`lookSupported` 不成立时回调直接返回，
  // 所以关掉 look / 非 idle / 减少动效时不会产生任何额外渲染。
  const lookSupportedRef = useRef(lookSupported)
  lookSupportedRef.current = lookSupported
  const lookDeadzoneRef = useRef(lookDeadzone)
  lookDeadzoneRef.current = lookDeadzone
  const lookRadiusRef = useRef(lookRadius)
  lookRadiusRef.current = lookRadius

  useEventListener('pointermove', (event: PointerEvent) => {
    if (!lookSupportedRef.current)
      return
    const element = containerRef.current
    if (element === null)
      return
    const rect = element.getBoundingClientRect()
    const offsetX = event.clientX - (rect.left + rect.width / 2)
    const offsetY = event.clientY - (rect.top + rect.height / 2)
    // 作用半径：指针离宠物太远就直接回到待机帧。旧实现没有上界，指针停在屏幕任何角落都会
    // 把宠物钉在一个 look 格上，`pointermove` 之后再也不回 idle。
    const radius = lookRadiusRef.current ?? Math.max(rect.width, rect.height) * CODEX_LOOK_RADIUS_FACTOR
    if (Math.hypot(offsetX, offsetY) > radius) {
      // 同值更新会被 React 跳过，不会造成额外渲染
      setLookIndex(undefined)
      return
    }
    setLookIndex(resolveLookIndex({ x: offsetX, y: offsetY }, lookDeadzoneRef.current))
  }, { passive: true })

  // 指针离开整窗（`pointerout` 且无 relatedTarget）或窗口失焦时也回到待机：
  // 这两条路之后不会再收到 pointermove，不主动清就会把最后一格 look 永久留在画面上。
  useEventListener('pointerout', (event: PointerEvent) => {
    if (event.relatedTarget === null)
      setLookIndex(undefined)
  }, { passive: true })
  useEventListener('blur', () => setLookIndex(undefined), { passive: true })

  // 不支持的场合（v1 图集 / 非 idle / 减少动效）直接忽略 last look，无需回到 effect 里清状态
  const effectiveLookIndex = lookSupported ? lookIndex : undefined

  /* --------------------------------- 帧播放 -------------------------------- */

  const spriteRef = useRef<HTMLDivElement | null>(null)
  useSpritePlayer({
    elementRef: spriteRef,
    frame,
    columns,
    rows,
    revision: state.revision,
    reducedMotion,
    lookIndex: effectiveLookIndex,
    onFinish: finish,
  })

  /* -------------------------------- 动画信息回调 ------------------------------ */

  const animationInfo = useMemo<PetAnimationInfo | null>(() => ({
    name: CODEX_MOTION_ACTION[renderMotion],
    once: !frame.loop,
    src,
    row: frame.row,
  }), [frame.loop, frame.row, renderMotion, src])

  useIsomorphicLayoutEffect(() => {
    onAnimationChange?.(animationInfo)
  }, [animationInfo, onAnimationChange])

  /* ---------------------------------- 渲染 ---------------------------------- */

  const spriteStyle: CSSProperties = {
    backgroundImage: src === null ? undefined : `url("${src}")`,
    // 百分比铺满：格子像素尺寸与容器尺寸解耦
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    transform: mirrored ? 'scaleX(-1)' : undefined,
  }

  const rootStyle: CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    ...style,
  }

  return (
    <div
      ref={containerRef}
      className={joinClassNames('dsh-pet', hidden && 'dsh-pet--hidden', className)}
      data-motion={renderMotion}
      data-row={frame.row}
      data-look={effectiveLookIndex}
      style={rootStyle}
    >
      <div ref={spriteRef} className="dsh-pet__sprite" style={spriteStyle} />
      <div
        ref={hitboxRef}
        className="dsh-pet__hitbox"
        style={{ left: '25%', top: '10%', width: '50%', height: '85%' }}
        onPointerDown={onHitboxPointerDown}
        onPointerMove={onHitboxPointerMove}
        onPointerUp={onHitboxPointerUp}
        onPointerCancel={onHitboxPointerCancel}
      />
    </div>
  )
}
