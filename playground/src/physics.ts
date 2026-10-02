import type { PetVelocity, PhysicsParams } from 'dsh-pet-component'

export interface DragSample {
  t: number
  x: number
  y: number
}

export interface ThrowState extends PetVelocity {
  x: number
  y: number
}

export interface ThrowBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 松手估速只在宿主做一次；命令收到的已经是最终 CSS px/s。 */
export function estimateReleaseVelocity(trail: readonly DragSample[], now: number, throwPower: number): PetVelocity | null {
  const recent = trail.filter(sample => sample.t >= now - 150)
  const first = recent[0]
  const last = recent.at(-1)
  if (!first || !last || now - last.t > 150 || last.t - first.t < 20)
    return null

  // ponytail: 最近窗口的端点均速；需要完全复刻上游手感时再加峰值/加速度采样。
  const dt = (last.t - first.t) / 1000
  const vx = (last.x - first.x) / dt
  const vy = (last.y - first.y) / dt
  const speed = Math.hypot(vx, vy)
  const gain = throwPower / (1 + speed / 3600)
  return speed * gain < 500 ? null : { vx: vx * gain, vy: vy * gain }
}

/** 与上游同量级的重力、回弹、落地摩擦和休止阈值；这里只演示单个舞台。 */
export function stepThrow(state: ThrowState, delta: number, bounds: ThrowBounds, physics: PhysicsParams): ThrowState & { atRest: boolean } {
  const dt = Math.min(0.05, Math.max(0, delta))
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const maxY = Math.max(bounds.minY, bounds.maxY)
  let { vx, vy } = state
  vy += physics.gravity * dt
  let x = state.x + vx * dt
  let y = state.y + vy * dt

  if (maxX === bounds.minX) {
    x = maxX
    vx = 0
  }
  else if (x < bounds.minX) {
    x = bounds.minX
    vx = Math.abs(vx) * physics.restitution
  }
  else if (x > maxX) {
    x = maxX
    vx = -Math.abs(vx) * physics.restitution
  }

  // ceilingBounce=false 与上游一样没有顶边界，靠重力落回。
  if (y < bounds.minY && physics.ceilingBounce) {
    y = bounds.minY
    vy = Math.abs(vy) * physics.restitution
  }
  if (y >= maxY) {
    y = maxY
    vy = -Math.abs(vy) * physics.restitution
    if (Math.abs(vy) < 40)
      vy = 0
    vx *= Math.max(0, 1 - physics.groundFriction * dt)
    if (Math.abs(vx) < 15)
      vx = 0
  }
  if (maxY === bounds.minY) {
    y = maxY
    vy = 0
  }

  return { x, y, vx, vy, atRest: y === maxY && vx === 0 && vy === 0 }
}
