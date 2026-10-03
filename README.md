# dsh-pet-component

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

统一跨协议桌宠 React 组件：只需更换 `config` 或 `uri` 即可无缝切换底层渲染协议，无需宿主编写额外的分支逻辑。

| 协议名称 | 配置文件 | 资源文件 |
| --- | --- | --- |
| **[Dsh Pet](https://github.com/PC2005-cloud/dsh-pet)** | `assets/config.jsonc` | 逐动作透明视频（VP9-alpha `.webm` / macOS HEVC-alpha `.mov`） |
| **[Codex Pet](https://github.com/Signalight/codex-to-dsh-pet)** | `pet.json` | 8 列单图雪碧图（192×208，9 行 v1 / 11 行 v2） |

---

## ✨ 核心特性

* 🧭 **统一入口**：根据 `config` 自动推导渲染引擎（Dsh/Codex），支持显式指定 `kind`。
* ⚡ **自适应渲染引擎**：智能路由算法，自动调配 WebGL / Canvas / Video 渲染管线，确保在不同硬件配置下均可获得极佳流畅度。
* 🍎 **多端动态适配策略**：客户端环境自动感知。macOS 原生使用 HEVC-alpha，其他平台无缝降级至 VP9-alpha，避免编解码异常。
* 🎬 **双轨无黑帧**：内置双 `<video>` 交叉淡入缓冲机制，新动画完全加载（`loadeddata`）后才无缝切至前台。
* 🎭 **同构动作池**：内置 14 个同构动作，覆盖 dsh-pet 的 `workStatus` 档位并继承默认循环语义。
* 🎮 **双模控制**：支持声明式（`motion` prop）与命令式（`pet.motion(...)`）灵活混用。
* 🖱️ **智能拖拽分流**：dsh-pet 播放「悬空拽起」动画；Codex 自动转换为「左右行走」模式。
* 💾 **跨会话持久化**：基于 IndexedDB 缓存 Blob、Object URL 与**配置正文**，实现资源跨会话零延迟加载；配置拉取失败（断网 / 代理不可用）时自动回落到上次的副本，宠物照常显形而不是留下一个空窗口。

> **注意**：网页端的 IndexedDB 可能受 CORS 限制，纯跨域请求场景建议结合代理或关闭缓存。

---

## 📦 安装

```bash
pnpm add dsh-pet-component react

```

> **依赖要求**：`react >= 19` 需作为 Peer Dependency 安装。

---

## 🚀 快速上手

```tsx
import { Pet, useConfig } from 'dsh-pet-component'

export function App() {
  const { config } = useConfig('https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/refs/heads/main/dsh-pet/assets/config.jsonc')

  return (
    <Pet
      size={300}
      config={config}
      ext={{ default: 'webm', mac: 'mov' }}
      uri={{
        default: 'https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/refs/heads/main/dsh-pet/assets/webm',
        mac: 'https://raw.githubusercontent.com/dsh-tauri-desk/dsh-pet-mov/refs/heads/main/mov',
      }}
      cache
    />
  )
}

```

🔗 [查看在线 Demo](https://dsh-pet-component.vercel.app/)

---

## 💡 进阶指南

### 1. 外部控制与插播

通过 `useControllablePet` hook 下发命令式动作。命令层优先级**高于** `motion` prop。

```tsx
import type { PetRef } from 'dsh-pet-component'
import { Pet, useControllablePet } from 'dsh-pet-component'
import { useRef } from 'react'

export function App() {
  const petRef = useRef<PetRef>(null)
  const pet = useControllablePet(petRef)

  // 命令式控制
  pet.motion({ type: 'thinking', loop: true }) // 强制循环播放
  pet.motion({ type: 'result' })               // 播放一次后自动回落到 idle
  pet.motion({ type: 'waving', replay: true }) // 强制从头重播
  pet.clear()                                  // 清除命令层，恢复 motion prop

  return <Pet ref={petRef} config={config} uri={{ default: '/pets/main/webm' }} />
}

```

### 2. 拖拽交互集成

配合 `@reause/core` 的 `useDraggable` 实现流畅拖拽：

```tsx
import { useDraggable } from '@reause/core'
import { useRef } from 'react'

export function App() {
  const boxRef = useRef<HTMLDivElement>(null)
  const hitboxRef = useRef<HTMLDivElement>(null)

  const { x, y, isDragging } = useDraggable(boxRef, {
    handle: hitboxRef,
    initialValue: { x: 80, y: 80 },
  })

  return (
    <div ref={boxRef} style={{ position: 'fixed', left: x, top: y, pointerEvents: 'none' }}>
      <Pet config={config} dragging={isDragging} hitboxRef={hitboxRef} uri={uri} />
    </div>
  )
}

```

### 3. 甩动与碰撞弹开（宿主物理协议）

```tsx
<Pet
  ref={petRef}
  config={config}
  uri={uri}
  physics={{ throwPower: 1, petCollision: true }}
  onFling={event => hostPhysics.start(event)}
  onBounce={event => hostPhysics.replaceVelocity(event)}
/>

// 宿主采样并估算松手后的最终初速；碰撞后传入解算后的最终速度。
pet.fling({ vx: 900, vy: -500 })
pet.bounce({ vx: -300, vy: 100 })
const box = pet.geometry // 每读一次即时测量；未挂载/无布局时为 null
// 宿主在空中→地面的接触帧报告积分前冲击速度，不要每个贴地帧重复调用。
pet.squash(landingVelocityY)
pet.squash() // 点击力度
pet.stopSquash() // 主动取消并恢复媒体
```

这两个命令只请求对应回调，不改变动作或位置，不自动采样、驱动飞行或检测碰撞。
`bounce` 的速度**替换**旧速度，不是增量或冲量；`physics.petCollision=false` 不拦截显式命令。
速度统一为 CSS px/s（+x 向右、+y 向下），必须有限；0、负值、低速都原样传递，
不再次施加死区、限速或 `throwPower`。宿主估速时先应用增益，不在回调里重复乘。

回调的 `PetPhysicsEvent` 为 `{ vx, vy, geometry, physics }`：`geometry` 是调用时快照，
包含 renderer 的 `{ x, y, width, height }` 和真实 hitbox 的 `body: { left, top, right, bottom }`，
全部为**视口 CSS px**（含 transform/滚动影响）；不是气泡壳体、透明像素轮廓或固定宽高比推算。
局部/桌面坐标转换、多屏边界、速度状态、重力、反弹和生命周期由宿主负责。
隐藏但仍有布局的宠物仍可测量；是否参与自动碰撞由宿主决定。
无监听器、未挂载、无布局或速度非法时命令是安全空操作。

`physics` 逐字段 `prop > dsh 配置顶层 physics > 默认值`，`undefined` 不覆盖配置；Codex 使用 prop/默认。
默认依次为 `gravity=1400`、`restitution=0.78`、`groundFriction=2.5`、`ceilingBounce=true`、
`throwPower=1`、`petCollision=false`。非法数值/类型逐字段回退默认，合法 0/false 保留；
事件中的参数是独立副本，组件本身不执行这些物理参数。
宿主可用 `onHitboxPointerDown/Move/Up/Cancel` 采样；要收出框后的 move，请在 down 时自行
`event.currentTarget.setPointerCapture(event.pointerId)` 或绑定全局事件，组件不接管指针会话。

`squash(impactSpeed?)` 是独立的**视觉反馈**：底部锚定、220ms 纵向挤压再回弹，
省略速度时压到 0.55；落地速度按上游 300～1500 px/s 映射到 0.8～0.55。
媒体层与镜像层分离，两种 renderer 都支持；不改变位置、hitbox、几何或 Motion，
也不会因 `bounce` 自动挤压（上游只对空中→落地触发）。新调用替换旧效果，
抓取、拖拽、取消、卸载和动态切换“减少动态效果”会恢复纯媒体；非法速度/未挂载为空操作。
真实左键单击内置挤压反馈；保留既有双击 waving 动作合约，不改成上游单击切换动作。
挤压覆盖整个媒体层，新前台视频交叉淡入时沿用同一效果，不依赖旧 video 的 loadeddata。
等价的内联配置/URI 对象重建不截断反馈；实际素材地址/扩展名、渲染器或隐藏状态变化才取消。
完整逐项核对与刻意保留的宿主差异见 [交互清单](<docs/spec/pet-interactions.md>)。

### 4. 气泡与碎碎念 (Bubble & Muttering)

```ts
// 下发与更新气泡
pet.bubble({ id: 'task-1', title: '分析中...', loading: true, motion: 'thinking' })
pet.bubble({ id: 'task-1', title: '完成！', variant: 'success', motion: 'success' }) // 原地更新

pet.bubble.close('task-1') // 关闭指定气泡
pet.bubble.clear()         // 清空气泡

```

```tsx
// 配置自动碎碎念
<Pet
  config={config}
  uri={uri}
  muttering
  mutteringIntervalSec={300}
  onMuttering={(prompt, { meme }) => {
    generateAI(prompt).then(text => pet.muttering(text))
  }}
/>

```

---

## 📚 API 参考

### `<Pet/>` Props 摘要

| 属性 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `config` | `string | PetConfig` | — | 配置对象或 JSON/JSONC 地址 |
| `uri` | `string | { default: string; mac?: string }` | — | 资源请求基地址 |
| `kind` | `'dsh' | 'codex'` | *自动识别* | 强制指定协议类型 |
| `size` | `number` | `462` / `231` | 渲染宽度 (px) |
| `motion` | `MotionInput` | `'idle'` | 声明式动作控制 |
| `dragging` | `boolean` | `false` | 拖拽状态（高优先级） |
| `cache` | `boolean` | `true` | 是否开启 IndexedDB 缓存 |
| `mirrored` | `boolean` | `false` | 是否开启水平镜像翻转 |
| `muttering` | `boolean` | *config* | 是否开启碎碎念 |
| `onMotionChange` | `(motion: string) => void` | — | 实际动作变更回调 |
| `physics` | `Partial<PhysicsParams>` | *config / 内置默认* | 覆盖宿主物理参数，不驱动物理 |
| `onFling` / `onBounce` | `(event: PetPhysicsEvent) => void` | — | 最终速度与几何/参数快照 |
| `onHitboxPointerMove` | `(event: React.PointerEvent<HTMLDivElement>) => void` | — | 原样透传，捕获与采样由宿主负责 |

---

## 🎭 14 个内置同构动作

```text
idle       turn          moving-left   moving-right   waving     thinking 
working    result        waiting       running        review     failed 
success    error

```

* **循环动作**：`idle`, `moving-left`, `moving-right`, `thinking`, `working`, `result`, `waiting`, `running`, `dragging`
* **单次动作**：`turn`, `waving`, `review`, `failed`, `success`, `error`（播完自动回落 `idle`）

---

## 🛠 本地开发

```bash
# 启动 Playground 调试
pnpm install
cd playground && pnpm dev

# 代码质量检查与测试
pnpm run typecheck     # 类型检查
pnpm run lint          # Code Lint
pnpm run test:unit     # Vitest 单元测试（纯逻辑，Node 侧）
pnpm run test:browser  # Vitest 浏览器测试（真 DOM / 真过渡 / 真媒体，跑本机 Chrome）
pnpm run test:coverage # 两套一起跑 + 覆盖率报告（门槛 90%）
pnpm run build         # 产物构建 (tsdown)

```

测试分成两个 Vitest project（见 `vitest.config.ts`）：`unit` 跑 `test/**/*.test.ts`，
`browser` 跑 `test/browser/**/*.test.tsx`。浏览器那套用 `@vitest/browser-playwright` 驱动
本机已装的 Chrome（`channel: 'chrome'`，不下载 Chromium），因此能断言真实的 CSS 过渡、
`getAnimations()` 与媒体播放 —— 气泡进出场这类「观感」缺陷只有在这里才测得出来。

`pnpm run test:coverage` 只统计 `src/**` 的可执行代码（`src/types/**` 是纯类型，不计分），
行 / 分支 / 函数 / 语句四项门槛都是 **90%**，任一项不达标命令即失败。

测试素材：仓库里没有媒体文件、演练场用的是远程 URL，所以 `test/fixtures/pets/*.webm`
是现场生成的（生成路径与 ffmpeg 能力边界见 `test/fixtures/README.md`）。

---

## 📄 开源许可证

[MIT License](https://www.google.com/search?q=./LICENSE) © [Hairyf](https://github.com/hairyf)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/dsh-pet-component?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/dsh-pet-component
[npm-downloads-src]: https://img.shields.io/npm/dm/dsh-pet-component?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/dsh-pet-component
[bundle-src]: https://img.shields.io/bundlephobia/minzip/dsh-pet-component?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=dsh-pet-component
[license-src]: https://img.shields.io/github/license/hairyf/dsh-pet-component.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/hairyf/dsh-pet-component/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/dsh-pet-component
