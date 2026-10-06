import type { MutteringControllerOptions } from '../src/hooks/use-muttering'
import type { DshPetConfig, PetMutteringEvent } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import {
  MUTTERING_DURATION_MS,
  MUTTERING_FALLBACK_INTERVAL_SEC,
  resolveMutteringPlan,
  selectPetEntry,
} from '../src/config'
import { createMutteringController } from '../src/hooks/use-muttering'

/* -------------------------------------------------------------------------- */
/* 运行参数的回落链（prop > 条目级 > 顶层 > 缺省）                               */
/* -------------------------------------------------------------------------- */

describe('resolveMutteringPlan', () => {
  const config: DshPetConfig = {
    whisperPrompt: '全局碎碎念人设',
    whisperImageEnabled: true,
    eventsRefreshSec: { whisper: 300, balance: 1800 },
    memes: { 开心: '笑得很开心' },
    pets: [{ id: 'main', whisperEnabled: true, eventsRefreshSec: { whisper: 60 } }],
  }

  it('开关：prop > pets[i].whisperEnabled > false', () => {
    const entry = selectPetEntry(config)
    expect(resolveMutteringPlan({ config, entry }).enabled).toBe(true)
    expect(resolveMutteringPlan({ config, entry, enabled: false }).enabled).toBe(false)
    // 条目没写 whisperEnabled 时缺省关闭（上游语义：后台碎碎念会顶掉 KV cache）
    expect(resolveMutteringPlan({ config, entry: { id: 'x' } }).enabled).toBe(false)
    expect(resolveMutteringPlan({ config, entry: { id: 'x' }, enabled: true }).enabled).toBe(true)
  })

  it('周期：prop > 条目级 > 顶层 > 3600，且钳到 ≥ 1 秒', () => {
    const entry = selectPetEntry(config)
    expect(resolveMutteringPlan({ config, entry }).intervalSec).toBe(60)
    expect(resolveMutteringPlan({ config }).intervalSec).toBe(300)
    expect(resolveMutteringPlan({ config, entry, intervalSec: 5 }).intervalSec).toBe(5)
    expect(resolveMutteringPlan({}).intervalSec).toBe(MUTTERING_FALLBACK_INTERVAL_SEC)
    // 0.5 秒 → 1 秒（对齐 dsh-pet 的 Math.max(1000, sec * 1000)）
    expect(resolveMutteringPlan({ intervalSec: 0.5 }).intervalSec).toBe(1)
    // 非法值回落缺省，而不是猜一个
    expect(resolveMutteringPlan({ intervalSec: -3 }).intervalSec).toBe(MUTTERING_FALLBACK_INTERVAL_SEC)
    expect(resolveMutteringPlan({ intervalSec: Number.NaN }).intervalSec).toBe(MUTTERING_FALLBACK_INTERVAL_SEC)
  })

  it('提示词 / 配图 / 展示时长各自回落', () => {
    expect(resolveMutteringPlan({ config }).prompt).toBe('全局碎碎念人设')
    expect(resolveMutteringPlan({ config, prompt: '临时人设' }).prompt).toBe('临时人设')
    expect(resolveMutteringPlan({ config }).image).toBe(true)
    expect(resolveMutteringPlan({ config, image: false }).image).toBe(false)
    expect(resolveMutteringPlan({ config }).duration).toBe(MUTTERING_DURATION_MS)
    expect(resolveMutteringPlan({ config, duration: 2000 }).duration).toBe(2000)
    // 非法的展示时长回到 10s（碎碎念气泡不能常驻）
    expect(resolveMutteringPlan({ config, duration: 0 }).duration).toBe(MUTTERING_DURATION_MS)
  })

  it('宠物 id 与毫秒周期一起带出', () => {
    const plan = resolveMutteringPlan({ config, entry: selectPetEntry(config) })
    expect(plan.petId).toBe('main')
    expect(plan.intervalMs).toBe(60_000)
    expect(plan.immediate).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 触发状态机（纯逻辑，不依赖 React）                                            */
/* -------------------------------------------------------------------------- */

interface Shown {
  text: string
  options: { image?: string, duration: number }
}

function setup(overrides: Partial<MutteringControllerOptions> = {}) {
  const asked: { prompt: string, event: PetMutteringEvent }[] = []
  const played: (string | undefined)[] = []
  const shown: Shown[] = []
  const controller = createMutteringController({
    enabled: true,
    prompt: '你是碎碎念',
    intervalSec: 300,
    immediate: false,
    duration: MUTTERING_DURATION_MS,
    image: false,
    onMuttering: (prompt, event) => {
      asked.push({ prompt, event })
    },
    onPlay: (name) => {
      played.push(name)
    },
    onShow: (text, options) => {
      shown.push({ text, options })
    },
    ...overrides,
  })
  return { controller, asked, played, shown }
}

describe('createMutteringController', () => {
  it('首拍只记基线：通知宿主，但丢弃它在这期间推回的那一句（对齐 dsh-pet hasBaseline）', () => {
    const { controller, asked, played, shown } = setup()

    controller.tick()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.prompt).toBe('你是碎碎念')
    expect(asked[0]?.event).toMatchObject({ reason: 'baseline', intervalSec: 300 })
    expect(controller.baselinePending).toBe(true)

    controller.show('第一句')
    expect(shown).toHaveLength(0)
    expect(played).toHaveLength(0)
    expect(controller.baselinePending).toBe(false)

    controller.tick()
    expect(asked[1]?.event.reason).toBe('tick')
    controller.show('第二句')
    expect(shown).toEqual([{ text: '第二句', options: { image: undefined, duration: MUTTERING_DURATION_MS } }])
  })

  it('mutteringImmediate：首拍就当作正常触发（推回即展示）', () => {
    const { controller, asked, shown } = setup({ immediate: true })
    controller.tick()
    expect(asked[0]?.event.reason).toBe('tick')
    controller.show('马上说一句')
    expect(shown).toHaveLength(1)
  })

  it('reply 绕过首拍 baseline，但不消费后续周期的基线窗口', () => {
    const { controller, shown } = setup()
    controller.tick()
    expect(controller.baselinePending).toBe(true)

    controller.reply('对话回复')
    expect(shown).toHaveLength(1)
    expect(shown[0]?.text).toBe('对话回复')
    expect(controller.baselinePending).toBe(true)

    controller.show('基线回复')
    expect(shown).toHaveLength(1)
    expect(controller.baselinePending).toBe(false)
  })

  it('未启用时周期不通知宿主，但显式展示仍生效', () => {
    const { controller, asked, shown } = setup({ enabled: false })
    controller.tick()
    expect(asked).toHaveLength(0)
    controller.show('宿主主动推一句')
    expect(shown).toHaveLength(1)
  })

  it('request() 走 manual 并清掉基线窗口', () => {
    const { controller, asked, shown } = setup()
    controller.tick()
    controller.request()
    expect(asked.map(item => item.event.reason)).toEqual(['baseline', 'manual'])
    controller.show('手动要来的那句')
    expect(shown).toHaveLength(1)
  })

  it('从 whisper 池抽动画并避开上一段；池为空时回调 undefined（调用方回落 waving）', () => {
    // 注入固定随机源：抽中池里第一个，第二次就会避开它
    const { controller, played } = setup({ whisperPool: ['擦桌', '发呆'], random: () => 0 })
    controller.request()
    controller.show('a')
    controller.show('b')
    expect(played).toEqual(['擦桌', '发呆'])

    const empty = setup({ whisperPool: [], random: () => 0 })
    empty.controller.request()
    empty.controller.show('a')
    expect(empty.played).toEqual([undefined])
  })

  it('配图开启时把抽中的表情包放进事件载荷，关闭时为 undefined', () => {
    const memes = { 开心: '笑得很开心' }
    const on = setup({ image: true, memes, random: () => 0 })
    on.controller.request()
    expect(on.asked[0]?.event.meme).toEqual({ name: '开心', desc: '笑得很开心' })

    const off = setup({ image: false, memes, random: () => 0 })
    off.controller.request()
    expect(off.asked[0]?.event.meme).toBeUndefined()

    // 开了配图但没配 memes：不编造
    const nothing = setup({ image: true, random: () => 0 })
    nothing.controller.request()
    expect(nothing.asked[0]?.event.meme).toBeUndefined()
  })

  it('空白文本忽略（不抽动画、不弹气泡）', () => {
    const { controller, played, shown } = setup()
    controller.request()
    controller.show('   ')
    controller.show('')
    expect(played).toHaveLength(0)
    expect(shown).toHaveLength(0)
  })

  it('show 的 duration 覆盖默认展示时长', () => {
    const { controller, shown } = setup()
    controller.request()
    controller.show('短一点', { duration: 1234 })
    expect(shown[0]?.options.duration).toBe(1234)
  })

  it('宿主回调抛错只 warn，不打断周期（碎碎念失败静默）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { controller } = setup({
      onMuttering: () => {
        throw new Error('宿主炸了')
      },
    })
    expect(() => controller.tick()).not.toThrow()
    expect(() => controller.tick()).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('挂起（有加载态气泡）只挡自动周期，手动依然可用，且不消费「首拍」', () => {
    let suspended = false
    const { controller, asked, played, shown } = setup({ isSuspended: () => suspended })

    suspended = true
    // 自动周期被挂起（对齐 dsh-pet：`whisperEnabled` 只关自动轮询）
    controller.tick()
    expect(asked).toHaveLength(0)

    // 手动路径不受挂起影响：说话优先于状态展示（`Pet` 层会先清掉状态气泡）
    controller.request()
    expect(asked[0]?.event.reason).toBe('manual')
    controller.show('挂起期间也能说话')
    expect(played).toHaveLength(1)
    expect(shown).toHaveLength(1)

    // 挂起没有消费「首拍」：恢复后的第一次**周期**仍然只记基线
    suspended = false
    controller.tick()
    expect(asked[1]?.event.reason).toBe('baseline')
    controller.show('基线那句被丢弃')
    expect(shown).toHaveLength(1)

    controller.tick()
    controller.show('这一句能展示')
    expect(shown).toHaveLength(2)
  })

  it('dispose 之后全部 no-op', () => {
    const { controller, asked, shown } = setup()
    controller.dispose()
    controller.tick()
    controller.request()
    controller.show('没人听了')
    expect(asked).toHaveLength(0)
    expect(shown).toHaveLength(0)
  })
})
