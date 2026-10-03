# Pet playground

在仓库根目录运行：

```sh
pnpm run dev:playground
pnpm --filter playground run build
```

同一个 `<Pet>` 可切换 Dsh/Codex 素材。在「物理接口」面板：

- 快速拖动身体后松手，或点「向右上甩出」：调用 `pet.fling({ vx, vy })`。
- 点「模拟碰撞弹开」：调用 `pet.bounce({ vx, vy })`，以最终速度替换飞行，不叠加。
- 调节松手增益（同时调整弹簧跟手力度）与边界回弹；5px 门槛前不移动，指针轨迹采用上游峰值/末段加速度/指数限速估算。
- 启用「双宠实际碰撞」，可独立拖动两只 Pet；身体 AABB 检测、尺寸平方质量和 e=0.995 法向动量解算，双方使用最终速度弹开。
- 点击身体或「挤压回弹」，以及每次真正落地会播放 220ms Q 弹；保留双击 waving，减少动态效果时不挤压。
- 随时停止、抓取或复位；取消/失焦/丢失捕获、其他指针、慢拖和松手前停顿不甩出，命令启动会取消旧拖拽。
- 速度以 CSS px/s 回显，`pet.geometry` 每 100ms 读取真实 renderer/body 的 viewport CSS px。

接线在 [demo.tsx](<src/components/demo.tsx>)，宿主实现见 [use-pet-physics.ts](<src/hooks/use-pet-physics.ts>) 与 [physics.ts](<src/physics.ts>)。
组件提供物理请求协议与媒体反馈，飞行积分、弹簧、重力、身体边界、落地判定和双宠解算仍属于宿主。
边界从真实 body/renderer 几何计算，Dsh 以素材脚底 330/360、Codex 以 hitbox 底部贴地，避免透明画布让身体提前碰墙或悬浮。
物理控件不持久化；参数在下一次请求生效。双宠碰撞不自动挤压（上游没有该行为），落地才报告冲击。
桌面 IPC/多屏以及飞行抓取积分小游戏不属于本样例范围。

最小回归（仓库根目录）：

```sh
pnpm exec vitest run --project unit test/playground-physics.test.ts --project browser test/browser/playground-physics.test.tsx
```
