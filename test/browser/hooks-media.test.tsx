import type { DshPetConfig } from '../../src/types'
import { get } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook } from 'vitest-browser-react'
import { useCachedMediaUrl } from '../../src/hooks/use-cached-media'
import { useConfig } from '../../src/hooks/use-config'
import { DOUBLE_CLICK_MS, useDoubleClick } from '../../src/hooks/use-double-click'
import { useVideoCrossfade } from '../../src/hooks/use-video-crossfade'
import { clearConfigCache } from '../../src/utils/fetch'
import { MEDIA_CACHE_PREFIX } from '../../src/utils/media-cache'
import {
  configDataUrl,
  nextFrames,
  PET_MEDIA_DIR,
  PET_MEDIA_FILE,
  textDataUrl,
} from './support/fixtures'

/**
 * 媒体与平台 hook 的真浏览器行为 —— 配置拉取（含缓存与失败）、IndexedDB 媒体缓存、
 * 双 `<video>` 淡入淡出换台、双击判定。
 *
 * 一律走真 DOM / 真 IndexedDB / 真解码（`test/fixtures/pets/*.webm`），只在需要
 * 制造「网络在途 / 非 2xx」这种真实环境难以复现的条件时才临时替换 `fetch`
 * （`vi.unstubAllGlobals()` 收尾），不 mock React。
 */

/** 每个用例用独立的资源地址，避免模块级缓存（配置去重 / `uncacheableSources` / IndexedDB）串场。 */
let caseSeq = 0
function unique(base: string): string {
  caseSeq += 1
  return `${base}?case=${caseSeq}`
}

/** 取一个必然存在的视频元素。 */
function videoElement(container: HTMLElement, name: string): HTMLVideoElement {
  const element = container.querySelector<HTMLVideoElement>(`[data-testid="${name}"]`)
  if (element === null)
    throw new Error(`找不到视频：${name}`)
  return element
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearConfigCache()
})

describe('useConfig', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  it('对象形态：渲染期直接派生，不进 effect', async () => {
    const config = { size: 160, whisperPrompt: '说一句' } as DshPetConfig
    const view = await renderHook(() => useConfig<DshPetConfig>(config))
    expect(view.result.current).toEqual({ config, error: null, loading: false })
  })

  it('地址形态：首帧 loading，落地后给出配置', async () => {
    const url = configDataUrl({ size: 321, whisperPrompt: '说一句' })
    // 首帧必然还在 loading（`data:` URL 也要跨一次任务才会落地）
    const loadingFrames: boolean[] = []
    const view = await renderHook(() => {
      const result = useConfig<DshPetConfig>(url)
      loadingFrames.push(result.loading)
      return result
    })
    expect(loadingFrames[0]).toBe(true)

    await vi.waitFor(() => {
      expect(view.result.current.loading).toBe(false)
    })
    expect(view.result.current.config?.size).toBe(321)
    expect(view.result.current.error).toBeNull()
  })

  it('.jsonc 地址：注释与尾逗号都会被剥掉', async () => {
    const url = textDataUrl('// 说明\n{ "size": 480, /* 内联 */ "whisperPrompt": "嗯", }', 'application/jsonc')
    const view = await renderHook(() => useConfig<DshPetConfig>(url))

    await vi.waitFor(() => {
      expect(view.result.current.config).not.toBeNull()
    })
    expect(view.result.current.config?.size).toBe(480)
    expect(view.result.current.error).toBeNull()
  })

  it('非 2xx 响应：进 error 状态，不再是 loading', async () => {
    // 地址必须在渲染回调外算好：每次渲染都换地址会变成无限重拉
    const url = unique('/config/missing.jsonc')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' })))
    const view = await renderHook(() => useConfig<DshPetConfig>(url))

    await vi.waitFor(() => {
      expect(view.result.current.error).not.toBeNull()
    })
    expect(view.result.current.error?.message).toContain('HTTP 404')
    expect(view.result.current.config).toBeNull()
    expect(view.result.current.loading).toBe(false)
  })

  it('解析失败：进 error 状态', async () => {
    const url = textDataUrl('{ 这不是 JSON', 'application/json')
    const view = await renderHook(() => useConfig<DshPetConfig>(url))

    await vi.waitFor(() => {
      expect(view.result.current.error).not.toBeNull()
    })
    expect(view.result.current.error?.message).toContain('JSONC parse failed')
    expect(view.result.current.loading).toBe(false)
  })

  it('换地址会重新回到 loading 并拉到新配置', async () => {
    const first = configDataUrl({ size: 1, whisperPrompt: '一' })
    const second = configDataUrl({ size: 2, whisperPrompt: '二' })

    let source: string = first
    const view = await renderHook(() => useConfig<DshPetConfig>(source))
    await vi.waitFor(() => {
      expect(view.result.current.config?.size).toBe(1)
    })

    source = second
    await view.rerender()
    // 旧配置属于旧地址，不认；新地址还在路上
    expect(view.result.current.config).toBeNull()
    expect(view.result.current.loading).toBe(true)

    await vi.waitFor(() => {
      expect(view.result.current.config?.size).toBe(2)
    })
  })

  it('同一地址的第二个实例直接吃缓存，不再发请求', async () => {
    const url = configDataUrl({ size: 99, whisperPrompt: '缓存' })
    const realFetch = globalThis.fetch
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((...args: Parameters<typeof fetch>) => {
      calls.push(String(args[0]))
      return realFetch(...args)
    }))

    const first = await renderHook(() => useConfig<DshPetConfig>(url))
    await vi.waitFor(() => {
      expect(first.result.current.config?.size).toBe(99)
    })

    const second = await renderHook(() => useConfig<DshPetConfig>(url))
    await vi.waitFor(() => {
      expect(second.result.current.config?.size).toBe(99)
    })
    expect(calls).toHaveLength(1)
  })

  it('拉取途中卸载：晚到的结果不再写状态、不报错', async () => {
    const url = unique('/config/slow.jsonc')
    let release: (() => void) | undefined
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ size: 7, whisperPrompt: '慢' })))
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = await renderHook(() => useConfig<DshPetConfig>(url))
      expect(view.result.current.loading).toBe(true)
      // 配置缓存先异步读 IDB：确实进入 fetch 后才测试“拉取途中”卸载。
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

      await view.unmount()
      release?.()
      await nextFrames(2)

      // `cancelled` 标记挡住了那次 setState；React 19 已不再为此告警，
      // 所以这里只能守「没有异常/告警漏出来」这一层。
      expect(errors).not.toHaveBeenCalled()
    }
    finally {
      errors.mockRestore()
    }
  })

  it('拉取途中卸载且这次拉取失败：错误同样不写状态', async () => {
    const url = unique('/config/slow-failure.jsonc')
    let rejectFetch: (() => void) | undefined
    const pending = new Promise<Response>((_resolve, reject) => {
      rejectFetch = () => reject(new Error('网络断了'))
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = await renderHook(() => useConfig<DshPetConfig>(url))
      expect(view.result.current.loading).toBe(true)
      // 配置缓存先异步读 IDB：确实进入 fetch 后才测试“拉取途中”卸载。
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

      await view.unmount()
      rejectFetch?.()
      await nextFrames(2)

      expect(errors).not.toHaveBeenCalled()
    }
    finally {
      errors.mockRestore()
    }
  })

  it('失败原因不是 Error 时也包成 Error', async () => {
    const url = unique('/config/throws-string.jsonc')
    // 故意用非 Error 拒绝：测 `toError` 的兜底分支（真实宿主也可能 reject 一个字符串）
    // eslint-disable-next-line prefer-promise-reject-errors -- 这里测的就是非 Error 拒绝
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('就是不上')))

    const view = await renderHook(() => useConfig<DshPetConfig>(url))
    await vi.waitFor(() => {
      expect(view.result.current.error).not.toBeNull()
    })
    expect(view.result.current.error?.message).toBe('就是不上')
  })
})

describe('useCachedMediaUrl', () => {
  it('source 为 null：恒为 null，且不读不写缓存', async () => {
    const onError = vi.fn()
    const view = await renderHook(() => useCachedMediaUrl(null, true, onError))
    expect(view.result.current).toBeNull()

    await nextFrames(2)
    expect(view.result.current).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('cache: false：直接用原始地址', async () => {
    const view = await renderHook(() => useCachedMediaUrl(PET_MEDIA_FILE, false))
    expect(view.result.current).toBe(PET_MEDIA_FILE)

    await nextFrames(2)
    expect(view.result.current).toBe(PET_MEDIA_FILE)
  })

  it('空串按「原样传递」处理（不是 null）', async () => {
    const view = await renderHook(() => useCachedMediaUrl('', false))
    expect(view.result.current).toBe('')
  })

  it('开缓存但首次读取未落地：先不定地址，避免按远端地址白加载一次', async () => {
    const source = unique(PET_MEDIA_FILE)
    // 首帧必然是 settling（IndexedDB 读还没回来）
    const frames: (string | null)[] = []
    const view = await renderHook(() => {
      const result = useCachedMediaUrl(source, true)
      frames.push(result)
      return result
    })
    expect(frames[0]).toBeNull()

    await vi.waitFor(() => {
      expect(view.result.current).toBe(source)
    })
  })

  it('未命中先按原始地址播并写回缓存，下次挂载走 blob 地址', async () => {
    const source = unique(PET_MEDIA_FILE)
    const first = await renderHook(() => useCachedMediaUrl(source, true))
    await vi.waitFor(() => {
      expect(first.result.current).toBe(source)
    })

    // 后台写回真的落进了 IndexedDB（用同一个 store 与 key 观察）。
    // **必须在卸载之前等它落地**：卸载会 `abort()` 在途抓取（见 use-cached-media.ts 的
    // cleanup），写回就再也不会发生 —— 之前把卸载放在前面，快机器上抓取先跑完才侥幸通过，
    // CI（windows + Node 26）上就成了随机红灯。等待也给足时间，抓的是真文件。
    await vi.waitFor(async () => {
      const stored = await get(MEDIA_CACHE_PREFIX + source)
      expect(stored).toBeTruthy()
    }, { timeout: 5000 })

    await first.unmount()

    const second = await renderHook(() => useCachedMediaUrl(source, true))
    await vi.waitFor(() => {
      expect(second.result.current).toMatch(/^blob:/)
    }, { timeout: 5000 })
  })

  it('抓不下来（404）：onError 仅一次，地址仍然是原始地址（照播）', async () => {
    const source = unique(`${PET_MEDIA_DIR}/not-a-real-pet.webm`)
    const onError = vi.fn()
    const view = await renderHook(() => useCachedMediaUrl(source, true, onError))

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    expect(view.result.current).toBe(source)

    // 同一个 source 不再重试、不再重复提醒
    await nextFrames(4)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('卸载中止在途抓取：晚到的失败不再回调 onError', async () => {
    const source = unique(PET_MEDIA_FILE)
    const calls: string[] = []
    let fail: ((error: unknown) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      calls.push(String(input))
      return new Promise<Response>((_resolve, reject) => {
        fail = reject
      })
    }))

    const onError = vi.fn()
    const view = await renderHook(() => useCachedMediaUrl(source, true, onError))
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1)
    })

    await view.unmount()
    fail?.(new Error('网络抖动'))
    await nextFrames(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('本地缓存读不出来：onError 上报，地址回落原始地址', async () => {
    const source = unique(PET_MEDIA_FILE)
    const errors: unknown[] = []
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = () => {
      throw new Error('存储不可用')
    }

    try {
      const view = await renderHook(() => useCachedMediaUrl(source, true, error => errors.push(error)))
      await vi.waitFor(() => {
        expect(errors.length).toBeGreaterThan(0)
      })
      expect((errors[0] as Error).message).toBe('存储不可用')

      // 读失败按「没命中」处理：照播原始地址
      await vi.waitFor(() => {
        expect(view.result.current).toBe(source)
      })
    }
    finally {
      IDBObjectStore.prototype.get = originalGet
    }
  })
})

interface CrossfadeHarnessProps {
  target: { src: string, once: boolean, seq: number } | null
  onEnded?: () => void
  onReady?: (src: string) => void
  onError?: (error: unknown) => void
}

/** 按 hook 给的两个 ref 挂真 `<video>`，`data-front` 与 `frontIndex` 一一对应。 */
function CrossfadeHarness({ target, onEnded, onReady, onError }: CrossfadeHarnessProps) {
  const { videoARef, videoBRef, frontIndex } = useVideoCrossfade({ target, onEnded, onReady, onError })
  return (
    <div>
      <video ref={videoARef} data-testid="video-a" data-front={frontIndex === 0 ? 'true' : 'false'} muted playsInline />
      <video ref={videoBRef} data-testid="video-b" data-front={frontIndex === 1 ? 'true' : 'false'} muted playsInline />
    </div>
  )
}

describe('useVideoCrossfade', () => {
  it('没有播放目标时不动前台（恒为 A）', async () => {
    const { container } = await render(<CrossfadeHarness target={null} />)
    expect(videoElement(container, 'video-a').dataset.front).toBe('true')
    expect(videoElement(container, 'video-b').dataset.front).toBe('false')
    expect(container.querySelectorAll('video')).toHaveLength(2)
  })

  it('首个目标在后台缓冲加载，loadeddata 之后才交换前台', async () => {
    const onReady = vi.fn()
    const { container } = await render(
      <CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} onReady={onReady} />,
    )
    const back = videoElement(container, 'video-b')
    const front = videoElement(container, 'video-a')
    // 目标先落到后台缓冲（A 仍是前台，且没被换掉）
    expect(front.dataset.front).toBe('true')
    expect(back.loop).toBe(true)
    expect(back.muted).toBe(true)
    // 循环目标不挂 ended
    expect(back.onended).toBeNull()

    await vi.waitFor(() => {
      expect(back.dataset.front).toBe('true')
    })
    expect(onReady).toHaveBeenCalledWith(PET_MEDIA_FILE)
    // 旧前台淡出后停播
    expect(front.paused).toBe(true)
    expect(back.paused).toBe(false)
  })

  it('换目标时另一个缓冲接手', async () => {
    const other = `${PET_MEDIA_DIR}/thinking.webm`
    const { container, rerender } = await render(
      <CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} />,
    )
    await vi.waitFor(() => {
      expect(videoElement(container, 'video-b').dataset.front).toBe('true')
    })

    await rerender(<CrossfadeHarness target={{ src: other, once: false, seq: 0 }} />)
    await vi.waitFor(() => {
      expect(videoElement(container, 'video-a').dataset.front).toBe('true')
    })
    expect(videoElement(container, 'video-a').src).toContain('thinking.webm')
    expect(videoElement(container, 'video-b').paused).toBe(true)
  })

  it('目标没变（新的对象、同样的 src/once/seq）不重载', async () => {
    const onReady = vi.fn()
    const { container, rerender } = await render(
      <CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} onReady={onReady} />,
    )
    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1)
    })

    await rerender(<CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} onReady={onReady} />)
    await nextFrames(2)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(videoElement(container, 'video-b').dataset.front).toBe('true')
  })

  it('交换还没完成时目标引用变化：cleanup 复位 pending，不会卡死后续换台', async () => {
    const dead = `${PET_MEDIA_DIR}/missing-clip.webm`
    const { container, rerender } = await render(<CrossfadeHarness target={{ src: dead, once: false, seq: 0 }} />)
    // 资源不存在 → 永远不会有 loadeddata，这次加载一直挂在 pending 上
    expect(videoElement(container, 'video-a').dataset.front).toBe('true')

    // 值相同、引用不同 → 不重载；但 cleanup 必须先复位 pending
    await rerender(<CrossfadeHarness target={{ src: dead, once: false, seq: 0 }} />)
    expect(videoElement(container, 'video-a').dataset.front).toBe('true')

    // 没有「监听器已移除但 pending 仍在」的死锁：换真目标照样能换台
    await rerender(<CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} />)
    await vi.waitFor(() => {
      expect(videoElement(container, 'video-b').dataset.front).toBe('true')
    })
  })

  it('前台起播被浏览器拒绝时回调 onError', async () => {
    const errors: unknown[] = []
    const originalPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = () => Promise.reject(new Error('自动播放被拒'))

    try {
      const { container } = await render(
        <CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} onError={error => errors.push(error)} />,
      )

      await vi.waitFor(() => {
        expect(errors).toHaveLength(1)
      })
      expect((errors[0] as Error).message).toBe('自动播放被拒')
      // 起播失败不影响换台本身
      expect(videoElement(container, 'video-b').dataset.front).toBe('true')
    }
    finally {
      HTMLMediaElement.prototype.play = originalPlay
    }
  })

  it('一次性目标：ended 只认前台那一个', async () => {
    const onEnded = vi.fn()
    const { container } = await render(
      <CrossfadeHarness target={{ src: PET_MEDIA_FILE, once: true, seq: 0 }} onEnded={onEnded} />,
    )
    const back = videoElement(container, 'video-b')
    expect(back.loop).toBe(false)

    // 交换前（还在后台缓冲）派发 ended：不算数
    back.dispatchEvent(new Event('ended'))
    expect(onEnded).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(back.dataset.front).toBe('true')
    })

    // 同步断言：真播放的 ended 不可能在同一 tick 落地
    back.dispatchEvent(new Event('ended'))
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('后台缓冲为空（只挂了一个 video）时不交换', async () => {
    const onReady = vi.fn()
    function SoloHarness({ target }: { target: { src: string, once: boolean, seq: number } }) {
      const { videoARef, frontIndex } = useVideoCrossfade({ target, onReady })
      return <video ref={videoARef} data-testid="solo" data-front={frontIndex === 0 ? 'true' : 'false'} muted />
    }

    const { container } = await render(<SoloHarness target={{ src: PET_MEDIA_FILE, once: false, seq: 0 }} />)
    await nextFrames(3)
    expect(videoElement(container, 'solo').dataset.front).toBe('true')
    expect(onReady).not.toHaveBeenCalled()
  })
})

describe('useDoubleClick', () => {
  it('窗口设置与文档一致', () => {
    expect(DOUBLE_CLICK_MS).toBe(500)
  })

  it('窗口内两次按下命中，命中后立刻重新开窗', async () => {
    const onDoubleClick = vi.fn()
    const view = await renderHook(() => useDoubleClick(onDoubleClick, { window: DOUBLE_CLICK_MS }))

    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).not.toHaveBeenCalled()

    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).toHaveBeenCalledTimes(1)

    // 三连按 = 一次双击 + 重新开窗（第三下只是开窗）
    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).toHaveBeenCalledTimes(1)

    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).toHaveBeenCalledTimes(2)
  })

  it('超过窗口再按只算第一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const onDoubleClick = vi.fn()
      const view = await renderHook(() => useDoubleClick(onDoubleClick, { window: 300 }))

      await view.act(() => {
        view.result.current()
      })
      await view.act(() => {
        vi.advanceTimersByTime(400)
      })
      await view.act(() => {
        view.result.current()
      })
      expect(onDoubleClick).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('interrupted 置真作废当前窗口（拖拽不算第一下）', async () => {
    let interrupted = false
    const onDoubleClick = vi.fn()
    const view = await renderHook(() => useDoubleClick(onDoubleClick, { window: DOUBLE_CLICK_MS, interrupted }))

    await view.act(() => {
      view.result.current()
    })

    interrupted = true
    await view.rerender()
    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).not.toHaveBeenCalled()

    // 作废之后重新计数：再两下才是一组
    await view.act(() => {
      view.result.current()
    })
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })
})
