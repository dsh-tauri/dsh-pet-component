import type { RefObject } from 'react'
import type { PetBubbleHandle, PetBubbleOptions, PetMutteringHandle, PetMutteringShowOptions, PetRef } from '../types'
import { useRef } from 'react'

/**
 * 桌宠的命令面 —— 把 ref 上的命名空间包成一个稳定对象，调用方不接触资源、帧循环、
 * 动画结束事件，也不需要自己拼气泡 DOM。
 *
 * ```tsx
 * const petRef = useRef<PetRef>(null)
 * const pet = useControllablePet(petRef)
 *
 * pet.motion({ type: 'thinking', loop: true }) // 思考动作，循环播放
 * pet.motion({ type: 'result' })               // 结果动作，播一次后自动回 idle
 * pet.clear()                                  // 清除当前动作，回落 motion prop
 *
 * // 气泡（叠加在宠物上方；同 id 重复调用 = 原地更新）
 * const key = pet.bubble({ title: '会话标题', description: '正在处理', loading: true, motion: 'thinking' })
 * pet.bubble({ id: key, description: '已完成', loading: false, motion: 'success' })
 * pet.bubble.close(key)
 *
 * // 碎碎念（展示一句 / 立即再向宿主索取一句）
 * pet.muttering('今天风好大')
 * pet.muttering.request()
 *
 * return <Pet ref={petRef} config={…} uri={…} onMuttering={…} />
 * ```
 *
 * 命令面下发过的动作优先于 `motion` prop，直到 `motion` 取值变化 —— 那是 `usePetMotion`
 * 的层叠规则，本 hook 只做转发。组件还没挂载（`ref.current` 为 `null`）时全部是安全空操作：
 * 气泡返回空字符串 key、geometry 返回 null，其余命令（含 fling/bounce）静默忽略。
 *
 * @param petRef 传给 `<Pet ref={…} />` 的同一个 ref
 * @returns 稳定的命令面（同一实例内引用不变，可安全放进依赖数组）
 */
export function useControllablePet(petRef?: RefObject<PetRef | null>): PetRef {
  const handleRef = useRef<PetRef | null>(null)
  if (handleRef.current === null) {
    // 气泡命令面是「可调用 + 具名方法」的形态，所以要先把函数建出来再挂方法
    const bubble = ((options: PetBubbleOptions) => petRef?.current?.bubble(options) ?? '') as PetBubbleHandle
    bubble.close = (id?: string) => petRef?.current?.bubble.close(id)
    bubble.clear = () => petRef?.current?.bubble.clear()

    const muttering = ((text: string, options?: PetMutteringShowOptions) => {
      petRef?.current?.muttering(text, options)
    }) as PetMutteringHandle
    muttering.request = () => petRef?.current?.muttering.request()

    handleRef.current = {
      motion(motion) {
        petRef?.current?.motion(motion)
      },
      clear() {
        petRef?.current?.clear()
      },
      get current() {
        return petRef?.current?.current ?? 'idle'
      },
      fling(velocity) {
        petRef?.current?.fling(velocity)
      },
      bounce(velocity) {
        petRef?.current?.bounce(velocity)
      },
      get geometry() {
        return petRef?.current?.geometry ?? null
      },
      bubble,
      muttering,
    }
  }
  return handleRef.current
}
