import type { CSSProperties } from 'react'
import type { PetGeometry, PetProps, PetRef } from '../../src'
import { createRef, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Pet, useControllablePet } from '../../src'
import { configDataUrl, dshUri, makeCodexConfig, makeDshConfig, makeSpritesheetDataUrl, query } from './support/fixtures'

function geometryOf(root: HTMLElement): PetGeometry {
  const box = root.getBoundingClientRect()
  const body = query(root, '.dsh-pet__hitbox').getBoundingClientRect()
  return {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
    body: { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
  }
}

for (const kind of ['dsh', 'codex'] as const) {
  describe(`物理接口（${kind}）`, () => {
    it('实时测量 renderer 与 hitbox，速度原样回调，不移动宠物或改变动作', async () => {
      const ref = createRef<PetRef>()
      const hitboxCleanup = vi.fn()
      const hitboxRef = vi.fn(() => hitboxCleanup)
      const onFling = vi.fn()
      const onBounce = vi.fn()
      const onHitboxPointerMove = vi.fn()
      const { container, unmount } = await render(
        <div data-host style={{ transform: 'translate(20px, 30px)' }}>
          <Pet
            kind={kind}
            ref={ref}
            config={kind === 'dsh' ? configDataUrl(makeDshConfig({ physics: { gravity: 600, restitution: 0.4, ceilingBounce: false } })) : makeCodexConfig()}
            uri={kind === 'dsh' ? dshUri : makeSpritesheetDataUrl()}
            cache={false}
            lookAtPointer={false}
            motion="working"
            style={{ position: 'absolute', width: 200, height: 100 }}
            physics={{ gravity: 0, restitution: undefined, groundFriction: 0, throwPower: 3, petCollision: false }}
            hitboxRef={hitboxRef}
            onFling={onFling}
            onBounce={onBounce}
            onHitboxPointerMove={onHitboxPointerMove}
          />
        </div>,
      )
      let pet = ref.current!
      const root = query(container, '.dsh-pet')
      const host = query(container, '[data-host]')
      const hitbox = query(root, '.dsh-pet__hitbox')
      expect(pet.geometry).toEqual(geometryOf(root))
      expect(pet.geometry).toMatchObject({ width: 200, height: 100 })

      // 地址配置加载后再调用；显式 undefined 不覆盖配置的 restitution。
      if (kind === 'dsh') {
        await expect.poll(() => {
          onFling.mockClear()
          ref.current!.fling({ vx: 1, vy: 0 })
          return onFling.mock.lastCall?.[0].physics.restitution
        }).toBe(0.4)
        pet = ref.current!
        onFling.mockClear()
      }

      const before = pet.geometry!
      const position = root.getAttribute('style')
      pet.fling({ vx: -12, vy: 0 })
      pet.bounce({ vx: 0, vy: 4 })
      expect(onFling).toHaveBeenCalledTimes(1)
      expect(onBounce).toHaveBeenCalledTimes(1)
      expect(onFling).toHaveBeenLastCalledWith({
        vx: -12,
        vy: 0,
        geometry: before,
        physics: { gravity: 0, restitution: kind === 'dsh' ? 0.4 : 0.78, groundFriction: 0, ceilingBounce: kind !== 'dsh', throwPower: 3, petCollision: false },
      })
      expect(onBounce.mock.lastCall?.[0]).toMatchObject({ vx: 0, vy: 4, geometry: before })
      expect(root.getAttribute('style')).toBe(position)
      expect(pet.current).toBe('working')

      hitbox.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 42, clientY: 21 }))
      expect(onHitboxPointerMove).toHaveBeenCalledTimes(1)
      expect(onHitboxPointerMove.mock.lastCall?.[0].clientX).toBe(42)
      expect(hitboxRef).toHaveBeenCalledTimes(1)

      // 宿主直接更新 DOM，不依赖 React rerender 或 ResizeObserver。
      host.style.transform = 'translate(80px, 70px) scale(1.5)'
      expect(pet.geometry).toEqual(geometryOf(root))
      expect(pet.geometry).toMatchObject({ width: 300, height: 150 })
      expect(pet.geometry).not.toEqual(before)
      expect(onFling.mock.lastCall?.[0].geometry).toEqual(before)

      // 事件参数是快照，修改它不会污染后续命令。
      onFling.mock.lastCall![0].physics.gravity = 999
      pet.fling({ vx: 0, vy: -4 })
      expect(onFling.mock.lastCall?.[0].physics.gravity).toBe(0)
      for (const velocity of [{ vx: Number.NaN, vy: 0 }, { vx: 0, vy: Infinity }]) {
        pet.fling(velocity)
        pet.bounce(velocity)
      }
      expect(onFling).toHaveBeenCalledTimes(2)
      expect(onBounce).toHaveBeenCalledTimes(1)

      host.style.display = 'none'
      expect(pet.geometry).toBeNull()
      pet.fling({ vx: 1, vy: 1 })
      pet.bounce({ vx: 1, vy: 1 })
      expect(onFling).toHaveBeenCalledTimes(2)
      expect(onBounce).toHaveBeenCalledTimes(1)
      await unmount()
      expect(hitboxCleanup).toHaveBeenCalledTimes(1)
      expect(pet.geometry).toBeNull()
      pet.fling({ vx: 1, vy: 1 })
      pet.bounce({ vx: 1, vy: 1 })
      expect(onFling).toHaveBeenCalledTimes(2)
      expect(onBounce).toHaveBeenCalledTimes(1)
    })
  })
}

it('稳定命令面读取重渲染后的回调、配置与几何；缺少监听器时安全空操作', async () => {
  const observed: PetRef[] = []
  function Host(props: Pick<PetProps, 'onFling' | 'onBounce' | 'physics'> & { config?: PetProps['config'], style?: CSSProperties }) {
    const ref = useRef<PetRef>(null)
    const pet = useControllablePet(ref)
    observed.push(pet)
    return <Pet ref={ref} config={makeDshConfig()} uri={dshUri} cache={false} {...props} />
  }
  const first = vi.fn()
  const second = vi.fn()
  const view = await render(<Host config={makeDshConfig({ physics: { gravity: 100 } })} onFling={first} onBounce={first} />)
  const pet = observed[0]!
  pet.fling({ vx: 1, vy: 2 })
  expect(first.mock.lastCall?.[0].physics.gravity).toBe(100)

  await view.rerender(<Host onFling={second} onBounce={second} physics={{ gravity: 200 }} style={{ width: 240 }} />)
  expect(observed.every(handle => handle === pet)).toBe(true)
  pet.fling({ vx: 3, vy: 4 })
  pet.bounce({ vx: -3, vy: -4 })
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(2)
  expect(second.mock.lastCall?.[0]).toMatchObject({ vx: -3, vy: -4, physics: { gravity: 200 }, geometry: { width: 240 } })

  await view.rerender(<Host />)
  expect(() => pet.fling({ vx: 1, vy: 2 })).not.toThrow()
  expect(() => pet.bounce({ vx: 1, vy: 2 })).not.toThrow()
  expect(second).toHaveBeenCalledTimes(2)
  await view.unmount()
  expect(pet.geometry).toBeNull()
  expect(() => pet.fling({ vx: 1, vy: 2 })).not.toThrow()
  expect(() => pet.bounce({ vx: 1, vy: 2 })).not.toThrow()
})
