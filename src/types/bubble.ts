import type { ReactNode } from 'react'
import type { MotionInput } from './motion'

/**
 * 气泡与碎碎念（`bubble` / `muttering`）的对外类型。
 *
 * 两层职责分开，与参考实现一一对应：
 *
 * - **展示层**（`PetBubble*`）：宿主管内容，组件管叠加、原地更新、定时收起与捆绑运行动画
 *   —— 对应 `source/deepseek-harness-desktop` 的会话气泡
 *   （`src/pet/utils/bubble-tracker.ts` 的 `toastContent()` + `src/utils/toast.ts`）；
 * - **触发层**（`PetMuttering*`）：组件管节拍与提示词组装，宿主管 LLM 生成
 *   —— 对应 `source/dsh-pet` 的 `client/pet.ts` 轮询触发与 `host/whisper.ts` 生成。
 *
 * 会话聚合（哪个会话该显示哪一档）**不在组件内**：宿主把聚合结果灌进
 * `pet.bubble({ id: sessionId, … })` 即可，组件只播它被告知的动作与文案。
 */

/** 语义色：决定内置图标与默认自动收起时长。 */
export type PetBubbleVariant = 'default' | 'success' | 'warning' | 'danger'

/** 气泡相对宠物的方向（`top` = 头顶，dsh-pet 的默认形态）。 */
export type PetBubblePlacement = 'top' | 'bottom'

/** 气泡形态：`bubble` = 常规状态气泡；`muttering` = 碎碎念文本气泡（小字号、允许换行）。 */
export type PetBubbleKind = 'bubble' | 'muttering'

/**
 * 一次气泡下发。**同一个 `id` 再次调用 = 原地更新**：只换内容，不重新淡入、不重置
 * 自动收起计时（除非本次显式给了 `timeout`）—— 与 desktop 的 `toast.update(key, content)`
 * 同义，也是「可更新文字」的实现方式。
 */
export interface PetBubbleOptions {
  /** 稳定 key（宿主通常传会话 id）；缺省自增 */
  id?: string
  /** 标题行 */
  title?: ReactNode
  /** 正文（可更新文字） */
  description?: ReactNode
  /** 图标槽；显式给则覆盖内置图标 */
  icon?: ReactNode
  /** 配图地址（**宿主给完整 URL**；碎碎念配图复用同一条链路） */
  image?: string
  /** 加载态：显示内置 CSS 圆环（不引额外依赖） */
  loading?: boolean
  /** 语义色，缺省 `default` */
  variant?: PetBubbleVariant
  /**
   * 捆绑运行动画（会话档位 → `Motion`）。
   *
   * 组件把**所有**气泡的 `motion` 按优先级聚合成一个动作，**声明式**交给渲染器的
   * `motion` prop（表见 `BUBBLE_MOTION_PRIORITY`，与参考实现 `bubble-tracker.ts` 的
   * `STATUS_PRIORITY` 同表）—— 所以：
   * - 多会话并发时宿主不必自己算优先级，每条气泡带上自己的档位即可；
   * - 气泡在，动作就在；气泡收起，动作自动回落（没有 `clear` 这回事）。
   */
  motion?: MotionInput
  /**
   * 自动收起时长 ms；`0` = 常驻。
   *
   * 缺省按 `variant`：`success` 3000 / `danger` 4000，`default` 与 `warning` 常驻
   * （对齐参考实现的 `scheduleHide`：只有终态档排计时器；`review` 语义的 2500 请显式传）。
   */
  timeout?: number
  /** 相对宠物的方向，缺省 `top` */
  placement?: PetBubblePlacement
  /**
   * 气泡形态：`muttering` = 碎碎念文本气泡（小字号 + 允许换行 + 宽度自适应）。
   *
   * @internal
   */
  kind?: PetBubbleKind
}

/** 已入队的气泡（`PetBubbleOptions` 补齐默认值后的形状）。 */
export interface PetBubble {
  id: string
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  image?: string
  loading: boolean
  variant: PetBubbleVariant
  motion?: MotionInput
  placement: PetBubblePlacement
  kind: PetBubbleKind
  /** 已解析的自动收起时长 ms（`0` = 常驻） */
  duration: number
  /** 创建序号（队列排序用；原地更新不改它） */
  created: number
}

/**
 * 气泡命令面 —— 可调用 + `close` / `clear`（与 desktop `toast` 的三段式同形）。
 *
 * ```ts
 * const key = pet.bubble({ id: 's1', title: '会话标题', description: '正在处理', loading: true })
 * pet.bubble({ id: 's1', description: '已完成', loading: false })  // 原地更新，不重新淡入
 * pet.bubble.close('s1')
 * pet.bubble.clear()
 * ```
 */
export interface PetBubbleHandle {
  (options: PetBubbleOptions): string
  /** 收起指定气泡；**缺省 `id` = 收起最近一次创建/更新的那条 */
  close: (id?: string) => void
  /** 收起全部 */
  clear: () => void
}

/** 碎碎念触发原因：`baseline` = 首拍只记基线（不展示）；`tick` = 周期到点；`manual` = `request()`。 */
export type PetMutteringReason = 'baseline' | 'tick' | 'manual'

/** 一次碎碎念索取（`onMuttering(prompt, event)` 的第二个参数）。 */
export interface PetMutteringEvent {
  /** 配置里的宠物 id（`pets[i].id`） */
  petId?: string
  reason: PetMutteringReason
  /** 生效周期（秒），宿主可据此自行节流 */
  intervalSec: number
  /** 命中配图时的表情包（`name` = `config.memes` 的键，`desc` = 描述） */
  meme?: { name: string, desc: string }
}

/**
 * 「该要一句了」。**组件不持有 Promise**：宿主生成完调 `pet.muttering(text)` 推回，
 * 展示链路（抽 `animations.events.whisper` + 白气泡 + 配图）由组件负责。
 */
export type PetMutteringHandler = (prompt: string, event: PetMutteringEvent) => void

/** `pet.muttering(text, options)` 的可选项。 */
export interface PetMutteringShowOptions {
  /** 配图地址（宿主给完整 URL） */
  image?: string
  /** 气泡展示时长 ms，缺省 `10000`（对齐 dsh-pet `BUBBLE_DURATION_MS`） */
  duration?: number
}

/** `pet.reply(text, options)` 的可选项；对话回复与碎碎念共用展示链路。 */
export type PetReplyOptions = PetMutteringShowOptions

/** 对话输入框提交后的宿主回调；组件不请求模型、不持有 Promise。 */
export type PetDialogueHandler = (text: string) => void

/** 碎碎念命令面：可调用（展示一句）+ `request()`（立即再要一句，绕过节流）。 */
export interface PetMutteringHandle {
  (text: string, options?: PetMutteringShowOptions): void
  /** 立即向宿主再要一句（`reason: 'manual'`），绕过周期与首拍基线 */
  request: () => void
}
