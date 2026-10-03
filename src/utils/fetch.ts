import type { PetConfigSource } from '../types'
import type { ConfigCacheStore } from './config-cache'
import { readCachedConfig, removeCachedConfig, writeCachedConfig } from './config-cache'
import { parseJsonc } from './jsonc'

export type { ConfigCacheEntry, ConfigCacheIndex, ConfigCacheStore } from './config-cache'
export {
  clearPersistedConfigs,
  CONFIG_CACHE_INDEX_KEY,
  CONFIG_CACHE_LIMIT,
  CONFIG_CACHE_PREFIX,
  defaultConfigCacheStore,
  readCachedConfig,
  removeCachedConfig,
  writeCachedConfig,
} from './config-cache'

/**
 * 配置文件加载：`config` prop 可以是对象，也可以是 `.json` / `.jsonc` 地址。
 *
 * 地址形态走 `fetch` + `parseJsonc`（剥注释 / 去尾逗号），并按 URL 做模块级 promise
 * 去重——同一地址在多个宠物实例间只拉一次；失败时把缓存项删掉，允许重试。
 *
 * 拉取结果**同时写入 IndexedDB**（`utils/config-cache.ts`）：配置与素材是同一条链路上的必需
 * 输入，素材有持久化缓存而配置没有的话，离线时清单先加载失败，已经缓存好的素材永远派不上
 * 用场。网络失败时回落到持久化副本，**不把这次加载变成失败** —— 这是「断网仍能显示宠物」
 * 的关键分支；配置正文是几 KB 的文本，命中副本时只多一次 IndexedDB 读取。
 */
const configCache = new Map<string, Promise<unknown>>()

/**
 * 一次网络拉取的等待上限。桌宠窗口是透明的，挂在加载态与「什么都没有」观感一致；断网 /
 * 代理黑洞的失败可能要十几秒甚至一直挂着，而持久化副本此时已经躺在 IndexedDB 里可用。
 */
const CONFIG_FETCH_TIMEOUT_MS = 15_000

/**
 * 已经有持久化副本时的等待上限。此时网络只决定**新不新**，副本决定**有没有** ——
 * 拿旧副本先显形远好过让透明窗口空等十几秒，所以这里的取舍偏「早回落」。
 */
const CONFIG_REVALIDATE_TIMEOUT_MS = 3_000

/** `fetch` 文本并校验状态码。 */
export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init)
  if (!response.ok)
    throw new Error(`Failed to fetch config ${url}: HTTP ${response.status} ${response.statusText}`)
  return response.text()
}

/** 加载选项。 */
export interface LoadConfigOptions {
  /** 持久化层（默认 `idb-keyval`）；注入是为了在无 IndexedDB 的环境里测试离线分支。 */
  store?: ConfigCacheStore
  /** 一次网络拉取的等待上限（ms），默认见 `CONFIG_FETCH_TIMEOUT_MS` / `CONFIG_REVALIDATE_TIMEOUT_MS`。 */
  timeoutMs?: number
}

/** 带超时的拉取：超时即中止请求并 reject。 */
async function fetchFresh(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const text = await fetchText(url, { signal: controller.signal })
    return await parseJsonc(text)
  }
  finally {
    clearTimeout(timer)
  }
}

/** 加载配置：对象原样返回，地址走「网络优先 + 持久化副本兜底」的 JSONC 拉取。 */
export function loadConfig<T>(source: T | string, options: LoadConfigOptions = {}): Promise<T> {
  if (typeof source !== 'string')
    return Promise.resolve(source as T)

  const cached = configCache.get(source)
  if (cached !== undefined)
    return cached as Promise<T>

  const { store } = options

  const task = (async () => {
    // 先看有没有副本：有的话网络只决定「新不新」，等待上限放宽到 3s
    const persisted = await readCachedConfig<T>(source, store)
    const timeoutMs = options.timeoutMs
      ?? (persisted === null ? CONFIG_FETCH_TIMEOUT_MS : CONFIG_REVALIDATE_TIMEOUT_MS)

    try {
      const config = await fetchFresh(source, timeoutMs)
      // 先落地持久化副本再 resolve，离线可用性不依赖调用方怎么用这次结果
      await writeCachedConfig(source, config as T, store)
      return config as T
    }
    catch (error) {
      // 网络不可用（断网 / 代理黑洞 / DNS 失败）：有持久化副本就用副本，加载照常成功
      if (persisted !== null)
        return persisted
      configCache.delete(source)
      throw error
    }
  })()

  // 立刻占位，保证同一地址的并发调用只拉一次
  configCache.set(source, task as Promise<unknown>)
  return task as Promise<T>
}

/**
 * 清配置缓存（给测试与「配置热更新」用）。
 *
 * 带 `url` 时同时清掉持久化副本 —— 只清内存会让「热更新」在下次窗口重建后又读回旧副本。
 * 持久化清理是异步的（IndexedDB）且失败无副作用（最坏情况是留着旧副本），所以这里不等待。
 */
export function clearConfigCache(url?: string, store?: ConfigCacheStore): void {
  if (url === undefined) {
    configCache.clear()
    return
  }
  configCache.delete(url)
  void removeCachedConfig(url, store)
}

export type { PetConfigSource }
