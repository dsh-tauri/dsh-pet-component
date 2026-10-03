import type { PetGeometry, PetVelocity, PhysicsParams } from 'dsh-pet-component'

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

  // 与上游一致：端点方向、均速/峰值各半、末段加速增益，再指数软限速和力度。
  const dt = (last.t - first.t) / 1000
  const vx = (last.x - first.x) / dt
  const vy = (last.y - first.y) / dt
  const baseSpeed = Math.hypot(vx, vy)
  if (baseSpeed < 1e-6)
    return null
  const segments: { speed: number, end: number }[] = []
  let previous = first
  for (const sample of recent.slice(1)) {
    if (sample.t - previous.t >= 8) {
      segments.push({ speed: Math.hypot(sample.x - previous.x, sample.y - previous.y) / (sample.t - previous.t) * 1000, end: sample.t })
      previous = sample
    }
  }
  const peak = segments.length ? Math.max(...segments.map(segment => segment.speed)) : baseSpeed
  const startSegment = segments[0]
  const endSegment = segments.at(-1)
  const acceleration = startSegment && endSegment && segments.length >= 2
    ? (endSegment.speed - startSegment.speed) / Math.max((endSegment.end - startSegment.end) / 1000, 0.02)
    : 0
  const beforeClamp = (baseSpeed * 0.5 + peak * 0.5) * (1 + Math.min(1, Math.max(0, acceleration) / 8000) * 0.6)
  const speed = 3600 * (1 - Math.exp(-beforeClamp / 3600)) * throwPower
  return speed < 500 ? null : { vx: vx / baseSpeed * speed, vy: vy / baseSpeed * speed }
}

/**
 * 从实测身体构造舞台边界：水平透明边允许出界；脚底而非透明画布贴地。
 * Dsh 素材脚底 y=330/360；Codex 使用 hitbox 底部，均使用真实 DOM 尺寸而非固定比例。
 */
export function bodyBounds(geometry: PetGeometry, width: number, height: number, dsh: boolean): ThrowBounds {
  const feet = dsh ? geometry.height * 330 / 360 : geometry.body.bottom - geometry.y
  return {
    minX: -(geometry.body.left - geometry.x),
    maxX: width - (geometry.body.right - geometry.x),
    minY: 0,
    maxY: height - feet,
  }
}

export interface Collider {
  geometry: PetGeometry
  velocity: PetVelocity
}

/** 上游 e=.995、质量∝宽²、法向动量守恒；DOM 身体 AABB 避免硬套 Dsh 比例。 */
export function collidePets(a: Collider, b: Collider): { a: PetVelocity, b: PetVelocity } | null {
  const ab = a.geometry.body
  const bb = b.geometry.body
  if (!(ab.left < bb.right && ab.right > bb.left && ab.top < bb.bottom && ab.bottom > bb.top))
    return null
  const dx = b.geometry.x + b.geometry.width / 2 - a.geometry.x - a.geometry.width / 2
  const dy = b.geometry.y + b.geometry.height / 2 - a.geometry.y - a.geometry.height / 2
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-6)
    return null
  const nx = dx / distance
  const ny = dy / distance
  const v1 = a.velocity.vx * nx + a.velocity.vy * ny
  const v2 = b.velocity.vx * nx + b.velocity.vy * ny
  if (v1 - v2 <= 0)
    return null
  const m1 = a.geometry.width ** 2
  const m2 = b.geometry.width ** 2
  const n1 = ((m1 - 0.995 * m2) * v1 + 1.995 * m2 * v2) / (m1 + m2)
  const n2 = ((m2 - 0.995 * m1) * v2 + 1.995 * m1 * v1) / (m1 + m2)
  return {
    a: { vx: a.velocity.vx + (n1 - v1) * nx, vy: a.velocity.vy + (n1 - v1) * ny },
    b: { vx: b.velocity.vx + (n2 - v2) * nx, vy: b.velocity.vy + (n2 - v2) * ny },
  }
}

/** 与上游一致的单舞台重力、回弹、落地摩擦和休止阈值。 */
export function stepThrow(state: ThrowState, delta: number, bounds: ThrowBounds, physics: PhysicsParams): ThrowState & { atRest: boolean, landed: boolean, impactSpeed: number } {
  const dt = Math.min(0.05, Math.max(0, delta))
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const maxY = Math.max(bounds.minY, bounds.maxY)
  let { vx, vy } = state
  vy += physics.gravity * dt
  let x = state.x + vx * dt
  let y = state.y + vy * dt
  let bounced = false

  if (maxX === bounds.minX) {
    x = maxX
    vx = 0
  }
  else if (x < bounds.minX) {
    x = bounds.minX
    vx = Math.abs(vx) * physics.restitution
    bounced = true
  }
  else if (x > maxX) {
    x = maxX
    vx = -Math.abs(vx) * physics.restitution
    bounced = true
  }

  // ceilingBounce=false 与上游一样没有顶边界，靠重力落回。
  if (y < bounds.minY && physics.ceilingBounce) {
    y = bounds.minY
    vy = Math.abs(vy) * physics.restitution
    bounced = true
  }
  const landed = state.y < maxY - 1 && y >= maxY
  const impactSpeed = Math.abs(state.vy)
  if (y >= maxY) {
    y = maxY
    vy = Math.abs(vy) < 40 ? 0 : -Math.abs(vy) * physics.restitution
    vx *= Math.max(0, 1 - physics.groundFriction * dt)
    bounced = true
  }
  if (maxY === bounds.minY) {
    y = maxY
    vy = 0
  }

  const atRest = (y >= maxY - 1 && Math.abs(vx) < 15 && Math.abs(vy) < 1)
    || (bounced && Math.hypot(vx, vy) < 40 && Math.abs(vy) < 1)
  return { x, y, vx, vy, landed, impactSpeed, atRest }
}
