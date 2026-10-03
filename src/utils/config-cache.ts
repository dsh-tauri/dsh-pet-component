import { del, get, set } from 'idb-keyval'

/**
 * 配置正文的**持久化**缓存 —— 与媒体缓存（`utils/media-cache.ts`）同一套「地址即内容键」
 * 约定：一个地址第一次拉下来之后，**断网时还有一份可用副本**。
 *
 * 为什么媒体有 IndexedDB 缓存而配置只有内存缓存是个缺口：两者是同一条链路上的必需输入。
 * 配置（`config.jsonc` / `pet.json`）给出动画清单，素材（webm / 图集）按清单取回；素材落了
 * IndexedDB 而配置没落，那么「有缓存」的承诺在离线时**一步都走不到** —— `loadConfig` 先
 * 失败 → 渲染器拿不到任何动作池 → 窗口空白。用户看到的现象就是「明明缓存了几十 MB 素材，
 * 断网还是什么都没有」。
 *
 * 容量有界：`CONFIG_CACHE_LIMIT` 条之外的旧地址在下次写入时连同正文一起删掉 —— 配置只有
 * 几 KB，但地址（预设宠物）会随清单更新换代，不设上限就是只增不减的垃圾。
 *
 * 存储故障（隐私模式、配额、被策略禁用）一律**降级为无缓存**：拿不到就当场回落网络，绝不
 * 因为缓存层抛错而让原本能渲染的宠物渲染不出来。
 */

/** IndexedDB key 前缀（正文条目；索引条目见 `CONFIG_CACHE_INDEX_KEY`）。 */
export const CONFIG_CACHE_PREFIX = 'dsh-pet-component/config:'

/** 记录「哪些地址有持久化副本」的索引 key，`string[]`，最近写入的在前。 */
export const CONFIG_CACHE_INDEX_KEY = 'dsh-pet-component/config-index'

/** 持久化配置条数上限（地址换代后旧条目在下次写入时被淘汰）。 */
export const CONFIG_CACHE_LIMIT = 16

/** 一条持久化配置：正文 + 来源地址（地址即内容键，校验对不上不算命中）。 */
export interface ConfigCacheEntry<T = unknown> {
  url: string
  config: T
  /** 写入时间戳（ms），只作诊断用。 */
  cachedAt: number
}

/** 索引内容：有持久化副本的地址，最近写入的在前。 */
export type ConfigCacheIndex = string[]

/**
 * 持久化层 —— 只用到 `get` / `set` / `del` 三个方法，默认实现是 `idb-keyval`（默认 store）。
 *
 * 抽成接口是为了让「离线回落 / 淘汰 / 存储故障」这些分支能在无 IndexedDB 的环境里跑
 * （Node 单测、SSR），也方便宿主换成自己的存储。
 */
export interface ConfigCacheStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  del: (key: string) => Promise<void>
}

/** 是否存在可用的 IndexedDB（浏览器 / jsdom 有，Node 单测与 SSR 没有）。 */
function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined'
}

/** 默认持久化层：`idb-keyval` 的默认 store（`keyval-store` / `keyval`）。 */
export const defaultConfigCacheStore: ConfigCacheStore = {
  async get<T>(key: string): Promise<T | undefined> {
    // 无 IndexedDB 时直接当未命中：`idb-keyval` 的 `get`/`set`/`del` 都要**同步**求值默认
    // store 才会返回 promise，那个 ReferenceError 会漏出调用方的 try，把加载整个打死。
    if (!hasIndexedDb())
      return undefined
    return get<T>(key)
  },
  async set(key: string, value: unknown): Promise<void> {
    if (!hasIndexedDb())
      return
    await set(key, value)
  },
  async del(key: string): Promise<void> {
    if (!hasIndexedDb())
      return
    await del(key)
  },
}

/** 把这层降级收口到这里：任何存储异常都只意味着「本次没有持久化副本」。 */
async function safely<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task()
  }
  catch {
    return fallback
  }
}

/** 读一条持久化条目；存储不可用 / 值形状不对都当作未命中。 */
export function readCachedConfig<T>(
  url: string,
  store: ConfigCacheStore = defaultConfigCacheStore,
): Promise<T | null> {
  return safely(async () => {
    const entry = await store.get<ConfigCacheEntry<T>>(CONFIG_CACHE_PREFIX + url)
    if (entry === null || entry === undefined || entry.url !== url)
      return null
    return entry.config
  }, null)
}

/** 读索引（有持久化副本的地址，最近写入在前）。 */
function readIndex(store: ConfigCacheStore): Promise<string[]> {
  return safely(async () => {
    const index = await store.get<ConfigCacheIndex>(CONFIG_CACHE_INDEX_KEY)
    return Array.isArray(index) ? index.filter(url => typeof url === 'string') : []
  }, [])
}

/**
 * 写一条持久化条目，并按 `CONFIG_CACHE_LIMIT` 淘汰旧地址（连同正文一起删掉，不留空壳）。
 *
 * 写回是热路径的**副作用**：失败只影响下次离线能不能用，所以这里吞掉异常，不让存储问题
 * 冒泡成「配置加载失败」。
 */
export function writeCachedConfig<T>(
  url: string,
  config: T,
  store: ConfigCacheStore = defaultConfigCacheStore,
): Promise<void> {
  return safely(async () => {
    await store.set(CONFIG_CACHE_PREFIX + url, { url, config, cachedAt: Date.now() } satisfies ConfigCacheEntry<T>)
    const next = [url, ...(await readIndex(store)).filter(item => item !== url)]
    const evicted = next.slice(CONFIG_CACHE_LIMIT)
    await store.set(CONFIG_CACHE_INDEX_KEY, next.slice(0, CONFIG_CACHE_LIMIT) satisfies ConfigCacheIndex)
    await Promise.all(evicted.map(item => store.del(CONFIG_CACHE_PREFIX + item)))
  }, undefined)
}

/** 删掉一个地址的持久化条目（索引同步移除）—— `clearConfigCache(url)` 用。 */
export function removeCachedConfig(
  url: string,
  store: ConfigCacheStore = defaultConfigCacheStore,
): Promise<void> {
  return safely(async () => {
    await store.del(CONFIG_CACHE_PREFIX + url)
    const next = (await readIndex(store)).filter(item => item !== url)
    await store.set(CONFIG_CACHE_INDEX_KEY, next)
  }, undefined)
}

/** 删掉全部持久化条目与索引 —— `clearConfigCache()` 用。 */
export function clearPersistedConfigs(store: ConfigCacheStore = defaultConfigCacheStore): Promise<void> {
  return safely(async () => {
    const index = await readIndex(store)
    await Promise.all([
      ...index.map(url => store.del(CONFIG_CACHE_PREFIX + url)),
      store.del(CONFIG_CACHE_INDEX_KEY),
    ])
  }, undefined)
}
