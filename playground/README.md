# Pet playground

在仓库根目录运行：

```sh
pnpm run dev:playground
pnpm --filter playground run build
```

同一个 `<Pet>` 可切换 Dsh/Codex 素材。在「物理接口」面板：

- 快速拖动身体后松手，或点「向右上甩出」：调用 `pet.fling({ vx, vy })`。
- 点「模拟碰撞弹开」：调用 `pet.bounce({ vx, vy })`，以最终速度替换飞行，不叠加。
- 调节松手增益与边界回弹，随时停止、抓取或复位；取消手势、慢拖和松手前停顿不甩出。
- 速度以 CSS px/s 回显，`pet.geometry` 每 100ms 读取真实 renderer/body 的 viewport CSS px。

接线在 [demo.tsx](<src/components/demo.tsx>)，宿主实现见 [use-pet-physics.ts](<src/hooks/use-pet-physics.ts>) 与 [physics.ts](<src/physics.ts>)。
组件仅提供协议，飞行积分、重力和边界仍属于宿主。此样例只演示单宠舞台与模拟碰撞速度，不包含多宠接触解算；物理控件不写入持久化偏好。

最小回归（仓库根目录）：

```sh
pnpm exec vitest run --project unit test/playground-physics.test.ts --project browser test/browser/playground-physics.test.tsx
```
