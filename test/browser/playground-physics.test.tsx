/// <reference types="vite/client" />

import type { PetRef } from '../../src'
import { del, get, set } from 'idb-keyval'
import { act, useRef } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PetDemo } from '../../playground/src/components/demo'
import { usePetPhysics } from '../../playground/src/hooks/use-pet-physics'
import { PLAYGROUND_PREFS_KEY } from '../../playground/src/hooks/use-playground-prefs'
import { Pet, useControllablePet } from '../../src'
import { clearConfigCache } from '../../src/utils/fetch'
import { MEDIA_CACHE_PREFIX } from '../../src/utils/media-cache'
import { dshUri, makeCodexConfig, makeDshConfig, makeSpritesheetDataUrl, query } from './support/fixtures'
import '../../playground/src/App.css'
import '../../playground/src/index.css'

function pointer(target: EventTarget, type: string, x: number, y: number, t: number, pointerId = 1, isPrimary = true) {
  const event = new PointerEvent(type, { bubbles: true, pointerId, isPrimary, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'timeStamp', { value: t })
  target.dispatchEvent(event)
}

for (const kind of ['dsh', 'codex'] as const) {
  it(`playground ${kind}：甩动/弹开实际移动，重新抓取/取消/禁用安全停止，几何持续回读`, async () => {
    let host!: ReturnType<typeof usePetPhysics> & { pet: PetRef }
    const onFling = vi.fn()
    const onBounce = vi.fn()
    const config = kind === 'dsh' ? makeDshConfig() : makeCodexConfig()
    const uri = kind === 'dsh' ? dshUri : makeSpritesheetDataUrl()

    function Host({ autoFling = true, restitution = 0.5 }: { autoFling?: boolean, restitution?: number }) {
      const stageRef = useRef<HTMLDivElement>(null)
      const petRef = useRef<PetRef>(null)
      const pet = useControllablePet(petRef)
      const physics = usePetPhysics(pet, stageRef, autoFling, 2)
      const { drag } = physics
      host = { ...physics, pet }
      return (
        <div ref={stageRef} data-stage style={{ position: 'relative', width: 500, height: 340 }}>
          <div ref={drag.boxRef} data-box style={{ position: 'absolute', left: drag.x, top: drag.y, pointerEvents: 'none' }}>
            <Pet
              ref={petRef}
              config={config}
              uri={uri}
              cache={false}
              lookAtPointer={false}
              size={80}
              dragging={drag.dragging}
              hitboxRef={drag.handleRef}
              onHitboxPointerDown={drag.onHitboxPointerDown}
              onHitboxPointerUp={drag.onHitboxPointerUp}
              onHitboxPointerCancel={drag.onHitboxPointerUp}
              physics={{ gravity: 0, groundFriction: 0, throwPower: 2, restitution }}
              onFling={(event) => {
                onFling(event)
                physics.onPhysics(event)
              }}
              onBounce={(event) => {
                onBounce(event)
                physics.onPhysics(event)
              }}
            />
          </div>
        </div>
      )
    }

    const view = await render(<Host />)
    const hitbox = query(view.container, '.dsh-pet__hitbox')
    const root = query(view.container, '.dsh-pet')
    const stage = query(view.container, '[data-stage]')
    await expect.poll(() => host.geometry?.width).toBe(80)

    await act(() => host.pet.fling({ vx: 1000, vy: 0 }))
    expect(onFling.mock.lastCall?.[0]).toMatchObject({ vx: 1000, vy: 0, physics: { throwPower: 2 } })
    await expect.poll(() => host.drag.x).toBeGreaterThan(20)
    await act(() => {
      host.stop()
      host.drag.setPosition({ x: 160, y: 60 })
    })
    await act(() => host.pet.bounce({ vx: -300, vy: 0 }))
    expect(onBounce.mock.lastCall?.[0]).toMatchObject({ vx: -300, vy: 0 })
    await expect.poll(() => host.drag.x).toBeLessThan(150)
    expect(host.velocity.vx).toBe(-300)
    await act(() => host.reset())
    expect(host.flying).toBe(false)
    expect(host.drag.x).toBe(0)
    expect(host.drag.y).toBe(0)

    let box = hitbox.getBoundingClientRect()
    let x = box.left + box.width / 2
    let y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 1000))
    await act(() => pointer(window, 'pointermove', x + 2, y, 1040))
    expect(host.drag.dragging).toBe(false)
    expect(host.drag.x).toBe(0)
    expect(host.drag.y).toBe(0)
    await act(() => pointer(window, 'pointerup', x + 2, y, 1045))
    expect(onFling).toHaveBeenCalledTimes(1)

    box = hitbox.getBoundingClientRect()
    x = box.left + box.width / 2
    y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 2000))
    await act(() => pointer(window, 'pointermove', x + 80, y, 2050))
    expect(host.drag.dragging).toBe(true)
    await act(() => pointer(window, 'pointermove', x + 140, y, 2100))
    expect(host.drag.direction).toBe('right')
    await expect.poll(() => host.drag.x).toBeGreaterThan(0)
    expect(host.drag.x).toBeLessThan(140)
    await act(() => pointer(window, 'pointerup', x + 140, y, 2105))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(onFling.mock.lastCall?.[0].vx).toBeCloseTo(3600 * (1 - Math.exp(-1200 / 3600)) * 2, 0)
    expect(host.flying).toBe(true)

    box = hitbox.getBoundingClientRect()
    x = box.left + box.width / 2
    y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 3000))
    expect(host.flying).toBe(false)
    expect(host.velocity).toEqual({ vx: 0, vy: 0 })
    await act(() => pointer(window, 'pointermove', x + 80, y, 3050))
    await act(() => pointer(window, 'pointercancel', x + 80, y, 3055))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(host.drag.dragging).toBe(false)
    expect(host.drag.pressed).toBe(false)

    for (const interruption of ['blur', 'lostpointercapture'] as const) {
      await act(() => pointer(hitbox, 'pointerdown', x, y, 3200))
      await act(() => pointer(window, 'pointermove', x + 80, y, 3250, 2))
      expect(host.drag.dragging).toBe(false)
      await act(() => pointer(window, 'pointermove', x + 80, y, 3250))
      await act(() => pointer(window, 'pointerup', x + 80, y, 3255, 2))
      expect(host.drag.dragging).toBe(true)
      if (interruption === 'blur')
        await act(() => window.dispatchEvent(new Event('blur')))
      else
        await act(() => pointer(window, interruption, x, y, 3260))
      expect(host.drag.dragging).toBe(false)
      expect(host.drag.pressed).toBe(false)
      await act(() => pointer(window, 'pointerup', x + 140, y, 3300))
      expect(onFling).toHaveBeenCalledTimes(2)
    }
    await act(() => pointer(hitbox, 'pointerdown', x, y, 3400, 2, false))
    expect(host.drag.pressed).toBe(false)
    await act(() => pointer(hitbox, 'pointerdown', x, y, 3500))
    await act(() => pointer(window, 'pointermove', x + 80, y, 3550))
    await act(() => host.pet.bounce({ vx: -200, vy: 0 }))
    expect(host.drag.dragging).toBe(false)
    await act(() => pointer(window, 'pointerup', x + 140, y, 3600))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(host.flying).toBe(true)
    await act(() => host.reset())

    await view.rerender(<Host autoFling={false} />)
    box = hitbox.getBoundingClientRect()
    x = box.left + box.width / 2
    y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 4000))
    await act(() => pointer(window, 'pointermove', x + 80, y, 4050))
    await act(() => pointer(window, 'pointerup', x + 80, y, 4055))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(host.flying).toBe(false)

    // 真正空中→落地才报告冲击；落定保留 220ms 反馈，不被 stop() 立即抹掉。
    await view.rerender(<Host restitution={0} />)
    await act(() => {
      host.reset()
      host.drag.setPosition({ x: 100, y: 220 })
    })
    await act(() => host.pet.fling({ vx: 0, vy: 1500 }))
    const shell = query(view.container, '.dsh-pet-shell')
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    expect(host.flying).toBe(false)
    const visual = query(view.container, '.dsh-pet__visual')
    await expect.poll(() => getComputedStyle(visual).transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await act(() => host.pet.bounce({ vx: 0, vy: 0 }))
    await expect.poll(() => host.flying).toBe(false)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')

    // 重抓身体贴地/贴墙的位置，门槛后的弹簧不应按透明画布夹取而瞬间跳回。
    const body = host.pet.geometry!
    const edgeX = -(body.body.left - body.x)
    const floorY = stage.clientHeight - (kind === 'dsh' ? body.height * 330 / 360 : body.body.bottom - body.y)
    await act(() => host.drag.setPosition({ x: edgeX, y: floorY }))
    box = hitbox.getBoundingClientRect()
    x = box.left + box.width / 2
    y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 4500))
    await act(() => pointer(window, 'pointermove', x - 10, y + 10, 4550))
    await expect.poll(() => host.drag.dragging).toBe(true)
    await expect.poll(() => host.drag.y).toBeCloseTo(floorY)
    expect(host.drag.x).toBeCloseTo(edgeX)
    await act(() => pointer(window, 'pointercancel', x - 10, y + 10, 4555))

    stage.style.transform = 'translate(25px, 20px)'
    await expect.poll(() => host.geometry?.x).toBe(root.getBoundingClientRect().left)
    await expect.poll(() => host.geometry?.body.bottom).toBe(hitbox.getBoundingClientRect().bottom)
    const pet = host.pet
    await view.unmount()
    expect(pet.geometry).toBeNull()
  })
}

it('petDemo 面板：甩出/弹开/停止/复位真实接线，参数与几何可回显', async () => {
  const source = 'https://unpkg.com/@signalight/dsh-codex-pet@0.3.1/assets/nastya/spritesheet.webp'
  const key = MEDIA_CACHE_PREFIX + source
  const stored = await get(key)
  const prefs = localStorage.getItem(PLAYGROUND_PREFS_KEY)
  const realFetch = globalThis.fetch
  const image = await realFetch(makeSpritesheetDataUrl()).then(response => response.blob())
  await set(key, { source, blob: image }) // 真缓存避免素材联网；只替换远程配置。
  localStorage.setItem(PLAYGROUND_PREFS_KEY, JSON.stringify({ asset: 'codex', sizes: { dsh: 160, codex: 80 }, cache: true, lookAtPointer: false }))
  clearConfigCache()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(makeCodexConfig()))))
  const view = await render(<PetDemo />)
  const button = (text: string) => {
    const element = [...view.container.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
    if (!element)
      throw new Error(`找不到按钮：${text}`)
    return element
  }
  const command = () => query(view.container, '.readout > div:nth-child(8)').textContent
  const box = query(view.container, '.stage__pet')
  const root = query(view.container, '.dsh-pet')
  const stage = query(view.container, '.stage')
  try {
    await expect.poll(() => query(view.container, '.readout').textContent).toContain('width 80')
    const input = [...view.container.querySelectorAll<HTMLInputElement>('.slider input')].find(item => item.closest('label')?.textContent?.includes('边界回弹系数'))!
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0.3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.closest('label')?.textContent).toContain('0.3')
    await act(() => button('向右上甩出').click())
    await expect.poll(command).toContain('vx: 1100, vy: -700')
    await expect.poll(() => Number.parseFloat(box.style.left)).toBeGreaterThan(10)
    await act(() => button('模拟碰撞弹开').click())
    expect(command()).toContain('vx: -900, vy: -500')
    await act(() => button('停止飞行').click())
    expect(query(view.container, '.readout').textContent).toContain('已停止')
    await act(() => button('复位位置').click())
    expect(box.style.left).toBe('0px')
    expect(box.style.top).toBe('0px')
    // 实际面板开关/增益：不是替代 Host，验证 DOM change 到下一次释放。
    const auto = [...view.container.querySelectorAll<HTMLInputElement>('.switch input')].find(item => item.closest('label')?.textContent?.includes('拖动松手甩出'))!
    const power = [...view.container.querySelectorAll<HTMLInputElement>('.slider input')].find(item => item.closest('label')?.textContent?.includes('松手甩动增益'))!
    const dragRelease = async (time: number) => {
      const hitbox = query(view.container, '.dsh-pet__hitbox')
      const r = hitbox.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      await act(() => pointer(hitbox, 'pointerdown', x, y, time))
      await act(() => pointer(window, 'pointermove', x + 30, y, time + 50))
      await act(() => pointer(window, 'pointermove', x + 130, y, time + 100))
      await act(() => pointer(window, 'pointerup', x + 130, y, time + 105))
    }
    await act(() => auto.click())
    expect(auto.checked).toBe(false)
    const before = command()
    await dragRelease(5000)
    expect(command()).toBe(before)
    await act(() => {
      auto.click()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(power, '2')
      power.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(power.closest('label')?.textContent).toContain('2')
    await dragRelease(6000)
    expect(command()).toContain('pet.fling')
    await act(() => button('停止飞行').click())
    await act(() => button('复位位置').click())
    await act(() => button('挤压回弹').click())
    await expect.poll(() => query(view.container, '.dsh-pet-shell').style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    await act(() => button('停止飞行').click())
    const collision = [...view.container.querySelectorAll<HTMLInputElement>('.switch input')].find(item => item.closest('label')?.textContent?.includes('双宠实际碰撞'))!
    await act(() => collision.click())
    expect(view.container.querySelectorAll('.dsh-pet')).toHaveLength(2)
    const second = query(view.container, '[data-collision-pet]')
    // 把静止目标摆在主宠轨道，验证真实 hitbox 重叠解算，双方最终速度被替换。
    second.style.left = '90px'
    second.style.top = '0px'
    await act(() => button('向右上甩出').click())
    await expect.poll(() => collision.closest('label')?.textContent).not.toContain('已解算 0 次')
    await expect.poll(() => Number.parseFloat(second.style.left)).toBeGreaterThan(90)
    await act(() => collision.click())
    expect(view.container.querySelectorAll('.dsh-pet')).toHaveLength(1)
    await act(() => button('停止飞行').click())
    stage.style.transform = 'translate(20px, 15px)'
    await expect.poll(() => query(view.container, '.readout').textContent).toContain(`x ${Math.round(root.getBoundingClientRect().left)}, y ${Math.round(root.getBoundingClientRect().top)}`)
  }
  finally {
    await view.unmount()
    vi.unstubAllGlobals()
    clearConfigCache()
    if (prefs === null)
      localStorage.removeItem(PLAYGROUND_PREFS_KEY)
    else
      localStorage.setItem(PLAYGROUND_PREFS_KEY, prefs)
    if (stored === undefined)
      await del(key)
    else
      await set(key, stored)
  }
})
