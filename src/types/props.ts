import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from 'react'
import type { PetBubbleHandle, PetMutteringHandle, PetMutteringHandler } from './bubble'
import type { PhysicsParams } from './config'
import type { MotionInput, PetRenderMotion } from './motion'

/**
 * 命中箱（hitbox）—— 与 dsh-pet 的 `.dsh-pet-hit` 同语义：**整个视频/图集盒子不响应
 * 指针事件，只有宠物身体那一块响应**。可交互面收缩到 `hitboxRef` 指向的元素上，
 * 调用方（拖拽 hook / 点击计数）自行绑定；组件只负责摆放与事件透传。
 */
export interface PetHitboxProps {
  /** 点击碰撞箱 Ref */
  hitboxRef?: Ref<HTMLDivElement>
  /** Hitbox 指针事件绑定 */
  onHitboxPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  /** 拖拽采样；出命中箱仍要接收事件时，宿主自行 setPointerCapture 或监听全局 move。 */
  onHitboxPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onHitboxPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onHitboxPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * 实际播放中的动画信息（`onAnimationChange` / `onAnimationPlay` 的回参）。
 *
 * 两个渲染器各自能提供的信息不同，这里统一成同一个形状：
 * - dsh-pet：`name` 是动画名（资源文件名主名），`row` 为 `undefined`；
 * - Codex：`name` 是图集动作名（Codex 契约名，如 `runningRight`），`row` 是图集行号。
 */
export interface PetAnimationInfo {
  /** 动画标识（见上方说明；解析不到任何动画时为 `null`，整个回参也会是 `null`） */
  name: string
  /** 是否播放一次（`false` = 循环） */
  once: boolean
  /** 资源地址：dsh = 视频 URL；codex = 雪碧图 URL */
  src: string | null
  /** Codex：图集行号 */
  row?: number
  /** Codex：图集列（当前帧） */
  column?: number
}

/** 最终速度（CSS px/s）：+x 向右，+y 向下；不再施加死区、限速或 throwPower。 */
export interface PetVelocity {
  vx: number
  vy: number
}

/** 调用时的视口 CSS px 快照；body 是真实 hitbox 的绝对 AABB，不是透明像素轮廓。 */
export interface PetGeometry {
  x: number
  y: number
  width: number
  height: number
  body: { left: number, top: number, right: number, bottom: number }
}

/** 宿主物理请求：geometry 是起点快照，physics 是已合并并校验的参数副本。 */
export interface PetPhysicsEvent extends PetVelocity {
  geometry: PetGeometry
  physics: PhysicsParams
}

/** 三种渲染器共用的表现层 props。 */
export interface PetCommonProps extends PetHitboxProps {
  /**
   * 命令面 ref（React 19 的 ref-as-prop）。`<Pet ref={petRef} />` +
   * `useControllablePet(petRef)` 的组合就是靠它接上的。
   */
  ref?: Ref<PetRef | null>
  /** 宠物宽度 px（高度按资源宽高比推算；缺省取配置里的 `size`／`pets[i].size`／基准值） */
  size?: number
  /**
   * 声明式的当前动作（默认 `idle`）。可以是动作名，也可以是 `{ type, loop, replay }`。
   *
   * 它是**回落值**而不是「受控值」：命令面（`pet.motion(...)`）下发过的动作会一直生效，
   * 直到 `motion` prop 的取值发生变化 —— 那时 prop 重新接管，命令面的动作被清掉。
   * 也就是说同一个组件上可以「声明式地给一个状态」+「命令式地插播一次性动作」，
   * 互不打架（参考实现里 `props.status` 与 `override` 的关系）。
   */
  motion?: MotionInput
  /**
   * **拖动会话进行中**（手势态，参考实现的 `props.dragging`）。优先级最高：拖动时宠物
   * 一律表现为「被抓起」，两个渲染器各自落到自己的协议：
   * - `DshPet`：播 `animations.drag` 的悬浮姿势，**绝不**播 `moves` 池里的走路动画
   *   （那套是自动漫游用的，本组件不驱动漫游）；`motion` 给的方向会被忽略。
   * - `CodexPet`：图集没有专门的拖拽行，按方向落到左右行走行 ——
   *   `motion` 是 `moving-left` / `moving-right` 时用该方向，否则回落 `moving-right`
   *   （与参考实现 `spriteAction` 的 dragging 回落一致）。
   */
  dragging?: boolean
  /** 是否开启 Web IndexedDB 缓存，默认 `true` */
  cache?: boolean
  /** 是否水平镜像（资源方向相反时用） */
  mirrored?: boolean
  /** 隐藏而非卸载（保持媒体常驻，避免重新挂载导致的重新加载与闪烁） */
  hidden?: boolean
  className?: string
  style?: CSSProperties
  /** 生效动作变化时回调（含播完回落 idle） */
  onMotionChange?: (motion: PetRenderMotion) => void
  /**
   * 实际播放的动画变化时回调（解析不到动画时回调 `null`）。
   *
   * 渲染器各自能提供的粒度不同，统一定义见 `PetAnimationInfo`：
   * dsh-pet 给动画名，Codex 给图集动作名 + 行号。适合做资源预加载、埋点与测试断言。
   */
  onAnimationChange?: (animation: PetAnimationInfo | null) => void
  /** 资源就绪（视频 loadeddata / 图集首帧绘制）时回调 */
  onReady?: () => void
  /** 加载或播放失败 */
  onError?: (error: unknown) => void
}

/**
 * dsh-pet 渲染器 props（逐动作透明视频）。
 *
 * ```tsx
 * <DshPet
 *   config="https://…/dsh-pet/assets/config.jsonc"
 *   ext={{ default: 'webm', mac: 'mov' }}
 *   uri={{
 *     default: 'https://…/dsh-pet/assets/webm',
 *     mac: 'https://…/dsh-pet-mov/refs/heads/main/mov',
 *   }}
 *   cache
 * />
 * ```
 */
export interface DshPetProps extends PetCommonProps {
  /** dsh-pet 的配置文件地址或对象 */
  config: string | import('./config').DshPetConfig
  /**
   * 资源文件后缀。`default` 缺省 `webm`，`mac` 缺省 `mov`
   * （macOS 的 WKWebView/Safari 不认 VP9-alpha，需要 HEVC-with-Alpha 的 `.mov`）。
   */
  ext?: { default: string, mac?: string }
  /**
   * 资源文件地址：目录（组件拼 `uri/<动画名>.<ext>`）、含 `{name}`/`{ext}` 占位符的
   * 模板，或一个完整文件地址（带扩展名时原样使用）。
   */
  uri: { default: string, mac?: string }
  /**
   * 一次性插播「按动画名」的动作（`seq` 变化即触发一次）。
   *
   * 组件内部用：碎碎念取的是 `animations.events.whisper` 整池里的动画名，不是 14 个
   * 动作之一，走不了 `motion` 那条解析链（`resolveDshAnimation` 只吃动作），因此复用
   * 与空闲掷骰插播同一条播放通道（`DshPet` 内部的 `adHoc` 状态）。
   *
   * @internal
   */
  adHocAnimation?: { name: string, seq: number } | null
}

/** Codex 图集渲染器 props（单张 8 列雪碧图）。 */
export interface CodexPetProps extends PetCommonProps {
  /** codex-pet 的配置文件（`pet.json`）地址或对象 */
  config: string | import('./config').CodexPetConfig
  /** codex-pet 资源文件地址（雪碧图 `.webp`）；缺省按 `config.spritesheetPath` 拼 */
  uri?: string
  /**
   * v2 图集的鼠标追踪 look 格（行 9-10 共 16 格），默认 `true`。
   * 仅在 `idle` + 循环时生效（v1 图集没有 look 格，自动忽略）。
   */
  lookAtPointer?: boolean
  /** look 的死区半径 px（指针离宠物中心多近算「没在看」，默认 24） */
  lookDeadzone?: number
  /**
   * look 的作用半径 px（指针离宠物中心多远之外就不再跟随），默认 `max(宽, 高) * 1.25`。
   *
   * 没有上界时指针在屏幕任何角落都会把宠物钉在 look 格上、待机动画再也不播；出界即恢复待机。
   */
  lookRadius?: number
}

/**
 * `Pet` 统一入口 props：按 `config` / `uri` 自动判定渲染器，也可用 `kind` 强制。
 *
 * ```tsx
 * <Pet config={{ animations: { idle: ['待机呼吸休闲'] } }} uri={{ default: '/webm' }} />
 * <Pet kind="codex" config="/pets/nastya/pet.json" uri="/pets/nastya/spritesheet.webp" />
 * ```
 */
export interface PetProps extends PetCommonProps {
  /** 渲染器：`dsh` = 透明视频，`codex` = 雪碧图集；缺省自动判定 */
  kind?: 'dsh' | 'codex'
  /** 配置文件地址或对象（dsh-pet `config.jsonc` 或 codex `pet.json`） */
  config: string | import('./config').PetConfig
  /** 资源地址；dsh 用 `{ default, mac }`，codex 用字符串 */
  uri?: string | { default: string, mac?: string }
  /** dsh 渲染器的资源后缀（codex 忽略） */
  ext?: { default: string, mac?: string }
  /**
   * v2 图集的鼠标追踪 look 格（**只对 codex 生效**，dsh-pet 忽略）。
   * 放在统一入口上是为了让宿主不必先判定渲染器就能把 props 传下来。
   */
  lookAtPointer?: boolean
  /** look 的死区半径 px（**只对 codex 生效**） */
  lookDeadzone?: number
  /** look 的作用半径 px（**只对 codex 生效**）；缺省 `max(宽, 高) * 1.25` */
  lookRadius?: number
  /** 宿主物理参数：逐字段 prop > dsh 配置顶层 physics > 默认；undefined 不覆盖配置。 */
  physics?: Partial<PhysicsParams>
  /** fling 命令请求；宿主估速与移动，组件不自动处理松手。 */
  onFling?: (event: PetPhysicsEvent) => void
  /** bounce 命令请求；宿主用碰撞解算后的最终速度替换当前速度。 */
  onBounce?: (event: PetPhysicsEvent) => void
  /**
   * 自动碎碎念（v0.2.0）。
   *
   * 显式 `true` / `false` 优先；缺省 `undefined` 回落配置的 `pets[i].whisperEnabled`
   * （上游缺省 `false`，注释写明原因是后台碎碎念会顶掉正在跑的任务的 KV cache）。
   *
   * 开启后组件按 `eventsRefreshSec.whisper` 周期回调 `onMuttering`，宿主生成完用
   * `pet.muttering(text)` 推回；首拍只以 `reason: 'baseline'` 通知一次、且此期间推回的
   * 文本不展示（对齐 dsh-pet 的「首拉只记基线」）。
   */
  muttering?: boolean
  /** 覆盖配置的 `whisperPrompt`（碎碎念人设 / system 提示词） */
  mutteringPrompt?: string
  /** 覆盖配置的 `eventsRefreshSec.whisper`（秒；缺省 3600，下限 1 秒） */
  mutteringIntervalSec?: number
  /** 首拍即索取（关掉 dsh-pet 的「首拍只记基线」行为），缺省 `false` */
  mutteringImmediate?: boolean
  /** 是否抽配图；缺省回落配置的 `whisperImageEnabled` */
  mutteringImage?: boolean
  /** 气泡展示时长 ms，缺省 10000（对齐 dsh-pet `BUBBLE_DURATION_MS`） */
  mutteringDuration?: number
  /**
   * 碎碎念动画的空池回落动作，缺省 `waving`。
   *
   * Codex 图集没有 whisper 行、或 dsh 配置里 `animations.events.whisper` 为空时使用。
   */
  mutteringMotion?: MotionInput
  /**
   * 「该要一句了」—— 宿主在这里调用模型，然后用 `pet.muttering(text, { image })` 推回。
   *
   * ```tsx
   * <Pet
   *   config={config}
   *   uri={uri}
   *   muttering
   *   onMuttering={async (prompt, { meme }) => {
   *     const text = await askModel(prompt, meme)
   *     pet.muttering(text, { image: meme ? memeUrl(meme.name) : undefined })
   *   }}
   * />
   * ```
   */
  onMuttering?: PetMutteringHandler
}

/**
 * 命令面（imperative handle）—— 外部更改动作的唯一入口。
 *
 * 同一对象也是 `useControllablePet` 的返回值形状：
 *
 * ```tsx
 * const petRef = useRef<PetRef>(null)
 * const pet = useControllablePet(petRef)
 * pet.motion({ type: 'thinking', loop: true })
 * pet.motion({ type: 'result' })  // 播一次后自动回 idle
 * pet.clear()
 * return <Pet ref={petRef} config={…} uri={…} />
 * ```
 *
 * **命令面优先于 `motion` prop**：组件上同时传着 `motion` 时，`pet.motion(...)` 依然生效
 * （一直保持到 `motion` prop 的取值发生变化为止）。所以「声明式给状态 + 命令式插播」可以共存。
 */
export interface PetRef {
  /** 设置宠物动作（`{ type, loop?, replay? }`；`loop` 缺省按动作语义） */
  motion: (motion: MotionInput) => void
  /**
   * 清除命令面下发的动作，回落到 `motion` prop（没传就是 `idle`）。
   * 与参考实现的 `clear()`（`setOverride(null)`）同义。
   */
  clear: () => void
  /** 当前生效的动作（只读；可能是手势态 `dragging`） */
  readonly current: PetRenderMotion
  /**
   * 请求宿主以最终初速甩出，不改变动作或位置。无监听器/布局、未挂载或非有限速度为空操作；
   * 0、负速度与低速均合法。松手估速、增益、重力、边界和飞行生命周期由宿主负责。
   */
  fling: (velocity: PetVelocity) => void
  /** 碰撞弹开：以解算后的最终绝对速度替换旧速度，不叠加；空操作条件同 fling。 */
  bounce: (velocity: PetVelocity) => void
  /** 每读一次即时测量 renderer + hitbox；未挂载/无布局为 null，visibility:hidden 仍有布局。 */
  readonly geometry: PetGeometry | null
  /**
   * 气泡命令面（v0.2.0）—— 叠加在宠物上方、原地更新、定时收起、可捆绑运行动画。
   *
   * ```ts
   * const key = pet.bubble({ title: '会话', description: '正在处理', loading: true, motion: 'working' })
   * pet.bubble({ id: key, description: '已完成', loading: false, motion: 'success' })  // 原地更新
   * pet.bubble.close(key)
   * ```
   */
  bubble: PetBubbleHandle
  /**
   * 碎碎念命令面（v0.2.0）：`pet.muttering(text)` 展示一句（抽
   * `animations.events.whisper` + 白气泡），`pet.muttering.request()` 立即再向宿主
   * 索取一句（绕过周期与首拍基线）。
   */
  muttering: PetMutteringHandle
}
