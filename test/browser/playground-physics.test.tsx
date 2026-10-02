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

function pointer(target: EventTarget, type: string, x: number, y: number, t: number) {
  const event = new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
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

    function Host({ autoFling = true }: { autoFling?: boolean }) {
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
              physics={{ gravity: 0, groundFriction: 0, throwPower: 2, restitution: 0.5 }}
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
    await act(() => pointer(window, 'pointerup', x + 140, y, 2105))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(onFling.mock.lastCall?.[0].vx).toBeCloseTo(2016, 0)
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

    await view.rerender(<Host autoFling={false} />)
    box = hitbox.getBoundingClientRect()
    x = box.left + box.width / 2
    y = box.top + box.height / 2
    await act(() => pointer(hitbox, 'pointerdown', x, y, 4000))
    await act(() => pointer(window, 'pointermove', x + 80, y, 4050))
    await act(() => pointer(window, 'pointerup', x + 80, y, 4055))
    expect(onFling).toHaveBeenCalledTimes(2)
    expect(host.flying).toBe(false)

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
