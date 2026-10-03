import type { ConfigCacheStore } from '../../src/utils/fetch'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBrowser,
  isMacPlatform,
  normalizeExtension,
  resolveAssetUrl,
  resolvePlatformValue,
} from '../../src/utils/env'
import {
  clearConfigCache,
  CONFIG_CACHE_INDEX_KEY,
  CONFIG_CACHE_LIMIT,
  CONFIG_CACHE_PREFIX,
  fetchText,
  loadConfig,
  readCachedConfig,
  writeCachedConfig,
} from '../../src/utils/fetch'
import { createSeededRandom } from '../../src/utils/random'
import { useIsomorphicLayoutEffect } from '../../src/utils/react'

/**
 * 纯逻辑工具的真值表：平台判定 / 地址拼接 / 配置拉取去重 / 可复现随机源。
 *
 * unit 项目跑在 Node 里（没有 `window` / `document`），所以这里锁的是**服务端分支**：
 * `isBrowser` 为假、`useIsomorphicLayoutEffect` 退化成 `useEffect`；浏览器分支由
 * `test/browser/hooks-motion.test.tsx` 守。
 *
 * 拉取一律用 `data:` URL（`fetch` 认得，完全不联网），失败路径用未注册的 scheme ——
 * 它同步就 reject，不会真的去连网络。
 */

/** 任意文本 → `data:` URL。 */
function dataUrl(text: string, mime = 'application/json'): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`
}

describe('env：平台判定', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('node 里不是浏览器环境', () => {
    expect(isBrowser).toBe(false)
  })

  it('没有 navigator 时按非 Apple 处理', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isMacPlatform()).toBe(false)
  })

  it('userAgentData.platform 优先于 platform / userAgent', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { platform: 'macOS' },
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    })
    expect(isMacPlatform()).toBe(true)
  })

  it('没有 userAgentData 时看 platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
    expect(isMacPlatform()).toBe(true)
  })

  it('platform 也拿不到时才看 userAgent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })
    expect(isMacPlatform()).toBe(true)
  })

  it('三个字段都不是 Apple 就返回 false', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { platform: 'Windows' },
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    })
    expect(isMacPlatform()).toBe(false)
  })

  it('空 platform 不会穿透到 userAgent（`??` 不认空串）', () => {
    vi.stubGlobal('navigator', { platform: '', userAgent: 'Mozilla/5.0 (Macintosh)' })
    expect(isMacPlatform()).toBe(false)
  })
})

describe('env：按平台取默认值', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('显式指定 Apple：取 mac', () => {
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' }, true)).toBe('mov')
  })

  it('显式指定 Apple 但没给 mac：回落 default', () => {
    expect(resolvePlatformValue({ default: 'webm' }, true)).toBe('webm')
  })

  it('显式指定非 Apple：取 default', () => {
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' }, false)).toBe('webm')
  })

  it('不显式指定时自己判定平台', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } })
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' })).toBe('mov')

    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' } })
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' })).toBe('webm')
  })
})

describe('env：扩展名归一化', () => {
  it('原样、去点、trim 都正确', () => {
    expect(normalizeExtension('webm', 'fallback')).toBe('webm')
    expect(normalizeExtension('.mov', 'fallback')).toBe('mov')
    expect(normalizeExtension('...webm', 'fallback')).toBe('webm')
    expect(normalizeExtension('  .MOV  ', 'fallback')).toBe('MOV')
  })

  it('空值一律回落', () => {
    expect(normalizeExtension(undefined, 'fallback')).toBe('fallback')
    expect(normalizeExtension('', 'fallback')).toBe('fallback')
    expect(normalizeExtension('   ', 'fallback')).toBe('fallback')
    expect(normalizeExtension('.', 'fallback')).toBe('fallback')
  })
})

describe('env：资源地址拼接', () => {
  it('目录形态：拼 `<动画名>.<ext>`，动画名走 encodeURIComponent', () => {
    expect(resolveAssetUrl('https://cdn.example/webm', '待机呼吸', 'webm'))
      .toBe(`https://cdn.example/webm/${encodeURIComponent('待机呼吸')}.webm`)
  })

  it('目录末尾的斜杠 / 反斜杠会归一化掉', () => {
    expect(resolveAssetUrl('https://cdn.example/webm/', 'idle', 'webm'))
      .toBe('https://cdn.example/webm/idle.webm')
    expect(resolveAssetUrl('C:\\pets\\', 'idle', 'webm'))
      .toBe('C:\\pets/idle.webm')
  })

  it('模板形态：`{name}` 与 `{ext}` 都替换，ext 先归一化', () => {
    expect(resolveAssetUrl('https://cdn.example/{name}.{ext}', '待机', '.mov'))
      .toBe(`https://cdn.example/${encodeURIComponent('待机')}.mov`)
    expect(resolveAssetUrl('https://cdn.example/{ext}', 'idle', 'webm'))
      .toBe('https://cdn.example/webm')
  })

  it('只有 `{name}` 也算模板（忽略 ext）', () => {
    expect(resolveAssetUrl('https://cdn.example/{name}', 'idle', 'webm'))
      .toBe('https://cdn.example/idle')
  })

  it('完整文件地址原样返回，动画名被忽略', () => {
    expect(resolveAssetUrl('https://cdn.example/idle.webm', '待机', 'webm'))
      .toBe('https://cdn.example/idle.webm')
  })

  it('查询串 / 锚点不参与扩展名判定，也不会被截掉', () => {
    expect(resolveAssetUrl('https://cdn.example/idle.webm?v=1#frag', '待机', 'webm'))
      .toBe('https://cdn.example/idle.webm?v=1#frag')
    // 末段没有扩展名 → 还是目录，查询串留在中间（协议里不会这么用，但行为要固定）
    expect(resolveAssetUrl('https://cdn.example/webm?v=1', 'idle', 'webm'))
      .toBe('https://cdn.example/webm?v=1/idle.webm')
  })

  it('末段是 `.` / `..` 时不当成文件地址', () => {
    expect(resolveAssetUrl('https://cdn.example/.', 'idle', 'webm'))
      .toBe('https://cdn.example/./idle.webm')
    expect(resolveAssetUrl('https://cdn.example/..', 'idle', 'webm'))
      .toBe('https://cdn.example/../idle.webm')
  })

  it('空 base 退化成裸文件名，ext 缺省回落 webm', () => {
    expect(resolveAssetUrl('', '待机', 'webm')).toBe(`${encodeURIComponent('待机')}.webm`)
    expect(resolveAssetUrl('   ', 'idle', '')).toBe('idle.webm')
    expect(resolveAssetUrl(undefined as unknown as string, 'idle', 'webm')).toBe('idle.webm')
  })
})

describe('fetch：配置拉取', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearConfigCache()
  })

  it('对象形态原样返回，不进缓存也不发请求', async () => {
    const config = { size: 160 }
    await expect(loadConfig(config)).resolves.toBe(config)
  })

  it('同一地址并发只拉一次；拉完仍在缓存里', async () => {
    const url = dataUrl(JSON.stringify({ size: 1, tag: 'dedup' }))
    const first = loadConfig<{ size: number }>(url)
    const second = loadConfig<{ size: number }>(url)
    expect(second).toBe(first)

    await expect(first).resolves.toEqual({ size: 1, tag: 'dedup' })
    expect(loadConfig(url)).toBe(first)
  })

  it('带注释的 JSONC：行注释、块注释、尾逗号都能吃', async () => {
    const url = dataUrl('// 行注释\n{ "size": 160, /* 块注释 */ "id": "p1", }', 'application/jsonc')
    await expect(loadConfig(url)).resolves.toEqual({ size: 160, id: 'p1' })
  })

  it('解析失败：拒绝，并把缓存项删掉允许重试', async () => {
    const url = dataUrl('{ 这不是 JSON')
    const first = loadConfig(url)
    // 还没失败：此刻仍是同一个 promise
    expect(loadConfig(url)).toBe(first)

    await expect(first).rejects.toThrow('JSONC parse failed')

    const retry = loadConfig(url)
    expect(retry).not.toBe(first)
    await expect(retry).rejects.toThrow('JSONC parse failed')
  })

  it('网络失败同样清掉缓存项', async () => {
    const url = 'bogus-scheme://config-not-fetchable'
    const first = loadConfig(url)
    await expect(first).rejects.toThrow()

    const retry = loadConfig(url)
    expect(retry).not.toBe(first)
    await expect(retry).rejects.toThrow()
  })

  it('非 2xx 响应：抛带状态码与状态文本的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' })))
    await expect(fetchText('https://cdn.example/missing.jsonc'))
      .rejects
      .toThrow('Failed to fetch config https://cdn.example/missing.jsonc: HTTP 404 Not Found')
  })

  it('clearConfigCache 能只清一个地址', async () => {
    const url = dataUrl(JSON.stringify({ size: 2, tag: 'clear-one' }))
    const first = loadConfig(url)
    await first

    clearConfigCache(url)
    expect(loadConfig(url)).not.toBe(first)
  })

  it('clearConfigCache 不带参数清掉全部', async () => {
    const first = loadConfig(dataUrl(JSON.stringify({ tag: 'clear-all-1' })))
    const second = loadConfig(dataUrl(JSON.stringify({ tag: 'clear-all-2' })))
    await Promise.all([first, second])

    clearConfigCache()
    expect(loadConfig(dataUrl(JSON.stringify({ tag: 'clear-all-1' })))).not.toBe(first)
    expect(loadConfig(dataUrl(JSON.stringify({ tag: 'clear-all-2' })))).not.toBe(second)
  })

  it('没有 IndexedDB 的环境（Node / SSR）持久化层整体空转，加载照常', async () => {
    const config = { size: 3, tag: 'no-idb' }
    await expect(loadConfig<typeof config>(dataUrl(JSON.stringify(config)))).resolves.toEqual(config)
  })
})

describe('fetch：配置持久化缓存', () => {
  /** 内存版持久化层（Node 里没有 IndexedDB，用注入的 store 覆盖离线分支）。 */
  function memoryStore() {
    const store = new Map<string, unknown>()
    const cacheStore: ConfigCacheStore = {
      // `get` 是泛型方法，`vi.fn` 会把签名擦成非泛型，这里直接给实现即可
      get: async <T>(key: string) => store.get(key) as T | undefined,
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value)
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key)
      }),
    }
    return { store, cacheStore }
  }

  beforeEach(() => {
    clearConfigCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearConfigCache()
  })

  it('网络失败时回落到持久化副本，加载仍然成功（断网仍能显示宠物）', async () => {
    const url = 'https://cdn.example/pet/config.jsonc'
    const { store, cacheStore } = memoryStore()
    store.set(`${CONFIG_CACHE_PREFIX}${url}`, { url, config: { size: 220, tag: 'cached' }, cachedAt: 1_700_000_000_000 })

    // 断网：任何请求都直接失败（等价于 DNS 失败 / 代理黑洞）
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', failing)

    await expect(loadConfig<{ size: number, tag: string }>(url, { store: cacheStore }))
      .resolves
      .toEqual({ size: 220, tag: 'cached' })
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('网络成功时把正文写进持久化层（下次断网才有得回落）', async () => {
    const url = 'https://cdn.example/pet/online.jsonc'
    const { store, cacheStore } = memoryStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ size: 1, tag: 'online' }), { status: 200 })))

    await expect(loadConfig<{ size: number, tag: string }>(url, { store: cacheStore }))
      .resolves
      .toEqual({ size: 1, tag: 'online' })
    expect(store.get(`${CONFIG_CACHE_PREFIX}${url}`)).toMatchObject({ url, config: { size: 1, tag: 'online' } })
    expect(store.get(CONFIG_CACHE_INDEX_KEY)).toEqual([url])
  })

  it('网络失败且没有持久化副本：按原样失败并清掉内存缓存（允许重试）', async () => {
    const url = 'https://cdn.example/pet/missing.jsonc'
    const { store, cacheStore } = memoryStore()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const first = loadConfig(url, { store: cacheStore })
    await expect(first).rejects.toThrow('Failed to fetch')
    expect(store.has(`${CONFIG_CACHE_PREFIX}${url}`)).toBe(false)

    const retry = loadConfig(url, { store: cacheStore })
    expect(retry).not.toBe(first)
    await expect(retry).rejects.toThrow('Failed to fetch')
  })

  it('持久化副本与地址对不上时不算命中（不串台）', async () => {
    const url = 'https://cdn.example/pet/other.jsonc'
    const { store, cacheStore } = memoryStore()
    store.set(`${CONFIG_CACHE_PREFIX}${url}`, { url: 'https://cdn.example/pet/OLD.jsonc', config: { tag: 'stale' } })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(loadConfig(url, { store: cacheStore })).rejects.toThrow('Failed to fetch')
  })

  it('存储抛错只降级为无缓存，不把加载打死', async () => {
    const url = 'https://cdn.example/pet/flaky.jsonc'
    const cacheStore: ConfigCacheStore = {
      get: vi.fn(async () => {
        throw new Error('IndexedDB blocked')
      }),
      set: vi.fn(async () => {
        throw new Error('IndexedDB blocked')
      }),
      del: vi.fn(async () => {
        throw new Error('IndexedDB blocked')
      }),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag: 'still-works' }), { status: 200 })))

    await expect(loadConfig<{ tag: string }>(url, { store: cacheStore })).resolves.toEqual({ tag: 'still-works' })
  })

  it('writeCachedConfig 超出上限时淘汰最旧地址（连同正文一起删）', async () => {
    const { store, cacheStore } = memoryStore()
    const urls = Array.from({ length: CONFIG_CACHE_LIMIT + 1 }, (_, index) => `https://cdn.example/pet/${index}.jsonc`)
    for (const url of urls)
      await writeCachedConfig(url, { url }, cacheStore)

    expect(store.get(CONFIG_CACHE_INDEX_KEY)).toHaveLength(CONFIG_CACHE_LIMIT)
    expect(store.get(CONFIG_CACHE_INDEX_KEY)).toEqual([...urls].reverse().slice(0, CONFIG_CACHE_LIMIT))
    // 最旧的一条被淘汰
    expect(store.has(`${CONFIG_CACHE_PREFIX}${urls[0]}`)).toBe(false)
    // 最新的一条还在
    await expect(readCachedConfig(urls[urls.length - 1]!, cacheStore)).resolves.toEqual({ url: urls[urls.length - 1] })
  })

  it('重复写入同一地址不产生重复索引', async () => {
    const url = 'https://cdn.example/pet/same.jsonc'
    const { store, cacheStore } = memoryStore()
    await writeCachedConfig(url, { v: 1 }, cacheStore)
    await writeCachedConfig(url, { v: 2 }, cacheStore)

    expect(store.get(CONFIG_CACHE_INDEX_KEY)).toEqual([url])
    await expect(readCachedConfig(url, cacheStore)).resolves.toEqual({ v: 2 })
  })

  it('clearConfigCache(url) 连持久化副本一起清掉（热更新不会读回旧副本）', async () => {
    const url = 'https://cdn.example/pet/hot.jsonc'
    const { store, cacheStore } = memoryStore()
    await writeCachedConfig(url, { tag: 'old' }, cacheStore)
    store.set(CONFIG_CACHE_INDEX_KEY, [url])

    clearConfigCache(url, cacheStore)
    // 持久化清理是异步的（不阻塞调用方），等它落地
    await vi.waitFor(() => {
      expect(store.has(`${CONFIG_CACHE_PREFIX}${url}`)).toBe(false)
      expect(store.get(CONFIG_CACHE_INDEX_KEY)).toEqual([])
    })
  })
})

describe('random：可复现随机源', () => {
  it('同一种子给出同一串序列', () => {
    const left = createSeededRandom(42)
    const right = createSeededRandom(42)
    const leftValues = [left(), left(), left(), left()]
    const rightValues = [right(), right(), right(), right()]
    expect(leftValues).toEqual(rightValues)
  })

  it('不同种子给出不同序列', () => {
    const one = createSeededRandom(1)()
    const two = createSeededRandom(2)()
    expect(one).not.toBe(two)
  })

  it('非整数种子按 Math.floor 处理', () => {
    const left = createSeededRandom(7)
    const right = createSeededRandom(7.9)
    expect([left(), left()]).toEqual([right(), right()])
  })

  it('值域恒在 [0, 1)', () => {
    const random = createSeededRandom(-1234.5)
    for (let index = 0; index < 200; index++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('react：同构 layout effect', () => {
  it('服务端（unit 项目）退化成 useEffect', () => {
    expect(useIsomorphicLayoutEffect).toBe(useEffect)
  })
})
