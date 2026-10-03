import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref, RefObject } from 'react'
import type { CodexPetConfig, DshPetConfig, MotionInput, PetBubble, PetBubbleHandle, PetConfig, PetGeometry, PetPhysicsEvent, PetProps, PetRef, PetVelocity } from '../types'
import { useElementSize } from '@reause/core'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { detectPetKind, dshEventPool, PET_DEFAULT_EXT, resolveMutteringPlan, resolvePhysics, selectPetEntry } from '../config'
import { useConfig } from '../hooks/use-config'
import { useControllablePet } from '../hooks/use-controllable-pet'
import { useDoubleClick } from '../hooks/use-double-click'
import { useMuttering } from '../hooks/use-muttering'
import { usePetBubbles } from '../hooks/use-pet-bubbles'
import { usePetSquash } from '../hooks/use-pet-squash'
import { motionKey } from '../utils/bubble'
import { resolveAssetUrl, resolvePlatformValue, resolveSpritesheetUrl } from '../utils/env'
import { PetBubbleLayer } from './bubble-layer'
import { CodexPet } from './codex-pet'
import { DshPet } from './dsh-pet'

/** 碎碎念气泡的固定 key：同一时刻只有一句碎碎念，重复触发=原地换句（不重新淡入）。 */
const MUTTERING_BUBBLE_ID = 'dsh-pet-muttering'

/** 外壳样式：自定义属性（`--dsh-pet-size`）在 `CSSProperties` 里没有位置，单独声明。 */
type ShellStyle = CSSProperties & Record<`--${string}`, string>

/**
 * 合并 ref：宿主的 ref 原样转发（对象 ref 与回调 ref 都支持、回调返回的清理函数也照传），
 * 同时把同一个命令面句柄留在内部 ref 上 —— 内置双击要用它下发 `waving`。
 *
 * 这样 `<Pet config uri />` 不传 ref 时双击同样有效，传了 ref 的宿主也不受影响。
 */
function useMergedRef(hostRef: Ref<PetRef | null> | undefined, innerRef: RefObject<PetRef | null>): Ref<PetRef | null> {
  return useCallback((node: PetRef | null) => {
    innerRef.current = node
    if (typeof hostRef === 'function') {
      const cleanup = hostRef(node)
      if (typeof cleanup === 'function') {
        return () => {
          innerRef.current = null
          cleanup()
        }
      }
      return
    }
    if (hostRef !== null && hostRef !== undefined)
      (hostRef as RefObject<PetRef | null>).current = node
  }, [hostRef, innerRef])
}

/**
 * **桌宠统一入口** —— 按 `config` / `uri` 自动判定渲染器，也可以 `kind` 强制指定。
 *
 * 判定规则（见 `detectPetKind`）：
 * - dsh-pet `config.jsonc`（有 `animations` / `pets` / …）→ `DshPet`（透明视频）
 * - Codex `pet.json`（有 `spriteVersionNumber` / `spritesheetPath` / …）→ `CodexPet`（雪碧图集）
 * - 两种都像或都不像时看 `uri`：图片扩展名 = Codex，`{ default, mac }` 对象 = dsh-pet
 *
 * 配置加载在这里统一做（URL 形态先拉一次），所以判定发生在拿到真实配置之后，
 * 不会因为「猜错渲染器」而闪一下。
 *
 * **公开命令面只有这一处**（`PetRef`）：渲染器内部只写 `motion` / `clear` / `current`，
 * 本层组合气泡、碎碎念与宿主物理请求 ——
 * 一个 ref 只能被一处 `useImperativeHandle` 写，而两个渲染器都不需要知道「气泡」这件事。
 *
 * ```tsx
 * const petRef = useRef<PetRef>(null)
 * const pet = useControllablePet(petRef)
 *
 * pet.motion({ type: 'thinking', loop: true })
 * pet.bubble({ id: 's1', title: '会话', description: '正在处理', loading: true, motion: 'thinking' })
 * pet.bubble({ id: 's1', description: '已完成', loading: false, motion: 'success' })  // 原地更新
 * pet.muttering('今天风好大')
 *
 * return (
 *   <Pet
 *     ref={petRef}
 *     config="/pets/main/config.jsonc"
 *     uri={{ default: '/pets/main/webm' }}
 *     muttering
 *     onMuttering={(prompt, { meme }) => { …生成后 pet.muttering(text, …) 推回 }}
 *   />
 * )
 * ```
 *
 * **单击/双击是内置行为**：命中框上两次按下间隔小于 `DOUBLE_CLICK_MS` 即插播一次
 * `waving`（dsh-pet 取 `animations.clicks` 池，Codex 走 `waving` 行），宿主不必自己判定；
 * 判定挂在你传入的 `onHitboxPointerDown` 之外，宿主自己的指针回调照常收到事件。
 *
 * **气泡层的定位**：`Pet` 自己套一层 `.dsh-pet-shell`（inline-block，不改变宿主布局），
 * 渲染器与气泡层都在其中；`--dsh-pet-size` 由实测宽度写在壳体上，气泡据此等比缩放。
 * 也就是说气泡只存在于这一层 —— `DshPet` / `CodexPet` 里没有任何气泡逻辑。
 */
export function Pet(props: PetProps) {
  const {
    kind,
    config,
    uri,
    ext,
    lookAtPointer,
    lookDeadzone,
    lookRadius,
    ref,
    motion,
    physics,
    onFling,
    onBounce,
    muttering,
    mutteringPrompt,
    mutteringIntervalSec,
    mutteringImmediate,
    mutteringImage,
    mutteringDuration,
    mutteringMotion,
    onMuttering,
    ...common
  } = props
  const { config: loaded, error } = useConfig<PetConfig>(config)
  const { onError } = common

  /* --------------------------------- 句柄基础 -------------------------------- */

  // 渲染器只写 `motionRef`（`usePetMotion` 的 `useImperativeHandle`），公开句柄在下面组合
  const shellRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<PetRef | null>(null)
  const motionRef = useRef<PetRef | null>(null)
  const mergedRef = useMergedRef(ref, innerRef)
  const pet = useControllablePet(innerRef)
  const { squash, stopSquash } = usePetSquash(shellRef, common.dragging === true)

  useEffect(() => {
    if (error !== null)
      onError?.(error)
  }, [error, onError])

  // 地址形态的配置还在路上时，先用原始 source 交给子渲染器（配置缓存会去重，不会重复拉）
  const resolved = loaded ?? config
  const resolvedKind = kind ?? detectPetKind(loaded, uri)
  // 使用实际资源的标量地址；等价的内联配置/平台映射重建不能截断 220ms 反馈。
  // 动作换帧/视频切换沿用反馈，仅换素材基址/扩展名、渲染器或隐藏才取消。
  const mediaSource = resolvedKind === 'codex'
    ? resolveSpritesheetUrl(typeof uri === 'string' ? uri : uri?.default, resolved, loaded as CodexPetConfig | null)
    : resolveAssetUrl(
        typeof uri === 'string' ? uri : resolvePlatformValue(uri ?? { default: '' }),
        '__pet_source__',
        resolvePlatformValue(ext ?? PET_DEFAULT_EXT),
      )
  useEffect(() => {
    stopSquash()
  }, [resolvedKind, mediaSource, common.hidden, stopSquash])
  // 碎碎念与配图是 dsh-pet 协议的字段（Codex 图集没有 whisper 行）
  const dshConfig = loaded !== null && resolvedKind === 'dsh' ? loaded as DshPetConfig : null
  const petEntry = useMemo(() => (dshConfig === null ? null : selectPetEntry(dshConfig)), [dshConfig])
  const whisperPool = useMemo(() => dshEventPool(dshConfig?.animations, 'whisper'), [dshConfig])

  /** 下发动作（捆绑动画与回落都走它；`motionRef` 由渲染器写入） */
  const motionRequest = useCallback((input: MotionInput) => {
    motionRef.current?.motion(input)
  }, [])
  /** 清除动作，回落 `motion` prop */
  const motionClear = useCallback(() => {
    motionRef.current?.clear()
  }, [])

  /* --------------------------------- 宿主物理 -------------------------------- */

  const readGeometry = useCallback((): PetGeometry | null => {
    // 只测 renderer 与 hitbox：壳体可能含气泡，绝对定位的宠物也可能完全移出壳体布局。
    const root = shellRef.current?.querySelector<HTMLElement>('.dsh-pet')
    const hitbox = root?.querySelector<HTMLElement>('.dsh-pet__hitbox')
    if (!root || !hitbox)
      return null
    const box = root.getBoundingClientRect()
    const body = hitbox.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0 || body.width <= 0 || body.height <= 0)
      return null
    return {
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      body: { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
    }
  }, [])

  const requestPhysics = useCallback((listener: ((event: PetPhysicsEvent) => void) | undefined, velocity: PetVelocity) => {
    if (!listener || !Number.isFinite(velocity?.vx) || !Number.isFinite(velocity?.vy))
      return
    const geometry = readGeometry()
    if (geometry !== null)
      listener({ vx: velocity.vx, vy: velocity.vy, geometry, physics: resolvePhysics(dshConfig?.physics, physics) })
  }, [dshConfig, physics, readGeometry])

  /* ---------------------------------- 气泡 --------------------------------- */

  /** 气泡命令面（`dismissMuttering` 在回调里用它关掉闲聊那条） */
  const bubbleHandleRef = useRef<PetBubbleHandle | null>(null)

  /**
   * 状态气泡优先于碎碎念：起了会话状态就把闲聊那条收掉，而不是让它叠在后面继续挂着。
   * 碎碎念的动画不受影响 —— 它走渲染器的插播通道，会自然播完。
   */
  const dismissMuttering = (bubble: PetBubble) => {
    if (bubble.kind !== 'muttering')
      bubbleHandleRef.current?.close(MUTTERING_BUBBLE_ID)
  }

  const { bubbles, motion: bubbleMotion, handle: bubbleHandle } = usePetBubbles({
    onShow: dismissMuttering,
    onUpdate: dismissMuttering,
  })

  bubbleHandleRef.current = bubbleHandle

  /**
   * 常驻气泡聚合出的动作 —— **声明式**交给渲染器的 `motion` prop，对齐参考实现
   * （`app.tsx` 的 `motion={dragging ? moving-* : bubble.motion}`）。
   *
   * 聚合（多会话优先级、100ms 合并窗口）全在 `src/utils/bubble-tracker.ts` 里，且**只聚合
   * `timeout: 0` 的常驻气泡** —— 所以限时气泡到点收起时，`motion` prop 不会变，
   * 正在播的动画也就不会被掐断。
   */
  /**
   * **限时气泡**（`timeout > 0`）的动画走**命令面**播一次 —— 与气泡生命周期彻底解耦：
   * 气泡到点自己收，动画自己播完，谁都不去掐它。
   *
   * 同一个 id 只在「新建 / 换档位」时重放，所以原地更新文字不会打断动画。
   * 常驻气泡（`timeout: 0`）不走这里，而是走下面的声明式 `motion` prop —— 状态在，动画就在。
   */
  const transientFiredRef = useRef(new Map<string, string>())
  useEffect(() => {
    const fired = transientFiredRef.current
    for (const bubble of bubbles) {
      const input = bubble.motion
      if (input === undefined || bubble.duration <= 0)
        continue
      const token = `${bubble.created}:${motionKey(input) ?? ''}`
      if (fired.get(bubble.id) === token)
        continue
      fired.set(bubble.id, token)
      motionRequest(typeof input === 'string' ? { type: input, replay: true } : { ...input, replay: true })
    }
    for (const id of [...fired.keys()]) {
      if (!bubbles.some(bubble => bubble.id === id))
        fired.delete(id)
    }
  }, [bubbles, motionRequest])

  const effectiveMotion = bubbleMotion ?? motion

  // 有气泡处于加载态时**自动**碎碎念挂起（别让后台碎碎念打断正在跑的会话）；
  // 手动 `pet.muttering(...)` / `request()` 不受影响（对齐 dsh-pet：whisperEnabled 只关自动轮询）
  const mutteringSuspended = bubbles.some(bubble => bubble.loading)

  // 气泡全部尺寸以宠物**实测宽度**等比缩放（`--dsh-pet-size`）：实测而不是按配置推算，
  // 这样宿主的 `size` / 配置 / CSS 覆盖最终都落在同一个基准上
  const { width } = useElementSize(shellRef)

  /* --------------------------------- 碎碎念 -------------------------------- */

  const plan = useMemo(() => resolveMutteringPlan({
    config: dshConfig,
    entry: petEntry,
    enabled: muttering,
    prompt: mutteringPrompt,
    intervalSec: mutteringIntervalSec,
    immediate: mutteringImmediate,
    image: mutteringImage,
    duration: mutteringDuration,
  }), [dshConfig, petEntry, muttering, mutteringDuration, mutteringImage, mutteringImmediate, mutteringIntervalSec, mutteringPrompt])

  /** 按动画名的一次性插播（dsh 渲染器专用通道，见 `DshPetProps.adHocAnimation`） */
  const [adHocAnimation, setAdHocAnimation] = useState<{ name: string, seq: number } | null>(null)
  const adHocSeqRef = useRef(0)
  /** 气泡队列的镜像：渲染器回调里要读最新队列，而那个回调的身份必须稳定（见下） */
  const bubblesRef = useRef<readonly PetBubble[]>(bubbles)
  bubblesRef.current = bubbles
  /** 渲染器上一次回报的动画：用来判断「一次性动画播完了」 */
  const lastAnimationRef = useRef<{ name?: string, once?: boolean } | null>(null)

  /**
   * 渲染器回报的动画变化：**一次性动画播完，就收掉驱动它的那条气泡**。
   *
   * 一次性动画的来源有两种：碎碎念插播（`events.whisper` 里那一段）与终态档
   * （`success` / `failed` / `error` / `review`）的一次性动作。它们播完时渲染器会把动画换掉，
   * 这一刻气泡跟着收 —— 于是不会再出现「气泡还挂着、动画先没了」（用户报告），
   * 也不会出现「气泡比动画多赖几秒」。碎碎念的 `mutteringDuration` 与终态档时长退化成
   * 硬上限（动画没播出来的场合由它们兜底）。
   *
   * 用 `useCallback` 钉住身份：渲染器把它放进了 effect 依赖，每次渲染换新函数会让它每帧
   * 回报一次（宿主若在回调里 setState 就会自激）。
   */
  const hostAnimationChange = common.onAnimationChange
  const handleAnimationChange = useCallback((info: Parameters<NonNullable<PetProps['onAnimationChange']>>[0]) => {
    const previous = lastAnimationRef.current
    lastAnimationRef.current = info === null ? null : { name: info.name, once: info.once }
    if (previous?.once === true && info?.name !== previous.name) {
      const current = bubblesRef.current
      // **只收碎碎念那条** —— 它本来就该跟插播动画同长。
      // 终态档（success / failed / error / review）**不跟着动画收**：它们由自己的时长 / 脉冲窗口
      // 管着；绑到「动画播完」会让「更新为失败」的气泡在动画一播完就消失，4s 阅读时间白给
      // （成功那条只是碰巧动画长度≈3s，才看不出问题）。
      if (current.some(bubble => bubble.id === MUTTERING_BUBBLE_ID))
        bubbleHandleRef.current?.close(MUTTERING_BUBBLE_ID)
    }
    hostAnimationChange?.(info)
  }, [hostAnimationChange])

  const { handle: mutteringHandle } = useMuttering({
    enabled: plan.enabled,
    prompt: plan.prompt,
    intervalSec: plan.intervalSec,
    immediate: plan.immediate,
    petId: plan.petId,
    duration: plan.duration,
    image: plan.image,
    memes: dshConfig?.memes,
    whisperPool,
    suspended: mutteringSuspended,
    onMuttering,
    // 碎碎念动画：dsh 取 `animations.events.whisper` 整池里的一段动画名（不属于 14 个动作，
    // 走渲染器的一次性插播通道）；池为空（Codex 图集 / 配置没写）时回落 `mutteringMotion`
    onPlay: (name) => {
      if (name === undefined) {
        const fallback = mutteringMotion ?? 'waving'
        motionRequest(typeof fallback === 'string'
          ? { type: fallback, replay: true }
          : { ...fallback, replay: true })
        return
      }
      adHocSeqRef.current += 1
      setAdHocAnimation({ name, seq: adHocSeqRef.current })
    },
    onShow: (text, options) => {
      // 说话优先于状态展示：先把状态气泡清掉（碎碎念就是「此时插一句话」），再挂碎碎念那条 ——
      // 否则它只能叠在状态气泡后面等对方先超时；清掉之后动作自动回落待机，插播动画才有位置播
      bubbleHandle.clear()
      bubbleHandle({
        id: MUTTERING_BUBBLE_ID,
        kind: 'muttering',
        // 碎碎念是「说话」：文字走 title（`--muttering` 只是让宽度贴文字），且不占图标位
        title: text,
        image: options.image,
        timeout: options.duration,
        placement: 'top',
      })
    },
  })

  /* --------------------------------- 公开句柄 -------------------------------- */

  const handle = useMemo<PetRef>(() => ({
    motion: motionRequest,
    clear: motionClear,
    get current() {
      return motionRef.current?.current ?? 'idle'
    },
    fling: velocity => requestPhysics(onFling, velocity),
    bounce: velocity => requestPhysics(onBounce, velocity),
    squash,
    stopSquash,
    get geometry() {
      return readGeometry()
    },
    bubble: bubbleHandle,
    muttering: mutteringHandle,
  }), [bubbleHandle, motionClear, motionRequest, mutteringHandle, onBounce, onFling, readGeometry, requestPhysics, squash, stopSquash])

  useImperativeHandle(mergedRef, () => handle, [handle])

  /* --------------------------------- 点击回应 -------------------------------- */

  // 命中框上连按两次 → 插播一次 waving（`replay` 不能省，否则同动作会被去重）；
  // 拖动会话会作废判定窗口，所以「拖一下再快速点一下」不算双击
  const onDoubleClick = useDoubleClick(
    () => pet.motion({ type: 'waving', replay: true }),
    { interrupted: common.dragging === true },
  )

  // 松手监听只依赖稳定的 reset，不能随按下后的双击窗口变化而重绑/漏掉 pointerup。
  const resetDoubleClick = onDoubleClick.reset

  // 全局收尾：指针离开 hitbox 后松开也能结束；取消/拖动/右键不产生点击挤压。
  const pressRef = useRef<{ id: number, x: number, y: number, moved: boolean } | null>(null)
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const press = pressRef.current
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 5) {
        press.moved = true
        resetDoubleClick()
      }
    }
    const end = (event: PointerEvent) => {
      const press = pressRef.current
      if (press?.id !== event.pointerId)
        return
      pressRef.current = null
      if (event.type === 'pointercancel') {
        resetDoubleClick()
        stopSquash()
      }
      if (event.type === 'pointerup' && !press.moved && !common.dragging
        && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) {
        squash()
      }
    }
    const abort = () => {
      pressRef.current = null
      resetDoubleClick()
      stopSquash()
    }
    const lost = (event: PointerEvent) => {
      if (pressRef.current?.id === event.pointerId)
        abort()
    }
    window.addEventListener('blur', abort)
    window.addEventListener('lostpointercapture', lost)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    return () => {
      window.removeEventListener('blur', abort)
      window.removeEventListener('lostpointercapture', lost)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
  }, [common.dragging, resetDoubleClick, squash, stopSquash])

  const onHitboxPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && event.isPrimary !== false
      && (pressRef.current === null || pressRef.current.id === event.pointerId)) {
      stopSquash()
      pressRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      onDoubleClick()
    }
    common.onHitboxPointerDown?.(event)
  }

  /* ---------------------------------- 渲染 --------------------------------- */

  const shellStyle: ShellStyle | undefined = width > 0 ? { '--dsh-pet-size': `${width}px` } : undefined
  // 宠物被 `hidden` 藏起来时气泡一起藏（气泡长在它身上）
  const bubbleLayer = common.hidden === true ? null : <PetBubbleLayer bubbles={bubbles} />

  if (resolvedKind === 'codex') {
    return (
      <div ref={shellRef} className="dsh-pet-shell" style={shellStyle}>
        <CodexPet
          {...common}
          motion={effectiveMotion}
          ref={motionRef}
          onAnimationChange={handleAnimationChange}
          onHitboxPointerDown={onHitboxPointerDown}
          config={resolved as CodexPetConfig}
          uri={typeof uri === 'string' ? uri : uri?.default}
          lookAtPointer={lookAtPointer}
          lookDeadzone={lookDeadzone}
          lookRadius={lookRadius}
        />
        {bubbleLayer}
      </div>
    )
  }
  return (
    <div ref={shellRef} className="dsh-pet-shell" style={shellStyle}>
      <DshPet
        {...common}
        motion={effectiveMotion}
        ref={motionRef}
        adHocAnimation={adHocAnimation}
        onAnimationChange={handleAnimationChange}
        onHitboxPointerDown={onHitboxPointerDown}
        config={resolved as DshPetConfig}
        uri={typeof uri === 'string' ? { default: uri } : (uri ?? { default: '' })}
        ext={ext}
      />
      {bubbleLayer}
    </div>
  )
}
