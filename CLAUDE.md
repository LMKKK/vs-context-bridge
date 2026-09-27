# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Autumn Context Bridge 是一个 VS Code 扩展，作为编辑器与 Claude Code CLI 之间的桥梁。它允许用户通过右键菜单和键盘快捷键，将文件和选区作为 `@`-references 直接发送到 Claude Code 终端输入框（不自动按 Enter）。

命令与配置前缀：`autumnContextBridge`；扩展包名：`autumn-context-bridge`。完整扩展 ID 为 `package.json` 中的 `publisher` 与包名用句点连接，不保留旧命令或配置别名。

## 常用命令

```bash
npm install            # 安装依赖
npm run build          # 一次性构建（生成 dist/extension.js）
npm run watch          # 监视模式构建（开发时推荐）
npm run build:prod     # 生产构建（压缩）
npm test               # 运行测试（vitest 单次运行）
npm run test:watch     # 测试监视模式
npm run launch         # 构建并在 Extension Development Host 中启动
npm run package        # 打包为 .vsix 文件（发布到市场前）
```

在 VS Code 中按 `F5` 启动调试（需先 `npm run build`），会打开一个加载本扩展的新窗口。

## 架构

扩展采用清晰的三层模块化结构，所有依赖都从 `TerminalDetector` 派生：

```
extension.ts (入口，注册命令)
    │
    ├─► TerminalDetector ─┬─► ContextSender (构造时注入)
    │   (终端检测/管理)    │
    │                     └─► StatusBar (构造时注入)
    │
    └─► matching.ts (纯函数工具，被 detector 和 sender 复用)
```

### 各模块职责

- **`src/extension.ts`** — 扩展激活入口，注册 4 个命令（`addFileToContext`、`sendSelectionToContext`、`setAsClaudeTerminal`、`selectTerminal`），实例化 detector/sender/statusBar 并组装。

- **`src/terminalDetector.ts`** — 核心状态机。维护两类终端引用：`designatedTerminal`（用户手动指定）和 `activeClaudeTerminal`（自动检测）。监听 `onDidOpenTerminal` / `onDidCloseTerminal` / `onDidChangeActiveTerminal` 事件。终端刚打开时名称可能为空，扩展会轮询最长 30 秒（每 2 秒一次）以捕获 Claude Code 异步设置标题的过程。`target` getter 始终重新扫描以拾取名称变更。

- **`src/contextSender.ts`** — 实际向终端发送文本。通过 `terminal.sendText(ref, false)` 写入 `@` 引用（不传 Enter）。解析终端 CWD 时优先使用 shell integration（VS Code 1.93+），回退到 `creationOptions.cwd`，最后回退到第一个 workspace folder。多根 workspace 中，文件落在终端 CWD 所在目录则使用相对路径，否则使用绝对路径——确保 Claude Code 能正确解析。

- **`src/statusBar.ts`** — 右侧状态栏指示器。当存在 Claude Code 终端目标时显示 `$(terminal) Claude Code`，有选区时附加 `$(selection)` 图标。点击触发 `sendSelectionToContext` 命令。

- **`src/matching.ts`** — 纯函数工具集，无 VS Code 依赖，便于测试：
  - `matchesClaudeTerminalName` — 匹配 `"Claude Code"`、包含 "claude"（大小写不敏感）、semver 版本号（`^\d+\.\d+\.\d+$`）、或用户自定义正则（来自配置 `autumnContextBridge.terminalNamePatterns`，无效正则被静默跳过）
  - `toRelativePath` — 跨多个 workspace folders 寻找第一个不向上回退的相对路径
  - `formatLineRef` — 格式化 `@path:startLine` 或 `@path:startLine-endLine`

### 关键设计决策

1. **注入式组合** — `ContextSender` 和 `StatusBar` 在构造时接收 `TerminalDetector`，而非内部创建。便于测试和单例复用。

2. **target 始终重扫描** — `get target()` 每次调用都执行 `scanForTarget()`，因此能拾取终端运行时重命名（如 Claude Code 设置 `1.0.32` 版本号标题）。

3. **手动指定优先于自动检测** — `designatedTerminal` 存在时优先使用，否则才回退到自动检测的 Claude 终端。

4. **CWD 解析策略** — shell integration > creationOptions > 第一个 workspace folder，这是为了在多根 workspace 中尽量准确反映 `cd` 后的实际目录。

5. **路径策略** — 多根 workspace 中，相对终端 CWD 的文件用短相对路径，其他 workspace 的文件用绝对路径。这保证了 Claude Code 总能定位到正确的文件。

## 测试

- 使用 **vitest**（配置在 `vitest.config.ts`）
- 测试文件位于 `src/__tests__/`，模式为 `**/*.test.ts`
- **只测试 `matching.ts` 中的纯函数**——VS Code API 调用（detector、sender、statusBar）目前未测试。如需扩展测试覆盖，应 mock `vscode` 模块。
- `tsconfig.json` 排除了 `src/__tests__/`，因此测试文件不会进入生产构建。

## 配置

唯一用户配置项：`autumnContextBridge.terminalNamePatterns`（`string[]`，默认 `[]`），正则列表，用于匹配自定义命名的 Claude Code 终端。

## 发布

```bash
npm run package    # 生成 autumn-context-bridge-X.X.X.vsix
```

发布者账户已配置在 `package.json` 中。`.vscodeignore` 排除了源码、`.vscode/`、测试等，仅打包 `dist/` 和 `resources/`。

## 依赖与引擎

- VS Code 引擎：`^1.85.0`
- Node 版本：`.nvmrc` 指定 24
- 关键依赖：仅 devDependencies（`@types/vscode`、`typescript`、`esbuild`、`vitest`、`@vscode/vsce`）。运行时仅有 `vscode` 模块（作为 external）。
- 打包：esbuild 直接 bundle `src/extension.ts` → `dist/extension.js`（CJS、Node 平台）。

## 开发提示

- 修改后运行 `npm run watch` 自动重建，然后在调试窗口中按 `Ctrl+R`/`Cmd+R` 重新加载扩展。
- 添加新命令时：在 `package.json` 的 `contributes.commands` 注册，并在 `extension.ts` 的 `activate` 中通过 `vscode.commands.registerCommand` 绑定。
- 修改终端匹配逻辑时：在 `src/__tests__/matching.test.ts` 添加测试用例；`matching.ts` 是扩展中唯一允许纯函数模块化的入口。
- 终端轮询窗口（`POLL_DURATION_MS = 30000`）如不够用，可在 `terminalDetector.ts` 调整。
