import type { CSSProperties } from 'react'
import type { PetBubble } from '../../src/types'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PetBubbleLayer } from '../../src/components/bubble-layer'
import { mountPetStyles, unmountPetStyles } from '../../src/styles'
import { createBubble } from '../../src/utils/bubble'

/**
 * 真样式 —— 这一组读的是**浏览器实际算出来的样式**，而不是 class 名。三件事一起覆盖
 * 「退场动画存在且在动」：
 *
 * 1. `.dsh-pet__bubble` 的过渡覆盖 `opacity / translate / scale`（有动画可放）；
 * 2. `.dsh-pet__bubble--leaving` 的终点样式真的把气泡淡到 0、并且沿方向滑出去（放的是对的东西）；
 * 3. `bubble-layer.test.tsx` 守着「退场节点会留到退场时长之后才卸载」（有足够时间放完）。
 *
 * 刻意**不**去断言「这一次运行里浏览器建起了 `CSSTransition`」：实测约 1/8 的运行里
 * `getAnimations()` 是空的，但节点身份与 class 全都正确（React 没有重建节点、强制重排也无效），
 * 属浏览器侧时序而不是组件行为 —— 那种断言只会变成随机红灯。
 *
 * 组件本身不注入样式（`Pet` 才注入），所以这里手动 `mountPetStyles()`。
 */

function bubble(id: string, created: number, options: Parameters<typeof createBubble>[0] = {}): PetBubble {
  return createBubble(options, id, created)
}

function query(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector)
  if (element === null)
    throw new Error(`找不到元素：${selector}`)
  return element
}

beforeAll(() => mountPetStyles())
afterAll(() => unmountPetStyles())

describe('气泡过渡属性', () => {
  it('过渡覆盖 opacity / translate / scale（退场滑出与淡出的前提）', async () => {
    const { container } = await render(<PetBubbleLayer bubbles={[bubble('a', 1, { title: 'A' })]} />)
    const style = getComputedStyle(query(container, '.dsh-pet__bubble'))

    expect(style.transitionProperty).toContain('opacity')
    expect(style.transitionProperty).toContain('translate')
    expect(style.transitionProperty).toContain('scale')
  })

  it('入场动画是样式表里那条 dsh-pet-bubble-in', async () => {
    const { container } = await render(<PetBubbleLayer bubbles={[bubble('a', 1, { title: 'A' })]} />)
    const element = query(container, '.dsh-pet__bubble')

    await vi.waitFor(() => {
      const names = element.getAnimations()
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map(animation => animation.animationName)
      expect(names).toContain('dsh-pet-bubble-in')
    }, { timeout: 1000 })
  })
})

describe('气泡退场样式', () => {
  it('退场时淡到 0，并沿方向滑出去', () => {
    // 用静止元素读终点样式：与浏览器是否在这一次运行里建立过渡无关，永远可判定。
    const host = document.createElement('div')
    host.className = 'dsh-pet__bubbles--top'
    const leaving = document.createElement('div')
    leaving.className = 'dsh-pet__bubble dsh-pet__bubble--front dsh-pet__bubble--leaving'
    host.append(leaving)
    document.body.append(host)

    try {
      const style = getComputedStyle(leaving)
      // 淡出
      expect(style.opacity).toBe('0')
      // 沿背离宠物的方向滑出：`translate` 的百分比相对自身尺寸，无高度的元素解析成 0px，
      // 所以这里断言「规则生效了」（不是 `none`），具体位移由行内层叠与真实高度决定
      expect(style.translate).not.toBe('none')
    }
    finally {
      host.remove()
    }
  })
})

describe('非最前那条的内容不可见', () => {
  it('压在后排时内容透明，被顶到最前时淡回可见', async () => {
    const older = bubble('a', 1, { title: 'A' })
    const newer = bubble('b', 2, { title: 'B' })
    const { container, rerender } = await render(<PetBubbleLayer bubbles={[older]} />)
    await rerender(<PetBubbleLayer bubbles={[older, newer]} />)

    const stacked = query(container, '.dsh-pet__bubble--stacked .dsh-pet__bubble-content')
    // 内容是被「淡出」到不可见的（HeroUI 折叠态那 200ms），所以不能同步读
    await vi.waitFor(() => {
      expect(getComputedStyle(stacked).opacity).toBe('0')
    }, { timeout: 2000 })

    // 收起 B → A 被顶到最前，内容应当淡回 1（HeroUI 折叠态的 200ms 内容过渡）
    await rerender(<PetBubbleLayer bubbles={[older]} />)
    await vi.waitFor(() => {
      expect(container.querySelector('.dsh-pet__bubble--leaving')).toBeNull()
    }, { timeout: 2000 })

    const promoted = query(container, '.dsh-pet__bubble--front .dsh-pet__bubble-content')
    await vi.waitFor(() => {
      expect(getComputedStyle(promoted).opacity).toBe('1')
    }, { timeout: 2000 })
  })
})

/**
 * 度量：宽度跟着宠物走（用户认可），但**正文不能跟着缩到看不清**。
 *
 * desktop 的 toast 正文是固定 14px（HeroUI `.toast__title` 的 `text-sm`），只有宽度跟着窄窗
 * （`source/deepseek-harness-desktop/src/pet/main.css` 的 `.toast-region { width: calc(90vw - 2rem) }`）。
 * 这两条守住「宠物一小，整条 toast 连字号一起缩下去」这个真实回归。
 */
describe('气泡度量', () => {
  it('长描述只占一行，保留完整文本并截断溢出', async () => {
    const description = '这是一条足够长的描述，用来验证正文不会显示第二行。'.repeat(20)
    const { container } = await render(<PetBubbleLayer bubbles={[bubble('a', 1, { title: '标题', description })]} />)
    const text = query(container, '.dsh-pet__bubble-text')
    text.style.width = '120px'
    const style = getComputedStyle(text)

    expect(style.webkitLineClamp).toBe('1')
    expect(style.overflow).toBe('hidden')
    expect(text.clientHeight).toBe(Number.parseFloat(style.lineHeight))
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight)
    expect(text.textContent).toBe(description)
  })

  it('宠物很小时字号/内边距/图标停在下界，不再缩成 11px / 6·8px', async () => {
    const { container } = await render(
      <div style={{ '--dsh-pet-size': '200px' } as CSSProperties}>
        <PetBubbleLayer bubbles={[bubble('a', 1, { title: '标题', description: '正文' })]} />
      </div>,
    )
    const style = getComputedStyle(query(container, '.dsh-pet__bubble'))

    expect(style.fontSize).toBe('13px')
    expect(style.lineHeight).toBe('19px')
    expect(style.paddingTop).toBe('10px')
    expect(style.paddingLeft).toBe('14px')
    expect(getComputedStyle(query(container, '.dsh-pet__bubble-indicator svg')).width).toBe('14px')
  })

  it('默认 462px 画布上正好是参考实现的尺寸（text-sm / leading-5 / px-4 py-3）', async () => {
    const { container } = await render(<PetBubbleLayer bubbles={[bubble('a', 1, { title: '标题' })]} />)
    const style = getComputedStyle(query(container, '.dsh-pet__bubble'))

    expect(style.fontSize).toBe('14px')
    expect(style.lineHeight).toBe('20px')
    expect(style.paddingTop).toBe('12px')
    expect(style.paddingLeft).toBe('16px')
    expect(getComputedStyle(query(container, '.dsh-pet__bubble-indicator svg')).width).toBe('16px')
  })
})
