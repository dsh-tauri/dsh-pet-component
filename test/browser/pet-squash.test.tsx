import type { PetRef } from '../../src'
import { act, useRef } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Pet, useControllablePet } from '../../src'
import { dshUri, makeCodexConfig, makeDshConfig, makeSpritesheetDataUrl, query } from './support/fixtures'

for (const kind of ['dsh', 'codex'] as const) {
  it(`${kind} Q 弹：媒体压缩、几何/镜像/动作不变，替换/取消/抓取/拖动/卸载清理`, async () => {
    let pet!: PetRef
    const ref = { current: null as PetRef | null }
    const props = { config: kind === 'dsh' ? makeDshConfig() : makeCodexConfig(), uri: kind === 'dsh' ? dshUri : makeSpritesheetDataUrl() }
    function Host({ dragging = false, ext, uri }: { dragging?: boolean, ext?: string, uri?: string }) {
      const petRef = useRef<PetRef>(null)
      pet = useControllablePet(petRef)
      return (
        <Pet
          {...props}
          config={{ ...props.config }}
          uri={uri ?? (typeof props.uri === 'string' ? props.uri : { ...props.uri })}
          ext={ext ? { default: ext } : undefined}
          ref={(node) => {
            petRef.current = node
            ref.current = node
          }}
          cache={false}
          mirrored
          size={100}
          dragging={dragging}
          lookAtPointer={false}
        />
      )
    }
    const view = await render(<Host />)
    const shell = query(view.container, '.dsh-pet-shell')
    const visual = query(view.container, '.dsh-pet__visual')
    const hitbox = query(view.container, '.dsh-pet__hitbox')
    const media = query(view.container, kind === 'dsh' ? '.dsh-pet__video' : '.dsh-pet__sprite')
    const geometry = pet.geometry
    const motion = pet.current
    const mirrored = getComputedStyle(media).transform
    await act(() => pet.squash(1500))
    await expect.poll(() => Number(shell.style.getPropertyValue('--dsh-pet-squash')) || 1).toBeLessThan(0.9)
    const origin = getComputedStyle(visual).transformOrigin.split(' ').map(Number.parseFloat)
    expect(origin[0]).toBeCloseTo(50)
    expect(origin[1]).toBeCloseTo(geometry!.height, 2)
    expect(pet.geometry).toEqual(geometry)
    expect(pet.current).toBe(motion)
    expect(getComputedStyle(media).transform).toBe(mirrored)
    // 等价的内联配置/平台 URI 不能因宿主位置更新重渲染而截断反馈。
    await act(() => pet.squash())
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    await view.rerender(<Host />)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    const running = shell.style.getPropertyValue('--dsh-pet-squash')
    pet.squash(Number.NaN)
    pet.squash(Infinity)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe(running)
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    expect(getComputedStyle(visual).transform).toBe('matrix(1, 0, 0, 1, 0, 0)')
    if (kind === 'dsh') {
      await act(() => pet.squash())
      await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
      await view.rerender(<Host ext="mov" />)
      expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
      await view.rerender(<Host />)
    }
    await act(() => pet.squash())
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    await view.rerender(<Host uri={`${typeof props.uri === 'string' ? props.uri : props.uri.default}#new-source`} />)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await view.rerender(<Host />)
    await act(() => pet.squash(500))
    await act(() => pet.stopSquash())
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    pet.squash(Number.NaN)
    pet.squash(Infinity)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')

    const pointer = (type: string, x = 20, target: EventTarget = window, button = 0) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, button, pointerId: 1, clientX: x, clientY: 20 }))
    await act(() => {
      pointer('pointerdown', 20, hitbox)
      pointer('pointerup')
    })
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    await act(() => pointer('pointerdown', 20, hitbox))
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await act(() => pointer('pointercancel'))
    await act(() => {
      pointer('pointerdown', 20, hitbox)
      pointer('pointermove', 40)
      pointer('pointermove', 20)
      pointer('pointerup')
    })
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await act(() => {
      pointer('pointerdown', 20, hitbox, 2)
      pointer('pointerup')
    })
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await act(() => pet.squash())
    await view.rerender(<Host dragging />)
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    pet.squash()
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await view.rerender(<Host />)
    await act(() => pet.squash())
    const raw = ref.current!
    await view.unmount()
    raw.squash()
    pet.squash()
    pet.stopSquash()
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
  })
}

it('视频前台/同素材重播沿用媒体反馈，换 renderer 取消旧反馈；陈旧 loadeddata 不重新挤压', async () => {
  const ref = { current: null as PetRef | null }
  const config = makeDshConfig({ animations: { clicks: ['idle'] } })
  const view = await render(<Pet ref={ref} config={config} uri={dshUri} cache={false} mirrored />)
  const shell = query(view.container, '.dsh-pet-shell')
  await expect.poll(() => (query(view.container, '.is-front') as HTMLVideoElement).currentSrc).toContain('idle.webm')
  const old = query(view.container, '.is-front')
  await act(() => ref.current!.squash())
  await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
  await act(() => ref.current!.motion({ type: 'thinking', loop: true }))
  await expect.poll(() => (query(view.container, '.is-front') as HTMLVideoElement).currentSrc).toContain('thinking.webm')
  expect(query(view.container, '.is-front')).not.toBe(old)
  expect(query(view.container, '.is-front').parentElement?.className).toBe('dsh-pet__visual')
  await act(() => ref.current!.squash())
  await act(() => ref.current!.motion({ type: 'waving', replay: true }))
  await expect.poll(() => (query(view.container, '.is-front') as HTMLVideoElement).currentSrc).toContain('idle.webm')
  await act(() => ref.current!.motion({ type: 'waving', replay: true }))
  await act(() => ref.current!.stopSquash())
  old.dispatchEvent(new Event('loadeddata'))
  expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
  await act(() => ref.current!.squash())
  await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
  await view.rerender(<Pet ref={ref} kind="codex" config={makeCodexConfig()} uri={makeSpritesheetDataUrl()} cache={false} mirrored />)
  expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
  await act(() => ref.current!.squash())
  await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
  await view.rerender(<Pet ref={ref} kind="codex" config={makeCodexConfig()} uri={makeSpritesheetDataUrl()} cache={false} hidden />)
  expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
  await view.unmount()
})

it('减少动态效果：开始时跳过，运行中切换即时取消', async () => {
  const original = window.matchMedia.bind(window)
  const media = new EventTarget()
  let reduced = true
  Object.defineProperty(media, 'matches', { get: () => reduced })
  vi.spyOn(window, 'matchMedia').mockImplementation(query => query.includes('prefers-reduced-motion')
    ? media as MediaQueryList
    : original(query))
  const ref = { current: null as PetRef | null }
  try {
    const view = await render(<Pet ref={ref} config={makeCodexConfig()} uri={makeSpritesheetDataUrl()} cache={false} />)
    const shell = query(view.container, '.dsh-pet-shell')
    ref.current!.squash()
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    reduced = false
    await act(() => ref.current!.squash())
    await expect.poll(() => shell.style.getPropertyValue('--dsh-pet-squash')).not.toBe('')
    reduced = true
    media.dispatchEvent(new Event('change'))
    expect(shell.style.getPropertyValue('--dsh-pet-squash')).toBe('')
    await view.unmount()
  }
  finally {
    vi.restoreAllMocks()
  }
})
