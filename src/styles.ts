import { CssRender } from 'css-render'
import { isBrowser } from './utils/env'

/**
 * 组件样式（`css-render`）。
 *
 * 只做「组件跑起来必需的布局」：根盒子、媒体层、命中箱、镜像。**所有观感类的样式
 * （边框/阴影/背景/动画时长）都留给使用方**，通过 `className` / `style` 覆盖——
 * 桌宠应该无缝长在宿主页面里，而不是自带一套主题。
 *
 * 为什么用 css-render 而不是内联样式：命中箱的 `:active` 光标、`:focus-visible` 等
 * 伪类无法内联；同时 css-render 的 `mount({ id })` 天然幂等，多实例只注入一个
 * `<style>`。
 */
export const PET_STYLE_ID = 'dsh-pet-component/styles'

const { c } = CssRender()

const style = c([
  // 气泡与对话 toast 都由 `Pet` 渲染：给「渲染器 + 叠加层」一个共同的定位上下文。
  // 与 `.dsh-pet` 同为 inline-block，不改变宿主既有布局；它同时是 `--dsh-pet-size`
  // （气泡全部尺寸的等比基准）的落点 —— 基准值由 `Pet` 实测宠物宽度后写入。
  c('.dsh-pet-shell', {
    position: 'relative',
    display: 'inline-block',
    lineHeight: '0',
  }),
  c('.dsh-pet', {
    position: 'relative',
    display: 'inline-block',
    lineHeight: '0',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    // 命中箱用 pointer 事件定位，触摸端不做浏览器手势接管（拖拽由调用方实现）
    touchAction: 'none',
  }),
  c('.dsh-pet--hidden', {
    visibility: 'hidden',
  }),
  c('.dsh-pet__media', {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    transformOrigin: 'center',
  }),
  // 独立媒体层：Q 弹不影响 renderer/hitbox AABB，也不覆盖镜像/雪碧图变换。
  c('.dsh-pet__visual', {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    transformOrigin: 'bottom',
    transform: 'scaleY(var(--dsh-pet-squash, 1))',
  }),
  c('.dsh-pet__media--mirrored', {
    transform: 'scaleX(-1)',
  }),
  c('.dsh-pet__video', {
    objectFit: 'contain',
    // 透明视频的底层必须是真透明（Safari/旧 WebKit 会画黑底）
    background: 'transparent',
    // 双缓冲淡入淡出：前台 1、后台 0（与 dsh-pet .dsh-pet-video / .is-front 同语义）
    opacity: '0',
    transition: 'opacity 180ms ease',
  }),
  c('.dsh-pet__video.is-front', {
    opacity: '1',
  }),
  // 减少动效：交叉淡入本身就是动效
  c('@media (prefers-reduced-motion: reduce)', [
    c('.dsh-pet__video', { transition: 'none' }),
  ]),
  c('.dsh-pet__sprite', {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    backgroundRepeat: 'no-repeat',
    transformOrigin: 'center',
  }),
  c('.dsh-pet__hitbox', {
    position: 'absolute',
    pointerEvents: 'auto',
    cursor: 'grab',
    touchAction: 'none',
    // 命中箱在媒体层之上
    zIndex: '1',
  }),
  c('.dsh-pet__hitbox:active', {
    cursor: 'grabbing',
  }),

  /* ------------------------------ 气泡层（toast） ----------------------------- */
  // 观感来自 `deepseek-harness-desktop` 的 toast（HeroUI `components/toast/toast.css`
  // + `constants.js`）：16/12 内边距、24px 圆角、14px 正文、层叠 0.05 缩放；正文改为单行截断。
  // 但**度量按宠物宽度等比缩到合身**（`scaled()`，基准 462px）—— 直接照搬 460px 的固定宽度
  // 会比宠物大出一圈（desktop 那边靠把窗口撑到 `PET_BUBBLE_MIN_WIDTH = 420` 才显得合身，
  // 网页里没有这个手段）。
  c('.dsh-pet__dialogue', {
    position: 'absolute',
    left: '50%',
    bottom: 'calc(100% - var(--dsh-pet-size, 462px) * 0.108)',
    translate: '-50% 0',
    boxSizing: 'border-box',
    width: 'clamp(160px, calc(var(--dsh-pet-size, 462px) * 0.55), 340px)',
    maxWidth: 'calc(100vw - 2rem)',
    padding: '10px 12px',
    border: '1px solid var(--border, #d4d4d8)',
    borderRadius: '12px',
    background: 'var(--surface, #ffffff)',
    color: 'var(--overlay-foreground, #18181b)',
    boxShadow: 'var(--shadow-overlay, 0 10px 30px rgba(0, 0, 0, 0.16))',
    zIndex: '4',
    pointerEvents: 'auto',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif)',
    lineHeight: '1.4',
  }),
  c('.dsh-pet__dialogue-input', {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '40px',
    maxHeight: '140px',
    resize: 'none',
    overflowY: 'auto',
    padding: '8px 10px',
    border: '1px solid var(--border, #d4d4d8)',
    borderRadius: '8px',
    outline: 'none',
    background: 'var(--surface, #ffffff)',
    color: 'inherit',
    font: 'inherit',
    lineHeight: '1.4',
  }),
  c('.dsh-pet__dialogue-input:focus', {
    borderColor: 'var(--accent, #6366f1)',
    boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent, #6366f1) 20%, transparent)',
  }),
  c('.dsh-pet__bubbles', {
    position: 'absolute',
    left: '50%',
    translate: '-50% 0',
    width: 'max-content',
    maxWidth: 'calc(85vw - 2rem)',
    zIndex: '3',
    pointerEvents: 'none',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif)',
  }),
  c('.dsh-pet__bubbles--top', {
    bottom: 'calc(100% - var(--dsh-pet-size, 462px) * 0.108)',
  }),
  c('.dsh-pet__bubbles--bottom', {
    top: 'calc(100% - var(--dsh-pet-size, 462px) * 0.108)',
  }),
  // 单条气泡 = HeroUI `.toast`（`inset-inline: 0` 由层叠样式接管）：这里是最前那条的盒模型，
  // 它决定整摞气泡的尺寸
  c('.dsh-pet__bubble', {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'flex-start',
    gap: scaled(0.013, '5px', '6px'),
    minWidth: 'min(calc(var(--dsh-pet-size, 462px) * 0.92), calc(100vw - 2rem))',
    maxWidth: 'calc(100vw - 2rem)',
    // 度量下界贴着参考实现的固定值（见 `scaled()` 的说明）：字号 14px、内边距 10/14px、
    // 圆角 16px、图标 14px —— 宠物小的时候整条 toast 不再跟着缩到看不清
    padding: `${scaled(0.026, '10px', '12px')} ${scaled(0.0347, '14px', '16px')}`,
    // 全圆角（胶囊）：CSS 会把超过边长一半的半径按比例缩到半高，多行时也是胶囊而不是方块
    borderRadius: '999px',
    background: 'var(--surface, #ffffff)',
    color: 'var(--overlay-foreground, #18181b)',
    fontSize: scaled(0.0303, '14px', '15px'),
    lineHeight: scaled(0.04329, '20px', '21px'),
    pointerEvents: 'none',
    boxShadow: 'var(--shadow-overlay, 0 10px 30px rgba(0, 0, 0, 0.16))',
    // 运动学照抄 HeroUI v3 的 `.toast`：`transform` 250ms、`opacity` 150ms（进场 350ms，
    // 见 `--entering`）；被顶到最前只变 translate/scale，不会重播淡入
    transition: 'opacity 150ms ease, translate 250ms ease, scale 250ms ease',
  }),
  // 刚挂载的那条才淡入（挂载时挂 `--entering`）—— 它按需挂载，没有常驻节点可以切 `.is-on`。
  // 刻意**不加 `fill-mode: both`**：填充值会压过 `--leaving` 的 `opacity: 0`，退场就淡不出去。
  c('.dsh-pet__bubble--entering', {
    animation: 'dsh-pet-bubble-in 350ms ease',
  }),
  // 最前那条（= 最新的一条）只负责层级
  c('.dsh-pet__bubble--front', {
    zIndex: '1',
  }),
  // 被压在后面的那几条：高度取最前那条 + 裁剪（HeroUI `.toast:not([data-frontmost=true])` 的
  // `height: var(--front-height); overflow: hidden`），位移与缩放由行内 style 按 index 给
  c('.dsh-pet__bubble--stacked', {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    height: '100%',
    overflow: 'hidden',
    transition: 'opacity 150ms ease, translate 250ms ease, scale 250ms ease',
  }),
  // 非最前那条的**内容**不可见（HeroUI `.toast:not([data-frontmost=true]) > * { opacity: 0 }`）。
  // 没有这条，被顶到最前时整块内容会「啪」地出现 —— 观感就是闪一下。
  c('.dsh-pet__bubble--stacked > *', {
    opacity: '0',
    transition: 'opacity 200ms ease',
  }),
  // 退场：整块朝**背离宠物**的方向滑出 + 淡出（HeroUI `.toast[data-exiting][data-frontmost]`
  // 的 `--toast-enter: -100%` 配 `--dir: ±1`）。层叠那几条只淡出（scale 是行内值）
  c('.dsh-pet__bubble--leaving', {
    opacity: '0',
  }),
  c('.dsh-pet__bubbles--top .dsh-pet__bubble--leaving.dsh-pet__bubble--front', {
    translate: '0 -100%',
  }),
  c('.dsh-pet__bubbles--bottom .dsh-pet__bubble--leaving.dsh-pet__bubble--front', {
    translate: '0 100%',
  }),
  c('@keyframes dsh-pet-bubble-in', {
    from: {
      opacity: '0',
      translate: '0 6px',
    },
    to: {
      opacity: '1',
      translate: '0 0',
    },
  }),
  // 注意：这里**不画尾巴** —— desktop 的 toast 是纯圆角矩形，气泡不再带那个小尖角。
  // 内容列（HeroUI `.toast__content`：flex-col + grow + `overflow-hidden`）
  c('.dsh-pet__bubble-content', {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'center',
    flexGrow: '1',
    minWidth: '0',
    overflow: 'hidden',
  }),
  // 图标槽（HeroUI `.toast__indicator`：p-1 + 16px 图标，颜色由语义色覆盖）
  c('.dsh-pet__bubble-indicator', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    padding: scaled(0.0087, '3px', '4px'),
    color: 'var(--overlay-foreground, #18181b)',
    userSelect: 'none',
  }),
  c('.dsh-pet__bubble-indicator svg', {
    width: scaled(0.0347, '14px', '16px'),
    height: scaled(0.0347, '14px', '16px'),
  }),
  c('.dsh-pet__bubble-spinner', {
    animation: 'dsh-pet-bubble-spin 700ms linear infinite',
  }),
  c('@keyframes dsh-pet-bubble-spin', {
    to: { transform: 'rotate(360deg)' },
  }),
  // 标题（HeroUI `.toast__title`：text-sm / leading-5 / medium）
  c('.dsh-pet__bubble-title', {
    fontSize: scaled(0.0303, '14px', '15px'),
    lineHeight: scaled(0.04329, '20px', '21px'),
    fontWeight: '500',
    color: 'var(--overlay-foreground, #18181b)',
    overflowWrap: 'anywhere',
  }),
  // 正文（HeroUI `.toast__description` = text-sm + muted；本组件只显示一行）
  c('.dsh-pet__bubble-text', {
    fontSize: scaled(0.0303, '14px', '15px'),
    lineHeight: scaled(0.04329, '20px', '21px'),
    color: 'var(--muted, #71717a)',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  }),
  // 配图（本组件的扩展：desktop 的 toast 没有图）：贴住内容列，不撑破气泡
  c('.dsh-pet__bubble-image', {
    display: 'block',
    width: 'calc(var(--dsh-pet-size, 462px) * 0.34)',
    maxWidth: '100%',
    height: 'auto',
    marginBottom: scaled(0.0087, '2px', '4px'),
    borderRadius: 'min(12px, calc(var(--dsh-pet-size, 462px) * 0.026))',
    objectFit: 'cover',
    pointerEvents: 'none',
    userSelect: 'none',
  }),
  // 带图的气泡贴合内容宽度（否则一张 120px 的图塞在 460px 的框里，右侧全是空白）
  c('.dsh-pet__bubble--has-image', {
    minWidth: '0',
  }),
  // 碎碎念文本气泡：只有一行正文，宽度贴文字，长句才绕行（dsh-pet 的 `.dsh-pet-whisper` 观感）
  c('.dsh-pet__bubble--muttering', {
    minWidth: '0',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  }),
  // 语义色只染标题与图标（HeroUI `.toast--* .toast__title` / `.toast__indicator`）
  c('.dsh-pet__bubble--success .dsh-pet__bubble-title, .dsh-pet__bubble--success .dsh-pet__bubble-indicator', {
    color: 'var(--success-soft-foreground, var(--success, #2e9e4f))',
  }),
  c('.dsh-pet__bubble--warning .dsh-pet__bubble-title, .dsh-pet__bubble--warning .dsh-pet__bubble-indicator', {
    color: 'var(--warning-soft-foreground, var(--warning, #a8730f))',
  }),
  c('.dsh-pet__bubble--danger .dsh-pet__bubble-title, .dsh-pet__bubble--danger .dsh-pet__bubble-indicator', {
    color: 'var(--danger-soft-foreground, var(--danger, #d94f3d))',
  }),
  c('@media (prefers-reduced-motion: reduce)', [
    c('.dsh-pet__bubble', { animation: 'none', transition: 'none' }),
    c('.dsh-pet__bubble--stacked', { transition: 'none' }),
    c('.dsh-pet__bubble-spinner', { animation: 'none' }),
  ]),
])

/**
 * 气泡度量的缩放：desktop 的 toast 是按 **462px 画布**设计的（HeroUI `--toast-width = 460`），
 * 直接照搬会比宠物大出一圈 —— 所以按 `--dsh-pet-size`（`Pet` 实测的宠物宽度）等比缩放。
 *
 * 但**下界必须贴着参考实现的固定度量，不能往下缩**：desktop 的 toast 正文是固定 14px
 * （`.toast__title` 的 `text-sm` + `leading-5`），只有宽度跟着那个窄窗走
 * （`source/deepseek-harness-desktop/src/pet/main.css` 的 `.toast-region { width: calc(90vw - 2rem) }`）。
 * 早期版本把下界放得太低（字号 11px / 内边距 6·8px / 图标 12px），宠物一小整条 toast 就跟着
 * 缩成一小块、正文看不清（用户报告）。现在的缩放带很窄（字号 14~15px 等），
 * 实际观感≈参考实现的固定尺寸，大宠物上才用得满。
 *
 * 用函数声明（会被提升），所以能写在 `c([...])` 下面又被上面引用。
 */
function scaled(ratio: number, min: string, max: string): string {
  return `clamp(${min}, calc(var(--dsh-pet-size, 462px) * ${ratio}), ${max})`
}

let mounted = false

/**
 * 注入组件样式（幂等；模块级标记 + css-render 的 id 双重去重）。
 * SSR 下是 no-op —— 样式在客户端挂载时注入。
 */
export function mountPetStyles(): void {
  if (mounted || !isBrowser || !document.head)
    return
  mounted = true
  try {
    style.mount({ id: PET_STYLE_ID, head: true })
  }
  catch {
    // 注入失败（极端 CSP 场景）不应该让组件挂掉：布局退化为无样式但结构正确
    mounted = false
  }
}

/** 卸载组件样式（测试/微前端场景用；正常使用不需要调用）。 */
export function unmountPetStyles(): void {
  if (!isBrowser)
    return
  mounted = false
  style.unmount({ id: PET_STYLE_ID })
}
