import { expect, it } from 'vitest'
import { landingSquash, squashScale } from '../src/hooks/use-pet-squash'

it('上游 Q 弹曲线：点击深度、落地速度、底部回弹过冲和精确恢复', () => {
  expect(squashScale(0, 0.55)).toBe(1)
  expect(squashScale(0.45, 0.55)).toBeCloseTo(0.55)
  expect(squashScale(0.8, 0.55)).toBeGreaterThan(1)
  expect(squashScale(1, 0.55)).toBe(1)
  expect(landingSquash(0)).toBe(0.8)
  expect(landingSquash(300)).toBe(0.8)
  expect(landingSquash(900)).toBeCloseTo(0.775)
  expect(landingSquash(-1500)).toBe(0.55)
  expect(landingSquash(5000)).toBe(0.55)
})
