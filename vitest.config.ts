import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// 只跑本包的测试：`source/` 下是参考项目（git submodule）的检出，
// 它们自带的测试依赖各自的构建产物，不属于本包。
const sharedExclude = ['node_modules/**', 'dist/**', 'source/**', 'playground/**', 'docs/**']

export default defineConfig({
  test: {
    /**
     * 覆盖率（`pnpm run test:coverage`）。
     *
     * 只统计库自身源码：`src/types/**` 只有类型声明、没有可执行代码，计分没有意义
     * （它们仍受 `typecheck` 与 API 快照保护）；参考实现检出（`source/**`）、演练场与测试
     * 自身都不计入。
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [...sharedExclude, 'src/types/**', 'src/**/*.d.ts'],
      // 浏览器预打包的 sourcemap 会带入 playground，重映射后仍只统计库。
      excludeAfterRemap: true,
      // 门槛不达标时也要先把报告打出来，否则看不出差在哪
      reportOnFailure: true,
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
    projects: [
      {
        // 纯逻辑与 Node 侧工具：`createBubbleTracker` / `createBubble` / jsonc / …
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...sharedExclude, 'test/browser/**'],
        },
      },
      {
        /**
         * 预打包浏览器项目用到的依赖。
         *
         * 不预打包的话，Vite 会在**运行中途**才发现 `@reause/core` 这类首次进入浏览器依赖图的
         * 包 → 重新优化 + 整页 reload → 那一次运行里所有渲染组件的用例都以
         * `Cannot read properties of null (reading 'useRef')`（React invalid hook call，
         * 堆栈里带着 `?v=` 哈希）整片挂掉。冷缓存（CI 或刚清过 `node_modules/.vite`）必现，
         * 原地重跑一次才好 —— 所以这里把依赖图里的第三方包一次列全。
         */
        optimizeDeps: {
          include: [
            '@gravity-ui/icons',
            '@reause/core',
            'css-render',
            'idb-keyval',
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-dev-runtime',
            'react/jsx-runtime',
          ],
        },
        // 真浏览器（真实 DOM + 真实过渡/定时器）：气泡层观感、动画真的在动、
        // React 副作用顺序（命令面与声明层的交班）。
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.tsx'],
          exclude: sharedExclude,
          browser: {
            enabled: true,
            headless: true,
            // 用本机已装的 Chrome，避免下载 Chromium（`playwright install` 那一步）。
            // 其他环境可换成 `channel: 'msedge'`，或删掉 `launchOptions` 用 Playwright 自带浏览器。
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
