import type { PetBubble, PetBubblePlacement, PetBubbleVariant } from '../types'
import { CircleCheck, CircleExclamation, CircleInfo, TriangleExclamation } from '@gravity-ui/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BubbleSpinner } from './bubble-icons'

/**
 * 气泡叠加层（内部组件）—— 由 `Pet` 挂在自套的 `.dsh-pet-shell` 里。
 *
 * 观感逐项对齐 `source/deepseek-harness-desktop` 的会话 toast（HeroUI `Toast` +
 * 它的 `Toast.Indicator` / `Toast.Content`）：
 *
 * | 维度 | 对齐来源 |
 * | --- | --- |
 * | 字号 / 行高 / 圆角 / 内外边距 | `@heroui/styles/dist/components/toast.css`（见 `src/styles.ts`；正文单行截断） |
 * | 默认图标 | `@gravity-ui/icons`（desktop 全程用的同一批：`CircleInfo` / `CircleCheck` / …） |
 * | 加载态 | HeroUI `Spinner`（desktop 在 `isLoading` 时就是它） |
 * | 层叠（scale / 间距 / 裁剪 / z-index） | `components/toast/toast.js` + `constants.js` |
 * | 进出场（淡入 / 淡出） | 同上的 toast 过渡（HeroUI 靠 `isLeaving` 状态留着节点，这里等价实现） |
 *
 * 三条队列规则：最新的一条在最前（完整尺寸、`--front`），更旧的按 index 缩小并按 HeroUI 的方向
 * 偏移（`top` 区往下叠、`bottom` 区往上叠）；非最前的高度取最前那条并裁剪，所以只露出一条边；
 * 元素按需挂载/卸载（淡入只给最前那条）。没有尾巴 —— desktop 的 toast 是纯圆角矩形。
 */

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/** 层叠缩放系数（HeroUI `components/toast/constants.js` 的 `DEFAULT_SCALE_FACTOR`）。 */
const STACK_SCALE_FACTOR = 0.05

/**
 * 退场时长 ms —— 与 `src/styles.ts` 里 `.dsh-pet__bubble` 的 `translate 250ms`（HeroUI 的
 * `--toast-exit-duration`）对齐；到点才把这条从层里摘掉。
 */
const BUBBLE_EXIT_MS = 250

/** 入场时长 ms —— 与 `dsh-pet-bubble-in 350ms`（HeroUI 的 `--toast-enter-duration`）对齐。 */
const BUBBLE_ENTER_MS = 350

/**
 * 语义色 → 默认图标：**直接从 `@gravity-ui/icons` 取**（desktop 全项目用的就是这一批），
 * 与 HeroUI toast 的默认图标（`InfoIcon` / `SuccessIcon` / `WarningIcon` / `DangerIcon`）同源，
 * 所以不需要再手抄 SVG 路径。尺寸与颜色由 `src/styles.ts` 的图标槽规则决定。
 */
const BUBBLE_ICONS: Record<PetBubbleVariant, typeof CircleInfo> = {
  default: CircleInfo,
  success: CircleCheck,
  warning: TriangleExclamation,
  danger: CircleExclamation,
}

/** 图标槽：碎碎念不占图标位；其余为 显式 `icon` > 加载圆环 > 语义色默认图标。 */
function BubbleIndicator({ bubble }: { bubble: PetBubble }) {
  // 碎碎念是「说话」而不是状态：只有正文，没有图标（对齐 dsh-pet 的白气泡）
  if (bubble.kind === 'muttering')
    return null
  if (bubble.icon != null)
    return <span className="dsh-pet__bubble-indicator">{bubble.icon}</span>
  if (bubble.loading)
    return <span className="dsh-pet__bubble-indicator"><BubbleSpinner /></span>
  const Icon = BUBBLE_ICONS[bubble.variant]
  return <span className="dsh-pet__bubble-indicator"><Icon /></span>
}

function PetBubbleItem({ bubble }: { bubble: PetBubble }) {
  const image = typeof bubble.image === 'string' && bubble.image !== '' ? bubble.image : undefined
  const hasTitle = bubble.title != null && bubble.title !== ''
  const hasText = bubble.description != null && bubble.description !== ''

  return (
    <>
      <BubbleIndicator bubble={bubble} />
      <div className="dsh-pet__bubble-content">
        {image !== undefined && <img className="dsh-pet__bubble-image" src={image} alt="" />}
        {hasTitle && <div className="dsh-pet__bubble-title">{bubble.title}</div>}
        {hasText && <div className="dsh-pet__bubble-text">{bubble.description}</div>}
      </div>
    </>
  )
}

/** 层里实际渲染的一条：`leaving` = 已经被收起、还在放退场动画。 */
interface LayerBubble {
  bubble: PetBubble
  leaving: boolean
}

/**
 * 退场动画：气泡被收起时先留在层里 `BUBBLE_EXIT_MS` 并打上 `--leaving`（透明度过渡），
 * 到点才真的卸载 —— 列表一删元素，DOM 直接消失，根本没有过渡可看
 * （用户报告：气泡消失的时候没有动画）。
 *
 * 合并时按 `created` 排序：退场的那条留在它**原来的层叠位置**，不会跳到最前。
 */
function useLayerBubbles(bubbles: readonly PetBubble[]): LayerBubble[] {
  const [leaving, setLeaving] = useState<readonly PetBubble[]>([])
  const previousRef = useRef<readonly PetBubble[]>(bubbles)
  /**
   * 每条退场气泡的清理定时器，key = `id:created`。
   *
   * 带上 `created` 是为了**分代**：同一个 id 被重新推出来又再次收起时，新一轮的退场项
   * 有自己的计时器，上一轮的计时器到点只会发现「这条已经不在队列里了」而空跑一次。
   */
  const timersRef = useRef(new Map<string, number>())

  // **渲染期**登记退场项 —— 这一步不能挪进 effect。
  //
  // effect 要等这次提交结束才跑，中间会先提交一帧「旧条目已经没了、退场条目还没上」的树：
  // React 会把退场那条当成**新节点**挂载，而新节点一上来就是终点样式
  // （`opacity: 0` / `translate: -100%`），浏览器不会为「初始值就等于目标值」建过渡 ——
  // 退场动画永远不会发生。只有一条气泡时，`items.length === 0` 还会让整层返回 `null`，
  // 连节点带层一起拆掉。这正是用户报告的「气泡消失的时候没有动画」。
  //
  // 渲染期更新自身 state（React 的「props 变化时调整 state」模式）不会提交中间那棵树，
  // 同一次提交里旧条目消失、退场条目出现，key 不变 → DOM 节点原地保留 → 过渡照常发生。
  if (previousRef.current !== bubbles) {
    const previous = previousRef.current
    previousRef.current = bubbles
    const live = new Set(bubbles.map(bubble => bubble.id))
    const gone = previous.filter(bubble => !live.has(bubble.id))
    if (gone.length > 0) {
      setLeaving(current => [
        ...current.filter(bubble => !gone.some(entry => entry.id === bubble.id)),
        ...gone,
      ])
    }
  }

  // 计时器是副作用，留在 effect 里：只负责到点把那条从队列摘掉
  useEffect(() => {
    for (const bubble of leaving) {
      const key = `${bubble.id}:${bubble.created}`
      if (timersRef.current.has(key))
        continue
      const timer = window.setTimeout(() => {
        timersRef.current.delete(key)
        // 按**对象身份**摘除：同 id 的下一轮退场项不能被这一轮误删
        setLeaving(current => current.filter(entry => entry !== bubble))
      }, BUBBLE_EXIT_MS)
      timersRef.current.set(key, timer)
    }
  }, [leaving])

  useEffect(() => () => {
    for (const timer of timersRef.current.values())
      window.clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  return useMemo(() => {
    const live = new Set(bubbles.map(bubble => bubble.id))
    // 同一个 id 又被重新推出来时，退场那条直接让位（否则 React key 会重复）
    return [...bubbles, ...leaving.filter(bubble => !live.has(bubble.id))]
      .sort((a, b) => a.created - b.created)
      .map(bubble => ({ bubble, leaving: !live.has(bubble.id) }))
  }, [bubbles, leaving])
}

/**
 * 单条气泡的盒子。
 *
 * 进出场动画都挂在**挂载 / 离开**上（HeroUI 的做法：入场给刚挂载的节点、离场给
 * `isLeaving` 的节点），**不挂在「是不是最前」上** —— 否则前一条收起、后面那条被顶到最前时
 * 会再播一次淡入，观感就是「闪两次」。被顶到最前只会走 CSS 的 translate/scale 过渡。
 */
function PetBubbleRow({
  bubble,
  index,
  total,
  direction,
  leaving,
}: {
  bubble: PetBubble
  /** 距最新一条的距离：0 = 最前（完整尺寸），越大越旧、越靠后 */
  index: number
  total: number
  direction: 1 | -1
  leaving: boolean
}) {
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    // 与 `src/styles.ts` 的 `dsh-pet-bubble-in`（HeroUI 的 `--toast-enter-duration`）对齐
    const timer = window.setTimeout(setEntering, BUBBLE_ENTER_MS, false)
    return () => window.clearTimeout(timer)
  }, [])

  const front = index === 0
  const hasImage = typeof bubble.image === 'string' && bubble.image !== ''
  return (
    <div
      className={joinClassNames(
        'dsh-pet__bubble',
        front ? 'dsh-pet__bubble--front' : 'dsh-pet__bubble--stacked',
        `dsh-pet__bubble--${bubble.variant}`,
        bubble.kind === 'muttering' && 'dsh-pet__bubble--muttering',
        hasImage && 'dsh-pet__bubble--has-image',
        entering && !leaving && 'dsh-pet__bubble--entering',
        leaving && 'dsh-pet__bubble--leaving',
      )}
      style={{
        zIndex: total - index,
        ...(front
          ? null
          : {
              translate: `0 calc(clamp(6px, var(--dsh-pet-size, 462px) * 0.026, 12px) * ${direction * index})`,
              scale: `${1 - index * STACK_SCALE_FACTOR}`,
            }),
      }}
      role="status"
    >
      <PetBubbleItem bubble={bubble} />
    </div>
  )
}

function BubbleStack({ placement, items }: { placement: PetBubblePlacement, items: readonly LayerBubble[] }) {
  if (items.length === 0)
    return null
  // HeroUI 的方向（`toast.js`：`translateY = (isBottom ? -1 : 1) * index * gap`）：
  // `top` 区（气泡在头顶）往前/往下叠，`bottom` 区（脚下）往上叠 —— 旧的一条总被压在
  // 「更靠近宠物那一侧」。间距走 CSS 变量（随宠物宽度缩放），所以位移用 calc 表达。
  const direction = placement === 'bottom' ? -1 : 1

  return (
    <div className={joinClassNames('dsh-pet__bubbles', `dsh-pet__bubbles--${placement}`)}>
      {items.map(({ bubble, leaving }, position) => (
        <PetBubbleRow
          key={bubble.id}
          bubble={bubble}
          leaving={leaving}
          index={items.length - 1 - position}
          total={items.length}
          direction={direction}
        />
      ))}
    </div>
  )
}

export interface PetBubbleLayerProps {
  /** 气泡队列（旧 → 新） */
  bubbles: readonly PetBubble[]
}

/** 气泡叠加层：空队列什么都不渲染（不给宿主多加一个空盒子）。 */
export function PetBubbleLayer({ bubbles }: PetBubbleLayerProps) {
  const items = useLayerBubbles(bubbles)
  if (items.length === 0)
    return null
  return (
    <>
      <BubbleStack placement="top" items={items.filter(item => item.bubble.placement !== 'bottom')} />
      <BubbleStack placement="bottom" items={items.filter(item => item.bubble.placement === 'bottom')} />
    </>
  )
}
