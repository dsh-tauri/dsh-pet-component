import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Pet } from '../../src/components/pet'
import { clearPersistedConfigs } from '../../src/utils/config-cache'
import { clearConfigCache, loadConfig } from '../../src/utils/fetch'
import { configDataUrl, dshExt, dshUri } from './support/fixtures'

/**
 * 配置的**持久化**缓存 —— 真 Chrome、真 IndexedDB。
 *
 * 这里守的是线上真踩过的那个坑：桌宠的素材（webm）一直有 IndexedDB 缓存，配置却只有内存
 * 缓存。断网重开时配置先拉不到 → 渲染器拿不到动画清单 → 透明窗口里什么都没有，而用户看到
 * 的是「明明缓存了几十 MB 素材，却什么都不显示」。
 *
 * 所以断言分两层：一层锁「网络失败时能回落到持久化副本」，一层锁「断网后 `<Pet>` 仍然真的
 * 把动画播起来」（地址是缓存的 blob / 真实素材，不是空窗口）。
 */

afterEach(async () => {
  vi.restoreAllMocks()
  await clearPersistedConfigs()
})

/** 直接读底层条目：确认写进去的是「正文 + 来源地址」，不是别的东西。 */
async function readEntry(url: string): Promise<{ url: string, config: unknown } | undefined> {
  const store = (await import('idb-keyval')) as unknown as {
    get: <T>(key: string) => Promise<T | undefined>
  }
  return store.get<{ url: string, config: unknown }>(`dsh-pet-component/config:${url}`)
}

describe('loadConfig：IndexedDB 持久化', () => {
  it('成功拉取后写入 IndexedDB；断网、且内存缓存已清时仍能加载出来', async () => {
    // `data:` URL 本身就能被 fetch 解析，先真实走一遍成功路径
    const config = { animations: { idle: ['待机'] } }
    const source = configDataUrl(config)
    await expect(loadConfig(source)).resolves.toEqual(config)
    await expect(readEntry(source)).resolves.toMatchObject({ url: source, config })

    // 模拟「窗口重建」：内存缓存在模块实例里，清掉即可，IndexedDB 不动
    clearConfigCache()

    const failing = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(loadConfig(source)).resolves.toEqual(config)
    expect(failing).toHaveBeenCalled()
  })

  it('首次就断网（还没有副本）：按原样失败，不会静默返回空配置', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    clearConfigCache()

    await expect(loadConfig('https://cdn.example/never-cached.jsonc')).rejects.toThrow('Failed to fetch')
  })
})

describe('<Pet>：断网仍能显示宠物', () => {
  it('配置走地址、断网加载：持久化副本让动画照常播起来', async () => {
    // 先「在线」跑一遍，把配置落进缓存（素材走 test/fixtures/pets，不经 fetch）
    const spy = vi.spyOn(globalThis, 'fetch')
    const config = { animations: { idle: ['待机'] } }
    const source = configDataUrl(config)
    await loadConfig(source)
    clearConfigCache()

    // 再「断网」：配置请求直接失败
    spy.mockRejectedValue(new TypeError('Failed to fetch'))

    const screen = await render(<Pet config={source} uri={dshUri} ext={dshExt} cache={false} />)

    await vi.waitFor(() => {
      const pet = screen.container.querySelector('.dsh-pet')
      expect(pet).not.toBeNull()
      expect(pet?.getAttribute('data-animation')).toBeTruthy()
    }, { timeout: 5000 })
  })
})
