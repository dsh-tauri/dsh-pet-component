import type { RefObject } from 'react'
import type { PetAnimationInfo, PetProps, PetRef } from '../../src/types'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Pet } from '../../src/components/pet'
import { configDataUrl, makeCodexConfig, makeSpritesheetDataUrl, nextFrames, query } from './support/fixtures'

/**
 * `<Pet>` 的 **Codex 精灵图渲染器**端到端用例 —— 真 Chrome、真 DOM、真指针事件。
 *
 * 守的是 Codex 协议的对外契约：DOM 结构 / 内联样式（`background-size` 百分比铺满、
 * 命中框比例）、尺寸解析优先级、图集加载的 `onReady` / `onError`、`onAnimationChange`
 * 回报的动作名与行号、命令面（`pet.motion` / `pet.clear` / `pet.bubble` / `pet.muttering`）、
 * 拖动落到左右行走行，以及 v2 图集专属的鼠标追踪 look 格。
 */

/** 一只「图集能加载」的 Codex 宠物：关掉 IndexedDB 缓存，地址在首帧就确定。 */
function renderCodex(props: Partial<PetProps> = {}) {
  return (
    <Pet
      config={makeCodexConfig()}
      uri={makeSpritesheetDataUrl()}
      cache={false}
      {...props}
    />
  )
}

/** 取命令面：还没挂上就抛错，而不是静默拿到 `null`。 */
function petHandle(petRef: RefObject<PetRef | null>): PetRef {
  const handle = petRef.current
  if (handle === null)
    throw new Error('命令面还没挂上')
  return handle
}

/** 把光标挪到宠物中心「下方」`offset` px —— 落在作用半径内、死区外。 */
function dispatchLookPointer(element: HTMLElement, offset: number): void {
  const rect = element.getBoundingClientRect()
  window.dispatchEvent(new PointerEvent('pointermove', {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2 + offset,
    bubbles: true,
  }))
}

describe('渲染契约（Codex 精灵图）', () => {
  it('按配置自动判定成 Codex，并渲染根 / 精灵 / 命中框的真实内联样式', async () => {
    const { container } = await render(renderCodex())

    const root = query(container, '.dsh-pet')
    expect(root.className).toBe('dsh-pet')
    expect(root.dataset.motion).toBe('idle')
    expect(root.dataset.row).toBe('0')
    // v2 图集 idle 循环本可追踪指针，但还没收到 pointermove —— 属性应当是「不存在」
    expect(root.dataset.look).toBeUndefined()
    expect(root.style.width).toBe('231px')
    expect(Number.parseFloat(root.style.height)).toBeCloseTo(231 * 208 / 192)

    const sprite = query(container, '.dsh-pet__sprite')
    expect(sprite.style.backgroundImage).toMatch(/^url\("data:image\/png/)
    // 百分比铺满：8 列 × 11 行与图集真实像素尺寸解耦
    expect(sprite.style.backgroundSize).toBe('800% 1100%')
    expect(sprite.style.backgroundPosition).toMatch(/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/)
    expect(sprite.style.transform).toBe('')

    const hitbox = query(container, '.dsh-pet__hitbox')
    expect(hitbox.style.left).toBe('25%')
    expect(hitbox.style.top).toBe('10%')
    expect(hitbox.style.width).toBe('50%')
    expect(hitbox.style.height).toBe('85%')
  })

  it('mirrored 让精灵水平翻转，className 叠加在根节点上', async () => {
    const { container } = await render(renderCodex({ mirrored: true, className: 'my-pet' }))

    expect(query(container, '.dsh-pet').className).toBe('dsh-pet my-pet')
    expect(query(container, '.dsh-pet__sprite').style.transform).toBe('scaleX(-1)')
  })

  it('style 覆盖根节点的宽高，但不改精灵的图集铺法', async () => {
    const { container } = await render(renderCodex({ style: { width: '300px', height: '150px' } }))

    const root = query(container, '.dsh-pet')
    expect(root.style.width).toBe('300px')
    expect(root.style.height).toBe('150px')
    expect(query(container, '.dsh-pet__sprite').style.backgroundSize).toBe('800% 1100%')
  })

  it('hidden 挂 dsh-pet--hidden，并把气泡层一起藏掉', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef, hidden: true }))

    expect(query(container, '.dsh-pet').className).toBe('dsh-pet dsh-pet--hidden')

    petHandle(petRef).bubble({ id: 's1', title: '不该出现' })
    await nextFrames()
    expect(container.querySelector('.dsh-pet__bubbles')).toBeNull()
  })
})

describe('尺寸解析优先级', () => {
  it('size prop 优先于配置里的 size', async () => {
    const { container } = await render(renderCodex({ size: 100, config: makeCodexConfig({ size: 300 }) }))

    expect(query(container, '.dsh-pet').style.width).toBe('100px')
  })

  it('没有 size prop 时用配置里的 size，高度按格子比例换算', async () => {
    const { container } = await render(renderCodex({ config: makeCodexConfig({ size: 180 }) }))

    const root = query(container, '.dsh-pet')
    expect(root.style.width).toBe('180px')
    // 208 / 192 = 13 / 12，180px 宽正好 195px 高
    expect(root.style.height).toBe('195px')
  })

  it('两边都没给时回落 Codex 自己的默认基准（231px）', async () => {
    const { container } = await render(renderCodex())

    expect(query(container, '.dsh-pet').style.width).toBe('231px')
  })
})

describe('图集加载与动画回报', () => {
  it('图集加载完成触发 onReady', async () => {
    const onReady = vi.fn()
    await render(renderCodex({ onReady }))

    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalled()
    })
  })

  it('图集加载失败走 onError，拿到带地址的 Error，且不报 ready', async () => {
    const onReady = vi.fn()
    const onError = vi.fn()
    await render(renderCodex({ uri: 'data:image/png;base64,AAAA', onReady, onError }))

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled()
    })
    const error = onError.mock.calls[0]?.[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('Failed to load pet spritesheet')
    expect(onReady).not.toHaveBeenCalled()
  })

  it('onAnimationChange 报告一次性动作：success → waving / 第 3 行 / once', async () => {
    const infos: Array<PetAnimationInfo | null> = []
    await render(renderCodex({ motion: 'success', onAnimationChange: info => infos.push(info) }))

    await vi.waitFor(() => {
      expect(infos.some(info => info?.name === 'waving')).toBe(true)
    })
    const info = infos.find(value => value?.name === 'waving')
    expect(info).toMatchObject({ name: 'waving', once: true, row: 3 })
    expect(info?.src).toMatch(/^data:image\/png/)
  })

  it('onAnimationChange 报告循环动作：working → running / 第 7 行 / 不一次性', async () => {
    const infos: Array<PetAnimationInfo | null> = []
    await render(renderCodex({ motion: 'working', onAnimationChange: info => infos.push(info) }))

    await vi.waitFor(() => {
      expect(infos.some(info => info?.name === 'running')).toBe(true)
    })
    expect(infos.find(value => value?.name === 'running')).toMatchObject({ name: 'running', once: false, row: 7 })
  })
})

describe('命令面动作', () => {
  it('pet.motion 覆盖声明层动作，data-motion / data-row 跟着换', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef, motion: 'thinking' }))
    const root = query(container, '.dsh-pet')
    expect(root.dataset.motion).toBe('thinking')
    expect(root.dataset.row).toBe('6')

    petHandle(petRef).motion('working')
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('working')
    })
    expect(root.dataset.row).toBe('7')

    petHandle(petRef).motion({ type: 'success' })
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('success')
    })
    expect(root.dataset.row).toBe('3')
  })

  it('pet.clear 交还声明层动作，而不是落回待机', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef, motion: 'thinking' }))
    const root = query(container, '.dsh-pet')

    petHandle(petRef).motion('working')
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('working')
    })

    petHandle(petRef).clear()
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('thinking')
    })
  })

  it('dragging 时没有方向就落到 moving-right', async () => {
    const { container } = await render(renderCodex({ dragging: true }))

    const root = query(container, '.dsh-pet')
    expect(root.dataset.motion).toBe('moving-right')
    expect(root.dataset.row).toBe('1')
  })

  it('dragging 时方向来自 motion（moving-left 走第 2 行）', async () => {
    const { container } = await render(renderCodex({ dragging: true, motion: 'moving-left' }))

    const root = query(container, '.dsh-pet')
    expect(root.dataset.motion).toBe('moving-left')
    expect(root.dataset.row).toBe('2')
  })
})

describe('气泡的两条动画通道', () => {
  it('pet.bubble 渲染气泡，close 收掉指定 id，clear 清空整层', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef }))
    const pet = petHandle(petRef)

    pet.bubble({ id: 's1', title: '会话一', description: '正在处理' })
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble-title').textContent).toBe('会话一')
    })
    expect(query(container, '.dsh-pet__bubble-text').textContent).toBe('正在处理')

    // 收起有 250ms 退场动画，节点到点才真的摘掉
    pet.bubble.close('s1')
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(0)
    }, { timeout: 2000 })

    pet.bubble({ id: 'a', title: 'A' })
    pet.bubble({ id: 'b', title: 'B' })
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(2)
    })

    pet.bubble.clear()
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(0)
    }, { timeout: 2000 })
  })

  it('常驻气泡（timeout: 0）的 motion 走声明式：聚合下发后 data-motion 变化，收起即回落', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef }))
    const root = query(container, '.dsh-pet')
    const pet = petHandle(petRef)

    // 聚合下发带 100ms 合并窗口，所以这里必须等
    pet.bubble({ id: 's1', title: '会话', motion: 'thinking', timeout: 0 })
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('thinking')
    }, { timeout: 2000 })
    expect(root.dataset.row).toBe('6')

    pet.bubble.close('s1')
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('idle')
    }, { timeout: 2000 })
  })

  it('限时气泡（timeout > 0）的 motion 走一次性命令，播完自己回落', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({ ref: petRef }))
    const root = query(container, '.dsh-pet')

    petHandle(petRef).bubble({ id: 's2', title: '完成', motion: 'success', timeout: 5000 })
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('success')
    })
    expect(root.dataset.row).toBe('3')

    // 气泡还在（5s 展示时长），但 waving 是一次性动作，播完就回待机
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('idle')
    }, { timeout: 3000 })
    expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(1)
  })
})

describe('命中框指针行为', () => {
  it('指针事件原样透传给宿主的 down / up / cancel 回调', async () => {
    const onHitboxPointerDown = vi.fn()
    const onHitboxPointerUp = vi.fn()
    const onHitboxPointerCancel = vi.fn()
    const { container } = await render(renderCodex({
      onHitboxPointerDown,
      onHitboxPointerUp,
      onHitboxPointerCancel,
    }))
    const hitbox = query(container, '.dsh-pet__hitbox')

    hitbox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))
    hitbox.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    hitbox.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))

    expect(onHitboxPointerDown).toHaveBeenCalledTimes(1)
    expect(onHitboxPointerUp).toHaveBeenCalledTimes(1)
    expect(onHitboxPointerCancel).toHaveBeenCalledTimes(1)
    expect((onHitboxPointerDown.mock.calls[0]?.[0] as PointerEvent).type).toBe('pointerdown')
  })

  it('有效单击插播 waving，启用 dialogue 后第二次按下打开输入 toast', async () => {
    const onDialogue = vi.fn()
    const toastRef = createRef<HTMLDivElement>()
    const { container } = await render(renderCodex({ dialogue: true, onDialogue, toastRef }))
    const root = query(container, '.dsh-pet')
    const hitbox = query(container, '.dsh-pet__hitbox')

    hitbox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1 }))
    await vi.waitFor(() => {
      expect(root.dataset.motion).toBe('waving')
    })
    expect(root.dataset.row).toBe('3')

    hitbox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1 }))
    await nextFrames()
    const toast = query(container, '.dsh-pet__dialogue')
    const input = query(toast, '.dsh-pet__dialogue-input') as HTMLTextAreaElement
    expect(toastRef.current).toBe(toast)

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setValue.call(input, '  你好  ')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => {
      expect(onDialogue).toHaveBeenCalledWith('你好')
    })
    expect(container.querySelector('.dsh-pet__dialogue')).toBeNull()
    expect(toastRef.current).toBeNull()
  })
})

describe('碎碎念', () => {
  it('pet.muttering("一句") 弹出不占图标位的碎碎念气泡，并插播一次动画', async () => {
    const petRef = createRef<PetRef>()
    // Codex 没有 whisper 池 → 动画回落 mutteringMotion（这里给循环档，稳住断言）
    const { container } = await render(renderCodex({ ref: petRef, mutteringMotion: 'working' }))

    petHandle(petRef).muttering('今晚风好大')
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble-title').textContent).toBe('今晚风好大')
    })
    expect(query(container, '.dsh-pet__bubble').className).toContain('dsh-pet__bubble--muttering')
    expect(container.querySelector('.dsh-pet__bubble-indicator')).toBeNull()
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet').dataset.motion).toBe('working')
    })
  })

  it('打开 muttering 后自动索取：首拍 reason 是 tick，手动 request 是 manual', async () => {
    const petRef = createRef<PetRef>()
    const onMuttering = vi.fn()
    await render(renderCodex({
      ref: petRef,
      muttering: true,
      mutteringImmediate: true,
      mutteringPrompt: '说点碎碎念',
      mutteringIntervalSec: 1,
      onMuttering,
    }))

    await vi.waitFor(() => {
      expect(onMuttering).toHaveBeenCalledWith('说点碎碎念', expect.objectContaining({ reason: 'tick', intervalSec: 1 }))
    })

    petHandle(petRef).muttering.request()
    await vi.waitFor(() => {
      expect(onMuttering).toHaveBeenCalledWith('说点碎碎念', expect.objectContaining({ reason: 'manual' }))
    })
  })

  it('宿主把生成的一句推回 pet.muttering 就展示出来（完整来回）', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(renderCodex({
      ref: petRef,
      muttering: true,
      mutteringImmediate: true,
      mutteringPrompt: '说点碎碎念',
      onMuttering: () => petRef.current?.muttering('宿主生成的一句'),
    }))

    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble-title').textContent).toBe('宿主生成的一句')
    })
  })
})

describe('鼠标追踪 look 格', () => {
  it('idle 循环时指针靠近中心 → 画对应方向的 look 格（行 10 / 列 0）', async () => {
    const { container } = await render(renderCodex())
    const root = query(container, '.dsh-pet')
    const sprite = query(container, '.dsh-pet__sprite')

    dispatchLookPointer(root, 60)

    await vi.waitFor(() => {
      expect(root.dataset.look).toBe('8')
    })
    // 追踪期间暂停帧推进，只画 look 行
    expect(sprite.style.backgroundPosition).toBe('0% 100%')
  })

  it('指针离开作用半径就回到待机帧', async () => {
    const { container } = await render(renderCodex())
    const root = query(container, '.dsh-pet')
    const sprite = query(container, '.dsh-pet__sprite')

    dispatchLookPointer(root, 60)
    await vi.waitFor(() => {
      expect(root.dataset.look).toBe('8')
    })

    const rect = root.getBoundingClientRect()
    // 远在 max(宽, 高) × 1.25 的作用半径之外
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + rect.width / 2 + 5000,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
    }))

    await vi.waitFor(() => {
      expect(root.dataset.look).toBeUndefined()
    })
    expect(sprite.style.backgroundPosition).toMatch(/% 0%$/)
  })

  it('pointerout（relatedTarget 为空）与窗口失焦都会清掉 look', async () => {
    const { container } = await render(renderCodex())
    const root = query(container, '.dsh-pet')

    dispatchLookPointer(root, 60)
    await vi.waitFor(() => {
      expect(root.dataset.look).toBe('8')
    })
    window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null, bubbles: true }))
    await vi.waitFor(() => {
      expect(root.dataset.look).toBeUndefined()
    })

    dispatchLookPointer(root, 60)
    await vi.waitFor(() => {
      expect(root.dataset.look).toBe('8')
    })
    window.dispatchEvent(new Event('blur'))
    await vi.waitFor(() => {
      expect(root.dataset.look).toBeUndefined()
    })
  })

  it('v1 图集（9 行）不支持 look，指针怎么动都不改 data-look', async () => {
    const { container } = await render(renderCodex({ config: makeCodexConfig({ spriteVersionNumber: 1 }) }))
    const root = query(container, '.dsh-pet')

    expect(query(container, '.dsh-pet__sprite').style.backgroundSize).toBe('800% 900%')
    dispatchLookPointer(root, 60)
    await nextFrames()

    expect(root.dataset.look).toBeUndefined()
  })

  it('lookAtPointer 关闭时指针移动不产生 look', async () => {
    const { container } = await render(renderCodex({ lookAtPointer: false }))
    const root = query(container, '.dsh-pet')

    dispatchLookPointer(root, 60)
    await nextFrames()

    expect(root.dataset.look).toBeUndefined()
  })
})

describe('配置地址与卸载', () => {
  it('config 给地址时先拉取配置，再按 Codex 渲染', async () => {
    const { container } = await render(
      <Pet config={configDataUrl(makeCodexConfig())} uri={makeSpritesheetDataUrl()} cache={false} />,
    )

    await vi.waitFor(() => {
      expect(container.querySelector('.dsh-pet__sprite')).not.toBeNull()
    }, { timeout: 3000 })
    expect(query(container, '.dsh-pet__sprite').style.backgroundSize).toBe('800% 1100%')
    expect(query(container, '.dsh-pet').style.width).toBe('231px')
  })

  it('不关缓存时地址等 IndexedDB 首次读取落地后才确定', async () => {
    const { container } = await render(
      <Pet config={makeCodexConfig()} uri={makeSpritesheetDataUrl()} />,
    )

    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__sprite').style.backgroundImage).not.toBe('')
    }, { timeout: 3000 })
  })

  it('unmount 摘掉整棵 DOM，不抛错也不留节点', async () => {
    const { container, unmount } = await render(renderCodex())
    const root = query(container, '.dsh-pet')
    expect(root.isConnected).toBe(true)

    await unmount()

    expect(root.isConnected).toBe(false)
    expect(container.querySelector('.dsh-pet')).toBeNull()
  })
})
