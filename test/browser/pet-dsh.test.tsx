import type { RefObject } from 'react'
import type { PetAnimationInfo, PetProps, PetRef } from '../../src/types'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Pet } from '../../src/components/pet'
import { resolvePlatformValue } from '../../src/utils/env'
import {
  configDataUrl,
  dshExt,
  dshUri,
  makeDshConfig,
  nextFrames,
  PET_MEDIA_DIR,
  PET_MEDIA_FILE,
  PET_MEDIA_TEMPLATE,
  query,
  textDataUrl,
} from './support/fixtures'

/**
 * `<Pet>` 走 **dsh-pet 视频渲染器**的端到端行为 —— 真 Chrome、真 `<video>`、真素材
 * （`test/fixtures/pets/*.webm`，9 个动作名，160×90 / 1s）。
 *
 * 覆盖的是「配置 → 动作 → 动画名 → 资源地址 → 双缓冲播放」这条完整链路，以及气泡 /
 * 碎碎念之外的命令面与声明层交班。断言一律落在可观察的 DOM 上（`data-motion` /
 * `data-animation` / `video[src]` / `is-front` / 内联 opacity），不碰组件内部状态。
 *
 * 除个别「缓存分支」用例外，默认传 `cache={false}`：开了 IndexedDB 缓存后地址会变成
 * `blob:`（命中）或要等首读落地（未命中），地址断言就没法写死了；`cache` 两条分支
 * 各有用例明确覆盖。
 */

/** 默认走 dsh 目录形态 + webm + 关缓存，各用例只覆盖自己关心的 prop。 */
function petElement(props: Partial<PetProps> & Pick<PetProps, 'config'>) {
  return <Pet uri={dshUri} ext={dshExt} cache={false} {...props} />
}

/** 双缓冲的两个 `<video>`（常驻 DOM，切换时只换 class 与 src）。 */
function videos(container: HTMLElement): HTMLVideoElement[] {
  return [...container.querySelectorAll<HTMLVideoElement>('video.dsh-pet__video')]
}

/** 前台缓冲：唯一带 `is-front` 的那个；数量不对说明双缓冲语义坏了。 */
function frontVideo(container: HTMLElement): HTMLVideoElement {
  const fronts = videos(container).filter(video => video.classList.contains('is-front'))
  if (fronts.length !== 1)
    throw new Error(`前台缓冲应当恰好 1 个，实际 ${fronts.length} 个`)
  return fronts[0]
}

function motionOf(container: HTMLElement): string | null {
  return query(container, '.dsh-pet').getAttribute('data-motion')
}

function animationOf(container: HTMLElement): string | null {
  return query(container, '.dsh-pet').getAttribute('data-animation')
}

/** 等某个缓冲拿到目标地址 —— 只看地址，不等加载（用于可能 404 的平台分支）。 */
async function waitForAnySrc(container: HTMLElement, expected: string): Promise<void> {
  await vi.waitFor(() => {
    expect(videos(container).map(video => video.getAttribute('src'))).toContain(expected)
  }, { timeout: 5000 })
}

/** 等目标地址落到前台缓冲，且视频真的在播（已解码、未暂停）。 */
async function waitForPlaying(container: HTMLElement, expected: string): Promise<void> {
  await vi.waitFor(() => {
    const video = frontVideo(container)
    expect(video.getAttribute('src')).toBe(expected)
    expect(video.readyState).toBeGreaterThanOrEqual(2)
    expect(video.paused).toBe(false)
  }, { timeout: 5000 })
}

/** 取命令面：ref 还没被 React 写入时直接失败，而不是静默拿到 null。 */
function petHandle(ref: RefObject<PetRef | null>): PetRef {
  if (ref.current === null)
    throw new Error('Pet 命令面尚未就绪')
  return ref.current
}

describe('dsh 渲染器判定', () => {
  it('配置没有 spriteVersionNumber 时走 dsh 视频渲染器', async () => {
    const { container } = await render(petElement({ config: makeDshConfig() }))

    expect(container.querySelectorAll('video.dsh-pet__video')).toHaveLength(2)
    // codex 渲染器的判别特征（`<div class="dsh-pet__sprite">`）在 dsh 下不存在
    expect(container.querySelector('.dsh-pet__sprite')).toBeNull()
    expect(motionOf(container)).toBe('idle')
    // 缺省宽度取配置的 size（160），高度按 9/16 推算
    const root = query(container, '.dsh-pet')
    expect(root.style.width).toBe('160px')
    expect(root.style.height).toBe('90px')

    await waitForPlaying(container, `${PET_MEDIA_DIR}/idle.webm`)
  })

  it('kind="dsh" 强制走 dsh，即使配置像 Codex', async () => {
    // 只像 Codex 的配置：默认判定为 codex（雪碧图层、没有 video）
    const codexLike = { spriteVersionNumber: 2 as const, columns: 8, frameWidth: 192, frameHeight: 208 }
    const auto = await render(petElement({ config: codexLike }))
    expect(auto.container.querySelector('.dsh-pet__sprite')).not.toBeNull()
    expect(auto.container.querySelectorAll('video.dsh-pet__video')).toHaveLength(0)

    // kind 覆盖自动判定：同样是 Codex 配置，落到视频渲染器
    const forced = await render(petElement({ config: codexLike, kind: 'dsh' }))
    expect(forced.container.querySelectorAll('video.dsh-pet__video')).toHaveLength(2)
    expect(forced.container.querySelector('.dsh-pet__sprite')).toBeNull()
    // 这份配置里没有 dsh 的动作池，解析不出动画名 → 不挂 data-animation
    expect(animationOf(forced.container)).toBeNull()
  })
})

describe('uri / ext 形态', () => {
  it('目录形态拼出 `目录/动画名.webm`，视频就位并自动播放', async () => {
    const { container } = await render(petElement({ config: makeDshConfig() }))

    await waitForPlaying(container, `${PET_MEDIA_DIR}/idle.webm`)
    expect(animationOf(container)).toBe('idle')

    // cache={false}：地址就是原始资源地址（没进 IndexedDB，也就不是 blob:）
    const sources = videos(container)
      .map(video => video.getAttribute('src'))
      .filter((src): src is string => src !== null)
    expect(sources).toEqual([`${PET_MEDIA_DIR}/idle.webm`])
  })

  it('uri 直接给字符串（等价于 { default } 形态）', async () => {
    const { container } = await render(petElement({ config: makeDshConfig(), uri: PET_MEDIA_DIR }))

    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.webm`)
  })

  it('模板形态替换 {name} / {ext} 占位符', async () => {
    const { container } = await render(petElement({
      config: makeDshConfig(),
      uri: { default: PET_MEDIA_TEMPLATE },
    }))

    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.webm`)
    expect(animationOf(container)).toBe('idle')
  })

  it('完整文件地址原样使用，动画名被忽略', async () => {
    const { container } = await render(petElement({
      config: makeDshConfig(),
      motion: 'working',
      uri: { default: PET_MEDIA_FILE },
    }))

    await waitForAnySrc(container, PET_MEDIA_FILE)
    // 动作解析出来了（working），但单文件形态下地址与动画名无关
    expect(motionOf(container)).toBe('working')
    expect(animationOf(container)).toBe('working')
    const sources = videos(container)
      .map(video => video.getAttribute('src'))
      .filter((src): src is string => src !== null)
    expect(sources).toEqual([PET_MEDIA_FILE])
  })

  it('ext 归一化：前导点被去掉', async () => {
    const { container } = await render(petElement({
      config: makeDshConfig(),
      ext: { default: '.webm' },
    }))

    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.webm`)
  })

  it('ext 的平台形态按当前平台取 default / mac', async () => {
    // 用组件自己的平台规则当预期值：本机非 Apple 平台即为 webm，Apple 平台为 mov
    const expectedExt = resolvePlatformValue({ default: 'webm', mac: 'mov' })
    const { container } = await render(petElement({
      config: makeDshConfig(),
      uri: { default: PET_MEDIA_DIR, mac: PET_MEDIA_DIR },
      ext: { default: 'webm', mac: 'mov' },
    }))

    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.${expectedExt}`)
  })

  it('uri 的平台形态按当前平台取 default / mac', async () => {
    const expectedBase = resolvePlatformValue({
      default: `${PET_MEDIA_DIR}-default-branch`,
      mac: PET_MEDIA_DIR,
    })
    const { container } = await render(petElement({
      config: makeDshConfig(),
      uri: { default: `${PET_MEDIA_DIR}-default-branch`, mac: PET_MEDIA_DIR },
    }))

    await waitForAnySrc(container, `${expectedBase}/idle.webm`)
  })
})

describe('动作 → 动画名解析', () => {
  it('显式 motions 覆盖优先于 animations 池', async () => {
    const config = makeDshConfig({
      motions: { idle: 'thinking' },
      animations: { idle: ['success'] },
    })
    const { container } = await render(petElement({ config }))

    expect(animationOf(container)).toBe('thinking')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/thinking.webm`)
  })

  it('animations.motions 映射是第二优先级', async () => {
    const config = { animations: { idle: ['success'], motions: { idle: 'waiting' } } }
    const { container } = await render(petElement({ config }))

    expect(animationOf(container)).toBe('waiting')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/waiting.webm`)
  })

  it('该动作没有可用池时回落到 idle 池', async () => {
    // 只有 idle 池：working 在 workStatus 里没有素材 → 回落 idle
    const config = { animations: { idle: ['idle'] } }
    const { container } = await render(petElement({ config, motion: 'working' }))

    expect(motionOf(container)).toBe('working')
    expect(animationOf(container)).toBe('idle')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.webm`)
  })

  it('拖动取 drag 池，忽略 motion 给的方向，也不镜像', async () => {
    // 拖动是「被无形抓起悬空」：只认 drag 池，不走 moving-* 的走路池
    const config = makeDshConfig({
      animations: { drag: ['dragging'] },
      motions: { idle: 'idle' },
    })
    const { container } = await render(petElement({ config, motion: 'moving-right', dragging: true }))

    expect(motionOf(container)).toBe('dragging')
    expect(animationOf(container)).toBe('dragging')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/dragging.webm`)
    // 悬空姿势不带方向：即便 motion 是 moving-right 也不镜像
    expect(container.querySelectorAll('.dsh-pet__media--mirrored')).toHaveLength(0)
  })
})

describe('镜像', () => {
  it('moving-right 内联镜像 scaleX(-1)，moving-left 不镜像', async () => {
    const config = makeDshConfig()
    const view = await render(petElement({ config, motion: 'moving-right' }))
    await waitForAnySrc(view.container, `${PET_MEDIA_DIR}/idle.webm`)

    expect(motionOf(view.container)).toBe('moving-right')
    const mirrored = query(view.container, '.dsh-pet__video.dsh-pet__media--mirrored')
    expect(getComputedStyle(mirrored).transform).toBe('matrix(-1, 0, 0, 1, 0, 0)')

    await view.rerender(petElement({ config, motion: 'moving-left' }))
    expect(motionOf(view.container)).toBe('moving-left')
    expect(view.container.querySelectorAll('.dsh-pet__media--mirrored')).toHaveLength(0)
  })

  it('mirrored prop 覆盖方向推断', async () => {
    const config = makeDshConfig()
    const view = await render(petElement({ config, motion: 'moving-left', mirrored: true }))
    expect(view.container.querySelectorAll('.dsh-pet__media--mirrored')).toHaveLength(2)

    await view.rerender(petElement({ config, motion: 'moving-right', mirrored: false }))
    expect(view.container.querySelectorAll('.dsh-pet__media--mirrored')).toHaveLength(0)
  })
})

describe('一次性动作与回落', () => {
  it('非循环动作播完回落 idle', async () => {
    const { container } = await render(petElement({ config: makeDshConfig(), motion: 'success' }))

    expect(motionOf(container)).toBe('success')
    expect(animationOf(container)).toBe('success')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/success.webm`)

    // 素材是 1s 短片段：播完 → `ended` → `finish()` → 回落待机
    await vi.waitFor(() => {
      expect(motionOf(container)).toBe('idle')
      expect(animationOf(container)).toBe('idle')
    }, { timeout: 8000 })
  })

  it('命令面的一次性动作播完交还声明层，而不是落 idle', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({
      config: makeDshConfig(),
      motion: 'thinking',
      ref: petRef,
    }))
    await waitForPlaying(container, `${PET_MEDIA_DIR}/thinking.webm`)

    petHandle(petRef).motion({ type: 'success', replay: true })
    await vi.waitFor(() => expect(motionOf(container)).toBe('success'), { timeout: 5000 })
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/success.webm`)

    // 声明层还是 thinking：庆祝动画播完要回到它，而不是掉成待机
    await vi.waitFor(() => {
      expect(motionOf(container)).toBe('thinking')
      expect(animationOf(container)).toBe('thinking')
    }, { timeout: 8000 })
  })
})

describe('onAnimationChange 回参', () => {
  it('循环动作报出动画名 / once=false / 资源地址', async () => {
    const changes: (PetAnimationInfo | null)[] = []
    const onAnimationChange = (info: PetAnimationInfo | null) => {
      changes.push(info)
    }
    const { container } = await render(petElement({
      config: makeDshConfig(),
      motion: 'thinking',
      onAnimationChange,
    }))
    await waitForPlaying(container, `${PET_MEDIA_DIR}/thinking.webm`)

    expect(changes[changes.length - 1]).toEqual({
      name: 'thinking',
      once: false,
      src: `${PET_MEDIA_DIR}/thinking.webm`,
    })
  })

  it('一次性动作播完后报出 idle', async () => {
    const changes: (PetAnimationInfo | null)[] = []
    const onAnimationChange = (info: PetAnimationInfo | null) => {
      changes.push(info)
    }
    const { container } = await render(petElement({
      config: makeDshConfig(),
      motion: 'success',
      onAnimationChange,
    }))
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/success.webm`)

    await vi.waitFor(() => {
      const last = changes[changes.length - 1]
      expect(last?.name).toBe('success')
      expect(last?.once).toBe(true)
      expect(last?.src).toBe(`${PET_MEDIA_DIR}/success.webm`)
    }, { timeout: 5000 })

    await vi.waitFor(() => {
      expect(changes[changes.length - 1]).toEqual({
        name: 'idle',
        once: false,
        src: `${PET_MEDIA_DIR}/idle.webm`,
      })
    }, { timeout: 8000 })
  })
})

describe('双缓冲交叉淡入', () => {
  it('切换动画时前台在两个 video 间轮换，旧缓冲淡出并暂停', async () => {
    const config = makeDshConfig()
    const view = await render(petElement({ config }))
    await waitForPlaying(view.container, `${PET_MEDIA_DIR}/idle.webm`)
    expect(videos(view.container)).toHaveLength(2)
    // 首次加载先在后台缓冲就位，再交换前台 —— 所以 idle 落在 B（index 1）
    expect(videos(view.container)[1].classList.contains('is-front')).toBe(true)

    await view.rerender(petElement({ config, motion: 'thinking' }))
    await waitForPlaying(view.container, `${PET_MEDIA_DIR}/thinking.webm`)

    // 轮换回 A：唯一前台、内联 opacity 1；旧的 B 淡出（opacity 0）、保持旧地址、已停播
    const [a, b] = videos(view.container)
    expect(a.classList.contains('is-front')).toBe(true)
    expect(a.style.opacity).toBe('1')
    expect(b.classList.contains('is-front')).toBe(false)
    expect(b.style.opacity).toBe('0')
    expect(b.getAttribute('src')).toBe(`${PET_MEDIA_DIR}/idle.webm`)
    await vi.waitFor(() => expect(b.paused).toBe(true), { timeout: 5000 })
  })

  it('同一动画重复渲染不重载，前台不轮换', async () => {
    const config = makeDshConfig()
    const view = await render(petElement({ config, motion: 'thinking' }))
    await waitForPlaying(view.container, `${PET_MEDIA_DIR}/thinking.webm`)
    const before = videos(view.container).findIndex(video => video.classList.contains('is-front'))

    await view.rerender(petElement({ config, motion: 'thinking' }))
    await nextFrames(3)

    expect(videos(view.container).findIndex(video => video.classList.contains('is-front'))).toBe(before)
  })
})

describe('命令面与气泡', () => {
  it('pet.bubble 原地更新、close 与 clear', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({ config: makeDshConfig(), ref: petRef }))

    petHandle(petRef).bubble({ id: 's1', title: '会话', description: '正在处理', loading: true })
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble').textContent).toContain('正在处理')
    })
    expect(query(container, '.dsh-pet__bubble').getAttribute('role')).toBe('status')

    // 同 id = 原地更新：内容换掉，队列仍然只有一条
    petHandle(petRef).bubble({ id: 's1', title: '会话', description: '已完成' })
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble').textContent).toContain('已完成')
    })
    expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(1)

    petHandle(petRef).bubble.close('s1')
    await vi.waitFor(() => {
      expect(container.querySelector('.dsh-pet__bubble')).toBeNull()
    }, { timeout: 5000 })

    petHandle(petRef).bubble({ id: 'a', description: 'A' })
    petHandle(petRef).bubble({ id: 'b', description: 'B' })
    await vi.waitFor(() => expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(2))

    petHandle(petRef).bubble.clear()
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.dsh-pet__bubble')).toHaveLength(0)
    }, { timeout: 5000 })
  })

  it('常驻气泡的 motion 声明式驱动动作，收起后回落', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({ config: makeDshConfig(), ref: petRef }))
    expect(motionOf(container)).toBe('idle')

    // 常驻（timeout 0）→ 参与聚合（100ms 合并窗口）→ 走声明式 `motion` prop
    petHandle(petRef).bubble({ id: 's1', description: '正在处理', loading: true, motion: 'working' })
    await vi.waitFor(() => expect(motionOf(container)).toBe('working'), { timeout: 5000 })
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/working.webm`)

    petHandle(petRef).bubble.close('s1')
    await vi.waitFor(() => expect(motionOf(container)).toBe('idle'), { timeout: 5000 })
  })

  it('限时气泡的一次性动画不被气泡收起掐断', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({ config: makeDshConfig(), ref: petRef }))

    // 限时气泡（timeout > 0）→ 聚合不参与 → 动画走命令面播一次
    petHandle(petRef).bubble({ id: 't1', description: '完成', motion: 'success', timeout: 100 })
    await vi.waitFor(() => expect(motionOf(container)).toBe('success'), { timeout: 5000 })
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/success.webm`)

    // 气泡到点自己收起（100ms + 250ms 退场）……
    await vi.waitFor(() => {
      expect(container.querySelector('.dsh-pet__bubble')).toBeNull()
    }, { timeout: 5000 })
    // ……但 1s 的一次性动画还在播，没有被这次收起掐成待机
    expect(motionOf(container)).toBe('success')

    await vi.waitFor(() => expect(motionOf(container)).toBe('idle'), { timeout: 8000 })
  })

  it('pet.motion / pet.clear / pet.current', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({ config: makeDshConfig(), ref: petRef }))
    expect(petHandle(petRef).current).toBe('idle')

    petHandle(petRef).motion('thinking')
    await vi.waitFor(() => expect(motionOf(container)).toBe('thinking'), { timeout: 5000 })
    expect(petHandle(petRef).current).toBe('thinking')
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/thinking.webm`)

    petHandle(petRef).clear()
    await vi.waitFor(() => expect(motionOf(container)).toBe('idle'), { timeout: 5000 })
    expect(petHandle(petRef).current).toBe('idle')
  })
})

describe('内置交互与插播通道', () => {
  it('单击命中框插播 clicks 池的 waving（内置点击回应）', async () => {
    // waving 的合法池是 `animations.clicks`（`motions` 里没有这一项）
    const config = makeDshConfig({ motions: { idle: 'idle' }, animations: { clicks: ['idle'] } })
    const pointerDowns: number[] = []
    // 宿主的指针回调与内置点击判定叠加：两者都要收到事件
    const onHitboxPointerDown = () => {
      pointerDowns.push(pointerDowns.length + 1)
    }
    const { container } = await render(petElement({ config, onHitboxPointerDown }))
    await waitForPlaying(container, `${PET_MEDIA_DIR}/idle.webm`)

    const hitbox = query(container, '.dsh-pet__hitbox')
    hitbox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1 }))

    await vi.waitFor(() => expect(motionOf(container)).toBe('waving'), { timeout: 5000 })
    expect(animationOf(container)).toBe('idle')
    expect(pointerDowns).toHaveLength(1)
  })

  it('碎碎念插播走一次性通道：按动画名播一次后回待机，气泡随动画收起', async () => {
    const petRef = createRef<PetRef>()
    const config = makeDshConfig({ animations: { events: { whisper: ['success'] } } })
    const { container } = await render(petElement({
      config,
      ref: petRef,
      // 关掉「首拍只记基线」，否则手动推回的第一句会被丢弃
      muttering: true,
      mutteringImmediate: true,
    }))

    petHandle(petRef).muttering('今天风好大')
    // 碎碎念取的是整池里的**动画名**（不是 14 个动作之一），所以动作仍是待机
    await vi.waitFor(() => expect(animationOf(container)).toBe('success'), { timeout: 5000 })
    expect(motionOf(container)).toBe('idle')
    await vi.waitFor(() => {
      expect(query(container, '.dsh-pet__bubble').textContent).toContain('今天风好大')
    })

    // 1s 素材播完 → 摘掉插播回待机，气泡跟着动画一起收
    await vi.waitFor(() => {
      expect(animationOf(container)).toBe('idle')
      expect(container.querySelector('.dsh-pet__bubble')).toBeNull()
    }, { timeout: 8000 })
  })
})

describe('错误与缓存开关', () => {
  it('资源不存在时回调 onError', async () => {
    const errors: unknown[] = []
    const onError = (error: unknown) => {
      errors.push(error)
    }
    await render(petElement({
      config: makeDshConfig(),
      uri: { default: `${PET_MEDIA_DIR}-missing` },
      onError,
    }))

    await vi.waitFor(() => {
      expect(errors.length).toBeGreaterThan(0)
      expect(String(errors[0])).toContain('Failed to play pet animation')
    }, { timeout: 5000 })
  })

  it('默认开启缓存时视频仍能就位并播放（命中 blob: 或首次用原始地址）', async () => {
    // 不传 cache：走 useCachedMediaUrl 的缓存分支 —— 首次未命中用原始地址起播 + 后台写回，
    // 命中则用 blob: object URL。两条路径都必须能播。
    const { container } = await render(<Pet config={makeDshConfig()} uri={dshUri} ext={dshExt} />)
    await vi.waitFor(() => {
      const video = frontVideo(container)
      expect(video.readyState).toBeGreaterThanOrEqual(2)
      expect(video.paused).toBe(false)
    }, { timeout: 8000 })

    const src = frontVideo(container).getAttribute('src') ?? ''
    expect(src === `${PET_MEDIA_DIR}/idle.webm` || src.startsWith('blob:')).toBe(true)
  })
})

describe('config 地址形态', () => {
  it('config 给 JSON 的 data: URL 也能起播（自动判定为 dsh）', async () => {
    const { container } = await render(petElement({ config: configDataUrl(makeDshConfig()) }))

    await vi.waitFor(() => expect(motionOf(container)).toBe('idle'), { timeout: 5000 })
    expect(container.querySelector('.dsh-pet__sprite')).toBeNull()
    await waitForPlaying(container, `${PET_MEDIA_DIR}/idle.webm`)
  })

  it('config 给带注释与尾逗号的 JSONC 文本', async () => {
    const jsonc = [
      '{',
      '  // 行注释：待机动作',
      '  "motions": {',
      '    "idle": "idle", /* 块注释 */',
      '  },',
      '}',
    ].join('\n')
    const { container } = await render(petElement({ config: textDataUrl(jsonc) }))

    await vi.waitFor(() => expect(animationOf(container)).toBe('idle'), { timeout: 5000 })
    await waitForAnySrc(container, `${PET_MEDIA_DIR}/idle.webm`)
  })
})

describe('表现层 props 与卸载', () => {
  it('size prop 覆盖配置宽度，高度按 9/16 推算', async () => {
    const { container } = await render(petElement({ config: makeDshConfig(), size: 320 }))

    const root = query(container, '.dsh-pet')
    expect(root.style.width).toBe('320px')
    expect(root.style.height).toBe('180px')
  })

  it('className / style / hidden 透传，hidden 时气泡层不渲染', async () => {
    const petRef = createRef<PetRef>()
    const { container } = await render(petElement({
      config: makeDshConfig(),
      className: 'host-pet',
      style: { backgroundColor: 'rgb(1, 2, 3)' },
      hidden: true,
      ref: petRef,
    }))

    const root = query(container, '.dsh-pet')
    expect(root.className).toContain('dsh-pet--hidden')
    expect(root.className).toContain('host-pet')
    expect(root.style.backgroundColor).toBe('rgb(1, 2, 3)')
    expect(getComputedStyle(root).visibility).toBe('hidden')

    // 宠物藏起来时气泡一起藏（气泡长在它身上）
    petHandle(petRef).bubble({ id: 's1', description: '不该出现' })
    await nextFrames(3)
    expect(container.querySelector('.dsh-pet__bubble')).toBeNull()
  })

  it('unmount 摘掉整个 DOM 子树', async () => {
    const view = await render(petElement({ config: makeDshConfig() }))
    await waitForPlaying(view.container, `${PET_MEDIA_DIR}/idle.webm`)
    const video = frontVideo(view.container)

    view.unmount()
    await vi.waitFor(() => expect(view.container.querySelector('.dsh-pet')).toBeNull())
    expect(video.isConnected).toBe(false)
    expect(view.container.innerHTML).toBe('')
  })
})
