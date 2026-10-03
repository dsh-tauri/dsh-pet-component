import { expect, it } from 'vitest'
import { bodyBounds, collidePets, estimateReleaseVelocity, stepThrow } from '../playground/src/physics'
import { resolvePhysics } from '../src/config'

it('playground 宿主：松手仅估速一次，边界回弹、落地摩擦并最终休止', () => {
  const trail = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 100, y: -50 }]
  const release = estimateReleaseVelocity(trail, 60, 1)!
  expect(release.vx).toBeGreaterThan(500)
  expect(release.vy).toBeLessThan(0)
  expect(estimateReleaseVelocity(trail, 60, 2)).toEqual({ vx: release.vx * 2, vy: release.vy * 2 })
  expect(estimateReleaseVelocity(trail, 210, 1)).toBeNull()
  expect(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }], 10, 1)).toBeNull()
  expect(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 100, x: 1, y: 1 }], 100, 1)).toBeNull()
  expect(estimateReleaseVelocity([], 0, 1)).toBeNull()

  const bounds = { minX: 0, minY: 0, maxX: 300, maxY: 200 }
  const physics = resolvePhysics({ gravity: 0, restitution: 0.5 })
  expect(stepThrow({ x: 299, y: 100, vx: 100, vy: 0 }, 0.05, bounds, physics))
    .toMatchObject({ x: 300, vx: -50 })
  expect(stepThrow({ x: 1, y: 100, vx: -100, vy: 0 }, 0.05, bounds, physics))
    .toMatchObject({ x: 0, vx: 50 })
  expect(stepThrow({ x: 100, y: 1, vx: 0, vy: -100 }, 0.05, bounds, physics))
    .toMatchObject({ y: 0, vy: 50 })
  expect(stepThrow({ x: 100, y: 1, vx: 0, vy: -100 }, 0.05, bounds, { ...physics, ceilingBounce: false }))
    .toMatchObject({ y: -4, vy: -100 })
  expect(stepThrow({ x: 100, y: 220, vx: 0, vy: -100 }, 0.05, bounds, physics))
    .toMatchObject({ y: 200, vy: -50 })
  const initial = { x: 100, y: 100, vx: 100, vy: 100 }
  expect(stepThrow(initial, 1, bounds, physics)).toEqual(stepThrow(initial, 0.05, bounds, physics))
  expect(stepThrow(initial, -1, bounds, physics)).toMatchObject(initial)
  expect(stepThrow(initial, 0.01, { ...bounds, maxX: -1, maxY: -1 }, physics))
    .toMatchObject({ x: 0, y: 0, vx: 0, vy: 0, atRest: true })

  let next = stepThrow({ x: 100, y: 0, ...release }, 1 / 60, bounds, resolvePhysics(undefined))
  for (let frame = 0; frame < 1200 && !next.atRest; frame++) {
    next = stepThrow(next, 1 / 60, bounds, resolvePhysics(undefined))
    expect(next.x).toBeGreaterThanOrEqual(0)
    expect(next.x).toBeLessThanOrEqual(300)
    expect(next.y).toBeGreaterThanOrEqual(0)
    expect(next.y).toBeLessThanOrEqual(200)
  }
  expect(next).toMatchObject({ y: 200, vy: 0, atRest: true })
  expect(Math.abs(next.vx)).toBeLessThan(40)
  expect(stepThrow({ x: 299, y: 100, vx: 10, vy: 0 }, 0.05, { ...bounds, maxX: 299 }, physics).atRest).toBe(true)
  expect(stepThrow({ x: 100, y: 199, vx: 0, vy: 45 }, 0.05, bounds, physics).vy).toBe(-22.5)
})

it('完整估速：指数上限、峰值/末段加速度、密集采样与抖动方向', () => {
  const equal = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 100, y: 0 }, { t: 100, x: 200, y: 0 }]
  expect(estimateReleaseVelocity(equal, 100, 1)?.vx).toBeCloseTo(3600 * (1 - Math.exp(-2000 / 3600)))
  const accelerating = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 10, y: 0 }, { t: 100, x: 200, y: 0 }]
  expect(estimateReleaseVelocity(accelerating, 100, 1)!.vx).toBeGreaterThan(estimateReleaseVelocity(equal, 100, 1)!.vx)
  expect(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 0 }, { t: 30, x: 100, y: 0 }], 30, 1)!.vx).toBeGreaterThan(500)
  expect(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 30, x: 100, y: 0 }, { t: 60, x: 0, y: 0 }], 60, 1)).toBeNull()
})

it('身体边界/落地事件/宠物碰撞：质量、法向、分离与静止目标', () => {
  const geometry = { x: 0, y: 0, width: 100, height: 100, body: { left: 25, top: 10, right: 75, bottom: 95 } }
  expect(bodyBounds(geometry, 500, 300, false)).toEqual({ minX: -25, maxX: 425, minY: 0, maxY: 205 })
  expect(bodyBounds(geometry, 500, 300, true).maxY).toBeCloseTo(300 - 100 * 330 / 360)
  const params = resolvePhysics({ gravity: 0, restitution: 0.5 })
  const landed = stepThrow({ x: 0, y: 190, vx: 0, vy: 1000 }, 0.05, { minX: 0, maxX: 500, minY: 0, maxY: 200 }, params)
  expect(landed).toMatchObject({ landed: true, impactSpeed: 1000, vy: -500 })
  expect(stepThrow({ x: 0, y: 200, vx: 0, vy: 0 }, 0.01, { minX: 0, maxX: 500, minY: 0, maxY: 200 }, params).landed).toBe(false)
  const a = { geometry, velocity: { vx: 1000, vy: 100 } }
  const b = { geometry: { ...geometry, x: 40, body: { left: 65, top: 10, right: 115, bottom: 95 } }, velocity: { vx: 0, vy: 100 } }
  const result = collidePets(a, b)!
  expect(result.a).toEqual({ vx: 2.5, vy: 100 })
  expect(result.b).toEqual({ vx: 997.5, vy: 100 })
  expect(collidePets({ ...a, velocity: result.a }, { ...b, velocity: result.b })).toBeNull()
  expect(collidePets(a, { ...b, geometry })).toBeNull()
  expect(collidePets(a, { ...b, geometry: { ...b.geometry, body: { left: 75, right: 125, top: 10, bottom: 95 } } })).toBeNull()
  const heavy = collidePets(a, { ...b, geometry: { ...b.geometry, width: 200 } })!
  expect(heavy.a.vx).toBeLessThan(0)
})
