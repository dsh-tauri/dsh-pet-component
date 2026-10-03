import type { PetGeometry, PetPhysicsEvent, PetRef, PetVelocity, PhysicsParams } from 'dsh-pet-component'
import type { RefObject } from 'react'
import type { DragSample, ThrowState } from '../physics'
import { useRafFn } from '@reause/core'
import { useCallback, useRef, useState } from 'react'
import { bodyBounds, estimateReleaseVelocity, stepThrow } from '../physics'
import { usePetDrag } from './use-pet-drag'

/** Playground 宿主：组件只发请求，这里才真正移动；卸载由 useRafFn 清理。 */
export function usePetPhysics(pet: PetRef, stageRef: RefObject<HTMLDivElement | null>, autoFling: boolean, throwPower: number) {
  const flightRef = useRef<{ state: ThrowState, physics: PhysicsParams } | null>(null)
  const readAtRef = useRef(0)
  const [geometry, setGeometry] = useState<PetGeometry | null>(null)
  const [velocity, setVelocity] = useState<PetVelocity>({ vx: 0, vy: 0 })
  const [flying, setFlying] = useState(false)

  const stop = useCallback(() => {
    flightRef.current = null
    pet.stopSquash()
    setFlying(false)
    setVelocity({ vx: 0, vy: 0 })
  }, [pet])

  const onRelease = useCallback((trail: readonly DragSample[], now: number) => {
    if (!autoFling)
      return
    const release = estimateReleaseVelocity(trail, now, throwPower)
    if (release !== null)
      pet.fling(release)
  }, [autoFling, pet, throwPower])

  const getBounds = useCallback((box: HTMLDivElement) => {
    const current = pet.geometry
    const stage = stageRef.current
    return current && stage
      ? bodyBounds(current, stage.clientWidth, stage.clientHeight, Boolean(box.querySelector('.dsh-pet__video')))
      : null
  }, [pet, stageRef])
  const drag = usePetDrag({ containerRef: stageRef, onStart: stop, onRelease, throwPower, getBounds })
  const { boxRef, setPosition, cancel, reset: resetDrag } = drag

  // fling 和 bounce 都用新绝对速度从当前位置重启；不叠加、不再乘 throwPower。
  const onPhysics = useCallback((event: PetPhysicsEvent) => {
    cancel()
    const box = boxRef.current
    if (box === null || stageRef.current === null)
      return
    flightRef.current = {
      state: { x: box.offsetLeft, y: box.offsetTop, vx: event.vx, vy: event.vy },
      physics: event.physics,
    }
    setGeometry(event.geometry)
    setVelocity({ vx: event.vx, vy: event.vy })
    setFlying(true)
  }, [boxRef, cancel, stageRef])

  useRafFn(({ delta, timestamp }) => {
    const flight = flightRef.current
    if (flight === null && timestamp - readAtRef.current < 100)
      return
    const current = pet.geometry
    const stage = stageRef.current
    if (flight !== null) {
      if (current === null || stage === null) {
        stop()
      }
      else {
        const dsh = Boolean(boxRef.current?.querySelector('.dsh-pet__video'))
        const bounds = bodyBounds(current, stage.clientWidth, stage.clientHeight, dsh)
        const next = stepThrow(flight.state, delta / 1000, bounds, flight.physics)
        flight.state = next
        setPosition(next)
        if (next.atRest) {
          // 自然落定不能取消刚触发的落地反馈。
          flightRef.current = null
          setFlying(false)
          setVelocity({ vx: 0, vy: 0 })
        }
        if (next.landed)
          pet.squash(next.impactSpeed)
      }
    }
    // 运动按帧推进，几何/速度面板每 100ms 回读；包含滚动、尺寸和直接 DOM 移动。
    if (timestamp - readAtRef.current >= 100) {
      readAtRef.current = timestamp
      setGeometry(current)
      setVelocity(flightRef.current?.state ?? { vx: 0, vy: 0 })
    }
  })

  const reset = useCallback(() => {
    stop()
    resetDrag()
  }, [resetDrag, stop])

  const getVelocity = useCallback((): PetVelocity => flightRef.current?.state ?? { vx: 0, vy: 0 }, [])
  return { drag, geometry, velocity, flying, onPhysics, stop, reset, getVelocity }
}
