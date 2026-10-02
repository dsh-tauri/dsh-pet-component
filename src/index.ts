/**
 * dsh-pet-component —— 把 dsh-pet（逐动作透明视频）与 Codex Pet（精灵图集）两套桌宠协议
 * 封装成**一个** `<Pet>`：换 `config` / `uri` 就换协议，宿主不写分支。
 *
 * 对外只有三件东西：
 *
 * - `<Pet>`                   组件（`DshPet` / `CodexPet` 由它内部按配置选，不对外暴露）
 * - `useConfig(...)`          加载配置（对象直用；地址走带缓存的 fetch + JSONC 解析）
 * - `useControllablePet(...)` 命令面（`pet.motion(...)` / `pet.clear()` /
 *                             `pet.bubble(...)` / `pet.muttering(...)` / `pet.fling(...)` / `pet.bounce(...)`）
 *
 * ```tsx
 * const petRef = useRef<PetRef>(null)
 * const pet = useControllablePet(petRef)
 * const { config } = useConfig('/pets/main/config.jsonc')
 *
 * pet.motion({ type: 'thinking', loop: true })
 * pet.motion({ type: 'result' })   // 播一次后自动回 idle
 * pet.clear()
 *
 * // 气泡：同 id 重复下发 = 原地更新（不重新淡入），可捆绑运行动画
 * const key = pet.bubble({ title: '会话', description: '正在处理', loading: true, motion: 'thinking' })
 * pet.bubble({ id: key, description: '已完成', loading: false, motion: 'success' })
 * pet.bubble.close(key)
 *
 * // 碎碎念：展示一句 / 立即再向宿主索取一句
 * pet.muttering('今天风好大')
 * pet.muttering.request()
 *
 * return (
 *   <Pet
 *     ref={petRef}
 *     config={config}
 *     uri={{ default: '/pets/main/webm', mac: '/pets/main/mov' }}
 *     ext={{ default: 'webm', mac: 'mov' }}
 *     cache
 *     muttering
 *     onMuttering={(prompt, { meme }) => generate(prompt, meme).then(text => pet.muttering(text))}
 *   />
 * )
 * ```
 *
 * 其余（资源解析、JSONC、IndexedDB 缓存、双视频缓冲、帧循环、动作池拾取、气泡队列、
 * 碎碎念节拍…）都是实现细节，不构成公开 API —— 需要时直接看对应模块的源码注释。
 */
export { Pet } from './components/pet'
export type { MutteringPlan, MutteringPlanInput } from './config'
export { useConfig } from './hooks/use-config'

export type { PetConfigResult } from './hooks/use-config'
export { useControllablePet } from './hooks/use-controllable-pet'
export type {
  AnimationSlot,
  Category,
  CodexPetConfig,
  CodexPetFrameSpec,
  DshPetAnimations,
  DshPetConfig,
  DshPetEntry,
  EventSlot,
  Motion,
  MotionInput,
  MotionOptions,
  MovesConfig,
  MoveSpec,
  PetAnimationInfo,
  PetBubble,
  PetBubbleHandle,
  PetBubbleKind,
  PetBubbleOptions,
  PetBubblePlacement,
  PetBubbleVariant,
  PetCommonProps,
  PetConfig,
  PetConfigSource,
  PetCorner,
  PetDisplay,
  PetEvents,
  PetGeometry,
  PetHitboxProps,
  PetMutteringEvent,
  PetMutteringHandle,
  PetMutteringHandler,
  PetMutteringReason,
  PetMutteringShowOptions,
  PetPhysicsEvent,
  PetProps,
  PetRef,
  PetRenderMotion,
  PetVelocity,
  PetWeights,
  PhysicsParams,
} from './types'
