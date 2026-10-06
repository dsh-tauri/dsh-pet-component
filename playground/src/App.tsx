import { PetDemo } from './components/demo'
import './App.css'

const FEATURES: { title: string, body: string }[] = [
  {
    title: '一个 Pet，两套协议',
    body: '整页只有一个 <Pet>：换素材（config + uri）就自动切到 DshPet 或 CodexPet，宿主不写分支。',
  },
  {
    title: '切换动作交叉淡入',
    body: '双 <video> 缓冲：新动画在后台加载，loadeddata 后才交换前台并淡入 —— 无空窗、无黑帧。',
  },
  {
    title: '拖动按协议分流',
    body: 'dsh-pet 拖动画「被无形抓起悬空」（animations.drag），Codex 拖动画左右行走行；走路素材由动作墙手动触发。',
  },
  {
    title: '声明式 + 命令式共存',
    body: 'motion prop 给状态、pet.motion(...) 插播一次性动作，命令面优先且不会被 prop 顶掉。',
  },
  {
    title: 'IndexedDB 缓存',
    body: 'cache 打开后资源落 IndexedDB，第二次播放走本地；首次不打断播放，避免换 URL 导致重播。',
  },
  {
    title: '库内 hooks 直用',
    body: '拖动 useDraggable、命令面 useControllablePet、配置 useConfig、播放器 useMediaControls 都随包提供。',
  },
  {
    title: '尺寸按协议各存一份',
    body: '图集格子里人物铺满、视频画布里人物居中占一块，同宽下 Codex 约大一倍 —— 默认按一半取。',
  },
  {
    title: '气泡与碎碎念',
    body: 'pet.bubble(...) 叠在宠物头顶：同 id 再下发就是原地更新（加载态 / 标题 / 图标 / 语义色 / 捆绑运行动画）',
  },
]

function App() {
  return (
    <div className="page">
      <header className="hero">
        <p className="hero__eyebrow">dsh-pet-component</p>
        <h1>桌宠组件 playground</h1>
        <p className="hero__lead">
          把
          {' '}
          <b>dsh-pet</b>
          {' '}
          的透明视频协议与
          {' '}
          <b>Codex Pet</b>
          {' '}
          的雪碧图集协议封装成同一组 React 组件。
          下面这一份演示只用一个
          {' '}
          <code>&lt;Pet&gt;</code>
          {' '}
          —— 切素材就切协议，14 个动作、命令面插播、按协议分流的拖动、缓存开关、
          鼠标追踪 look 与单条动画的媒体控制都在里面。
        </p>
        <ul className="features">
          {FEATURES.map(feature => (
            <li key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </header>

      <main>
        <PetDemo />
      </main>

      <footer className="footer">
        <p>
          素材来自公开源：
          <a href="https://github.com/PC2005-cloud/dsh-pet" target="_blank" rel="noreferrer">PC2005-cloud/dsh-pet</a>
          {' '}
          （VP9-alpha webm）与 npm 包
          {' '}
          <a href="https://www.npmjs.com/package/@signalight/dsh-codex-pet" target="_blank" rel="noreferrer">@signalight/dsh-codex-pet</a>
          {' '}
          （Codex v2 图集）；拖拽阈值、单击反馈/对话二次按下判定与命中框尺寸按 dsh-pet / deepseek-harness-desktop 对齐。
        </p>
      </footer>
    </div>
  )
}

export default App
