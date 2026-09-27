# 性能评审：Autumn Context Bridge

> 评审对象：`src/extension.ts`、`src/terminalDetector.ts`、`src/contextSender.ts`、`src/statusBar.ts`、`src/matching.ts`
> 评审范围：运行期热路径（启动、终端事件、选区变化、命令触发）

## 背景

本扩展在用户每次：

- 打开 / 关闭终端
- 切换活动终端
- 选区变化（拖动鼠标、键盘移动光标）
- 触发命令（右键菜单、快捷键、命令面板）

都会触发一组状态更新逻辑。这些路径中有几处在多终端场景下会重复执行「配置读取 + 正则编译 + 全量扫描」，属于可优化的浪费。

下面按 **收益从高到低** 列出。

---

## 高价值

### 1.1 `isClaudeTerminal` 每次调用都重读配置 + 重编译正则

**位置**：

- `src/terminalDetector.ts:55-59`
- `src/matching.ts:11-17`

```ts
// terminalDetector.ts
private isClaudeTerminal(terminal: vscode.Terminal): boolean {
  const config = vscode.workspace.getConfiguration('autumnContextBridge');
  const customPatterns: string[] = config.get('terminalNamePatterns', []);
  return matchesClaudeTerminalName(terminal.name, customPatterns);
}

// matching.ts
for (const pattern of customPatterns) {
  try {
    if (new RegExp(pattern, 'i').test(name)) return true;
  } catch {
    // Invalid regex — skip
  }
}
```

**问题**：

- `vscode.workspace.getConfiguration` 是同步的跨层调用，并非无成本
- 对每个自定义模式都重新 `new RegExp(...)`，即使模式从未变化

**影响**：在 N 个终端 × M 个自定义模式下，每次扫描产生 N×M 次正则编译、还有 N 次 `getConfiguration`。

**优化方向**：缓存编译后的 `RegExp[]`，监听 `vscode.workspace.onDidChangeConfiguration` 重建。这样 `isClaudeTerminal` 退化为纯字符串 / 正则匹配。

---

### 1.2 `get target()` 每次访问都全量重扫描

**位置**：`src/terminalDetector.ts:26-33`

```ts
get target(): vscode.Terminal | undefined {
  // Always re-scan fresh so we pick up name changes
  this.scanForTarget();
  if (this.designatedTerminal) {
    return this.designatedTerminal;
  }
  return this.activeClaudeTerminal;
}

get hasTarget(): boolean {
  return this.target !== undefined;   // 又触发一次 scan
}
```

**调用栈放大**：

- `StatusBar.update()` → `detector.hasTarget` → `scanForTarget()`
- `ContextSender.addFiles / sendSelection` → `requireTerminal()` → `detector.target` → 再一次 `scanForTarget()`
- 命令 `selectTerminal` / `setAsClaudeTerminal` 也走同一路径

`StatusBar` 还监听了：

```ts
vscode.window.onDidChangeTextEditorSelection(() => this.update()),
vscode.window.onDidChangeActiveTextEditor(() => this.update()),
```

**这两个事件在用户拖动选区、鼠标在编辑器中移动时会高频触发**。每次都跑一次 O(所有终端) 的扫描——而且**没有 Claude terminal 时，结果完全不会变**。这是最显眼的浪费。

**优化方向**：把 `target` / `hasTarget` 改为缓存字段，由以下事件驱动刷新：

- `onDidOpenTerminal` / `onDidCloseTerminal` / `onDidChangeActiveTerminal`
- 终端轮询 tick（见 2.1）
- `onDidChangeConfiguration`（配置变化时）

选区变化只更新状态栏文本，不再触碰 detector。这是**改动一处消除最大浪费**的建议。

---

### 1.3 `scanForTarget` 内部分支冗余

**位置**：`src/terminalDetector.ts:61-75`

```ts
private scanForTarget(): void {
  const active = vscode.window.activeTerminal;
  if (active && (active === this.designatedTerminal || this.isClaudeTerminal(active))) {
    this.activeClaudeTerminal = active;
  }

  const terminals = vscode.window.terminals;
  if (this.activeClaudeTerminal && !terminals.includes(this.activeClaudeTerminal)) {
    this.activeClaudeTerminal = terminals.find((t) => this.isClaudeTerminal(t));
  }

  if (!this.activeClaudeTerminal) {
    this.activeClaudeTerminal = terminals.find((t) => this.isClaudeTerminal(t));
  }
}
```

第二段和第三段是同一个 `find` 表达式，逻辑可以合并：

```ts
const terminals = vscode.window.terminals;
if (this.activeClaudeTerminal && !terminals.includes(this.activeClaudeTerminal)) {
  this.activeClaudeTerminal = undefined;
}
if (!this.activeClaudeTerminal) {
  this.activeClaudeTerminal = terminals.find((t) => this.isClaudeTerminal(t));
}
```

节省一次冗余 `find`（虽然只在 cache miss 时执行，收益有限，但属于顺手清理）。

---

## 中价值

### 2.1 轮询期间 `onDidChange` 事件过频

**位置**：`src/terminalDetector.ts:89-99`

```ts
private startPolling(): void {
  if (this.pollTimer) return;
  let elapsed = 0;
  this.pollTimer = setInterval(() => {
    elapsed += POLL_INTERVAL_MS;
    this.refresh();   // 内部 fire onDidChange
    if (this.activeClaudeTerminal || elapsed >= POLL_DURATION_MS) {
      this.stopPolling();
    }
  }, POLL_INTERVAL_MS);
}
```

终端刚打开 → 30s 窗口内最多 15 次 `refresh()` → 15 次 `_onDidChange.fire()` → StatusBar 重新 `update()`。

**优化方向**：只在 `activeClaudeTerminal` 引用真正改变时才 fire onDidChange；周期扫描本身照常进行。StatusBar 不会因为没有变化的轮询 tick 反复重渲染。

---

### 2.2 `matchesClaudeTerminalName` 内置模式的字符串分配

**位置**：`src/matching.ts:7-9`

```ts
if (name === 'Claude Code') return true;
if (name.toLowerCase().includes('claude')) return true;
if (VERSION_PATTERN.test(name)) return true;
```

每次调用都 `toLowerCase()` 复制整个字符串。当和 1.1（缓存正则）叠加后，循环里仍会反复产生小字符串。

**优化方向**：

```ts
const lower = name.toLowerCase();
if (lower.includes('claude')) return true;
```

或者先用 `RegExp` 缓存一组内置模式（"Claude Code" / 含 claude / 版本号）一次性 `.test(name)`。

---

### 2.3 `require('path')` 每次函数调用都走模块缓存查询

**位置**：`src/matching.ts:22-38`

```ts
export function toRelativePath(
  fileFsPath: string,
  workspaceFolderFsPaths: string[],
): string {
  // Use Node's path to compute relative paths
  const path = require('path');
  ...
}
```

Node 会缓存 `path` 模块，所以实际只产生 dict lookup 的开销——但**完全没有必要每次查询**。改为文件顶部：

```ts
import * as path from 'path';
```

或者：

```ts
const path = require('path');   // 模块顶层
```

收益极小（几纳秒级），但属于顺手清理。

---

## 低价值 / 边界情况

### 3.1 `activationEvents: ["onStartupFinished"]`

**位置**：`package.json:31-33`

理论上可以改为 `onCommand:...` 进一步缩短冷启动，但本扩展的右键菜单与 `editor/title/context` 菜单无 `when` 条件依赖扩展状态——保持 `onStartupFinished` 让这些菜单 hover 时扩展已激活、命令立即响应更合适。**不建议改**。

### 3.2 多根 workspace 中 `getTerminalCwd` 找不到 CWD 时的 fallback

**位置**：`src/contextSender.ts:57-63`

```ts
private getTerminalWorkspacePaths(terminal: vscode.Terminal): string[] {
  const cwd = this.getTerminalCwd(terminal);
  if (cwd) return [cwd];
  const first = vscode.workspace.workspaceFolders?.[0];
  return first ? [first.uri.fsPath] : [];
}
```

当终端 CWD 不在 `workspaceFolders` 里时，硬塞 `workspaceFolders[0]` 可能产生错误相对路径。**这是正确性 bug，不是性能问题**——但若同时修改 detector 缓存重构，建议一并审视。

---

## 建议优先级

| #   | 改动                                  | 收益       | 改动量 |
| --- | ------------------------------------- | ---------- | ------ |
| 1.2 | detector 缓存 + 事件驱动刷新          | **高**     | 中     |
| 1.1 | 配置 + 编译后的正则缓存               | 高         | 小     |
| 2.1 | 轮询 fire 节流                        | 中         | 小     |
| 1.3 | 合并 `scanForTarget` 分支             | 低（顺手） | 极小   |
| 2.2 | `toLowerCase` 复用                    | 中（叠 1.1） | 极小   |
| 2.3 | `require('path')` 提升                | 极低       | 极小   |

如果只能改一处，推荐 **1.2**：StatusBar 的选区变化回调是**最热的高频路径**，把 detector 从「拉模式」改成「推模式」能立刻消除最显眼的浪费，同时让 1.1 的优化（缓存正则）变得自然。