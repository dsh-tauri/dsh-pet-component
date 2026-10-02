import { expect, it } from 'vitest'
import { estimateReleaseVelocity, stepThrow } from '../playground/src/physics'
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
  expect(next).toMatchObject({ y: 200, vx: 0, vy: 0, atRest: true })
})
