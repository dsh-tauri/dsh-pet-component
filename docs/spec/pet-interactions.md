# Pet 甩动、碰撞与挤压：上游核对清单

## 基准与职责

核对基准：dsh-pet [`d73a2bb81e7891214097e061f597db35f5a9d57f`](https://github.com/PC2005-cloud/dsh-pet/tree/d73a2bb81e7891214097e061f597db35f5a9d57f)，已通过远端 HEAD 复核，不移动本仓库已有子模块工作树。

- **组件**：`fling` / `bounce` 请求、即时几何、归一化参数、`squash` / `stopSquash` 媒体反馈与点击判定。
- **宿主**：指针会话、轨迹估速、位置/速度、弹簧、飞行积分、边界、落地判定和宠物间碰撞。可运行接线在 [playground 演示](<../../playground/src/components/demo.tsx>)。
- 不增加 throwing/hit Motion；显式 `bounce` 传入最终替换速度，不再次施加增益或死区，也不自动挤压。

## 逐项核对

| 上游链路 | 本仓库实现与验证 |
| --- | --- |
| 松手估速：150ms 窗口、20ms 最小跨度、8ms 合并密集采样、端点方向、均速/峰值各半、末段加速增益≤0.6（基准8000）、3600 指数软限速、最后乘 throwPower、500 死区 | [宿主估速](<../../playground/src/physics.ts#L21-L53>)；[纯逻辑回归](<../../test/playground-physics.test.ts>)覆盖停顿、短轨迹、慢拖、抖动、峰值/加速与力度一次应用。 |
| 5px 拖动门槛；K=200、C=30 弹簧；用指针而不是滞后身体估速，从真实跟手落点起抛 | [拖动宿主](<../../playground/src/hooks/use-pet-drag.ts>)；[两种 renderer 浏览器回归](<../../test/browser/playground-physics.test.tsx>)验证门槛前不移动、跟手滞后及释放速度。 |
| 抓取停止飞行、正确收尾 | 同一指针会话；取消、失焦、丢失捕获不抛；其他/非主指针不会推进或结束会话；新物理命令取消旧拖动。浏览器验证两种 renderer。 |
| 重力、墙/顶反弹、ceilingBounce=false 不夹顶、仅接地摩擦、40/15 休止阈值、每步≤50ms | [宿主积分](<../../playground/src/physics.ts#L101-L149>)与纯逻辑检查；自然休止保留刚触发的落地挤压。 |
| 身体而不是透明画布碰墙；脚底贴地 | [实测身体边界](<../../playground/src/physics.ts#L55-L67>)；Dsh 脚底330/360，Codex 用 hitbox 底部。拖动与飞行共用身体边界，贴墙/落地后重新抓取不会跳回透明画布边缘；不同尺寸/比例与即时 DOM 几何有回归。 |
| 宠物间碰撞：身体严格重叠、中心法向、质量∝尺寸²、e=0.995、切向保留、分离/中心重合跳过、一帧一次 | [碰撞解算](<../../playground/src/physics.ts#L69-L99>)与演示的双宠开关；真实 PetDemo 检查静止目标被撞后移动，双方以最终速度重启。 |
| 点击 Q 弹；空中→落地一次触发、使用积分前速度；接地静止不反复触发 | `pet.squash()` 点击深度0.55，`pet.squash(impactSpeed)` 落地映射；宿主报告落地，[实际落地回归](<../../test/browser/playground-physics.test.tsx>)覆盖两种 renderer。 |
| 220ms、底部锚定、前45%二次下压、easeOutBack 回弹，过冲≤1.12；落地300～1500px/s深度0.8～0.55 | [挤压 hook](<../../src/hooks/use-pet-squash.ts>)与[曲线单元检查](<../../test/pet-squash.test.ts>)。 |
| 镜像恢复、重复效果替换、减少动态效果、媒体切换与清理 | 独立 `.dsh-pet__visual` 层，镜像仍在媒体自身；[浏览器回归](<../../test/browser/pet-squash.test.tsx>)覆盖两种 renderer、位置/hitbox/几何/Motion不变、前台视频切换/重播、陈旧loadeddata、抓取/拖动/隐藏/换素材（含扩展名）/取消/卸载以及动态减少动效；等价内联配置/URI 重建不截断反馈，非法速度不打断有效反馈。 |
| 公共命令转发及类型 | `useControllablePet` 透传 `squash` / `stopSquash`；[句柄回归](<../../test/browser/hooks-motion.test.tsx>)、[公开 API 快照](<../../test/__snapshots__/tsnapi/dsh-pet-component/index.snapshot.d.ts>)。 |

上游依据：[共享物理与曲线](https://github.com/PC2005-cloud/dsh-pet/blob/d73a2bb81e7891214097e061f597db35f5a9d57f/dsh-pet/src/shared/physics.ts)、[浏览器交互链路](https://github.com/PC2005-cloud/dsh-pet/blob/d73a2bb81e7891214097e061f597db35f5a9d57f/dsh-pet/src/client/pet.ts#L923-L1269)。

## 刻意保留的差异（不是遗漏）

1. 上游的桌面窗口、IPC broker、多显示器/`confineToScreen`、漫游和抓取积分小游戏仍属于宿主应用，不放入组件或本演示。
2. 保留已有**双击 waving** 动作合约；单击只增加媒体挤压，不改成上游的单击换动画。右键、拖动和取消不算挤压点击。
3. 上游按 Dsh 的9:16画布与 stage bottomPad 计算几何；组件没有该 stage 偏移，因此使用实测 renderer/hitbox，兼容 Codex 和 CSS尺寸覆盖，不照搬 bottomPad。
4. 上游只压前台 video；这里压共同媒体层，前后台切换不会中断反馈，同时支持雪碧图。反馈不进入身体几何。
5. Playground 是单个、未缩放的舞台坐标系：弹簧使用≤1/120s小子步（单帧≤50ms）避免大帧发散，拖动仍夹在舞台内；不是桌面多屏引擎。
6. 比上游共享 pointerup 收尾更严格：pointercancel、失焦、丢失捕获明确取消且不甩出。落地必须是实际空中→地面，不因命令从静止地面开始而反复挤压。

## 验证入口

```sh
pnpm run build
pnpm run typecheck
pnpm exec vitest run --coverage
pnpm --filter playground run build
```

库覆盖率维持四项90%门槛，不把 playground 宿主代码计作库代码；宿主通过纯逻辑、真实 Dsh/Codex 以及实际面板接线回归验证。
