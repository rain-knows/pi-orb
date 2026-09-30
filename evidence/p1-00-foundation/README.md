# P1 基建：工程骨架、版本维护与仓库治理

> 运行方式：
> - 质量门禁：`node evidence/p1-00-foundation/verify-foundation.mjs`
> - 真实启动冒烟：`node evidence/p1-00-foundation/run-boot-smoke.mjs`
>
> 原始结果：`result.json`、`boot-smoke.json`
> 状态：**全部通过**（4/4 质量门禁，9/9 启动断言）。这是 P1-01～P1-07 的前置，不等于 P1 完成。

本文件对应目标文档 §2 的非破坏性合同 §7.2 的版本维护要求，以及目标里“进行版本维护、维护 `.gitignore`、不要提交乱七八糟的东西”的治理要求。

## 1. 为什么需要这一步

P0 结束时仓库只有文档和证据，没有任何可运行工程。P1 要交付产品，必须先有一个能端到端运行的最小骨架、一套可执行的质量门禁，以及一条不会把构建产物、本地状态、凭据或原生二进制提交进仓库的忽略规则。本阶段只做这些，不提前实现 Cua broker、工具闭环或发布系统。

## 2. 交付内容

| 项 | 位置 | 说明 |
|---|---|---|
| 工程清单与锁定依赖 | `package.json`、`package-lock.json` | 单 `package.json`，不引入 workspace / monorepo |
| TypeScript strict | `tsconfig.json` | `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` |
| 构建 | `electron.vite.config.ts` | `electron-vite` 输出 main / preload / renderer 三段 |
| 测试 | `vitest.config.ts`、`tests/` | 纯逻辑与工作区规则单测 |
| 代码检查 | `eslint.config.js` | `typescript-eslint` flat config |
| 忽略规则 | `.gitignore` | 见 §4 |
| 版本历史与策略 | `CHANGELOG.md` | Keep a Changelog 格式；未发布记为 `Unreleased` |
| 支持矩阵 | `doc/support-matrix.md` | **唯一的**版本兼容性声明来源 |
| 文档索引 | `doc/README.md` | 新增支持矩阵入口与文档维护约定 |
| 项目说明 | `README.md` | 结构、命令、非破坏性保证与已知例外 |

目录划分：`src/main`（Electron 主进程）、`src/preload`（contextBridge）、`src/renderer`（参考 floating HTML/CSS/JS shell）、`src/shared`（主进程／preload／renderer 与 Pi 扩展共用的配置 schema 与 IPC 契约）、`pi-package/extensions`（Pi 扩展入口）、`tests`、`evidence`。

## 3. 质量门禁实测（4/4）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | 通过 |
| 代码检查 | `npx eslint .` | 通过（0 error / 0 warning） |
| 单元测试 | `npx vitest run` | 40 passed（4 文件） |
| 生产构建 | `npx electron-vite build` | 通过 |

构建产物形状断言（防止“构建成功但运行时静默失效”）：

| 断言 | 结果 | 为什么单独检查 |
|---|---|---|
| `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html` 存在 | 通过 | 缺一个就是运行期失败 |
| preload 为 CommonJS（含 `require("electron")`） | 通过 | 沙箱 preload 必须是 CJS；见 §5 缺陷 1 |
| main 引用的 preload 路径与产物一致 | 通过 | 文件名不一致时 renderer 静默无 bridge |

**门禁可证伪（反向对照）**：把构建配置里的 `format: "cjs"` 改为 `"es"` 后重跑本脚本，输出 `passed=false` 且退出码 1；恢复后恢复 `passed=true`。否则“通过”可能来自一个永不报警的检查（P0-02 已因同类问题吃过亏）。

## 4. 仓库治理

### `.gitignore` 策略

| 类别 | 规则 | 理由 |
|---|---|---|
| 依赖与构建 | `node_modules/`、`out/`、`dist/`、`build/`、`coverage/`、`*.tsbuildinfo` | 生成物，可复现 |
| 本地临时 | `.tmp/`、`.tmp-*/`、`*.log`、`runs/`、`.pi-orb-runs/` | 探针与开发草稿 |
| 本地 agent 目标状态 | `.pi/goals/`、`.pi/.goals-pool-snapshot.json`、`.pi/.goals-*.json`、`.pi/tmp/` | 每次运行的本地状态 |
| 凭据与个人数据 | `auth.json`、`**/auth.json`、`*.pem`、`*.key`、`.env`、`.env.*` | 绝不提交 |
| 原生二进制与包归档 | `*.tgz`、`*.dll`、`*.node`、`*.exe` | 版本以哈希留证，制品本身不分发 |
| 截图与像素 | `*.png`、`*.jpg`、`*.jpeg`、`*.webp`、`*.bmp` | 默认不落盘；显式导出也不进仓库 |

**刻意不忽略 `.pi/` 整体**：项目级 `.pi/settings.json`、`.pi/extensions`、`.pi/prompts` 属于需要评审和版本化的项目配置；只有每次运行的本地目标状态被排除。把 `.pi/` 整体忽略会让未来的项目级配置无法版本化——这是 advisor 复核时明确指出的修正。

### 实测确认

- `git status --ignored` 确认 `node_modules/`、`out/`、`.pi/goals/`、`.pi/.goals-pool-snapshot.json` 均被忽略。
- `git status --porcelain` 中**没有** `node_modules/` 或 `out/` 条目（`leakingEntries=[]`）。
- `evidence/` 下无任何 `.png`/`.dll`/`.node`/`.exe`/`.tgz`（`binaryEvidence=[]`），即证据保持纯文本。

## 5. 本阶段发现并修复的两个真实缺陷

两者都属于“构建/启动成功但用户实际拿不到功能”的静默失败，只有真实启动才能观察到。

### 缺陷 1：沙箱 preload 被构建成 ESM，renderer 静默拿不到 bridge

`package.json` 声明 `"type": "module"` 后，`electron-vite` 默认把 preload 输出为 `out/preload/index.mjs`，而主进程引用的是 `out/preload/index.js`：

- 文件名不匹配 → Electron 找不到 preload；
- 即使改名，**沙箱 preload 必须是 CommonJS**（它在沙箱内没有模块加载器时被加载）。

两种情况下 renderer 都只是**没有 `window.orb`**，没有报错、没有日志。修复：显式固定 preload 输出为 `format: "cjs"`、`entryFileNames: "[name].js"`，并在质量门禁中断言“preload 产物是 CommonJS 且被 main 正确引用”。

### 缺陷 2：启动期连接提示在 renderer 订阅前发出，被永久丢弃

主进程在启动时尝试连接 pi-web，失败后 `emit({type:"error"})`。但 renderer 的订阅在页面加载之后才建立，事件先于订阅到达并被丢弃，界面看起来一切正常。修复：把 pi-web 连接状态改为**拉取式的状态快照**（`WorkspaceStatus.piWeb`）而不是推送事件，renderer 主动读取，并保留“刷新”按钮重新探测。

修复过程中还暴露了一个次要问题：先认证后探测可达性时，`fetch failed` 会掩盖真正有用的提示。现在先探测可达性，再认证，因此“没有服务在监听”与“认证失败”会给出不同的、可操作的提示。

## 6. 启动冒烟实测（9/9，真实 Electron）

`run-boot-smoke.mjs` 启动真实 `electron.exe`（隔离 `--user-data-dir`、隔离 `PI_ORB_CONFIG`、`PI_ORB_PI_WEB_URL` 指向一个**故意无人监听**的端口），经 loopback CDP 断言：

| 断言 | 结果 |
|---|---|
| Electron 进程保持存活 | 通过 |
| 创建了 orb 窗口（标题 `pi-orb`） | 通过 |
| preload bridge 暴露到 renderer（`typeof window.orb === "object"`） | 通过 |
| renderer 内**无** `require`/`process`/`module`（沙箱生效） | 通过 |
| contextBridge → ipcMain 往返成功并返回状态 | 通过 |
| 未配置工作区时 Orb 处于禁用状态 | 通过 |
| 界面显示“需要选择工作区” | 通过 |
| 界面显示“无 pi-web 服务应答”，而非静默健康 | 通过 |
| 经 IPC 传入相对路径被拒绝 | 通过 |

隔离边界：只写本次运行的临时目录；测试结束删除该目录；**不截图、不落盘像素、无鼠标键盘输入**。

## 7. 非破坏性确认

`node evidence/p0-01/verify-baseline.mjs` 在本次工作后重跑：pi-web HEAD 仍为 `95a58744532c7fccaa933aa7757a1419ace67ed2`，6 个既有用户改动文件哈希 6/6 同值，`passed=true`。**未修改 pi-web 源码、`node_modules` 或任何用户已有文件。**

## 8. 依赖与环境限制（如实记录）

| 项 | 事实 | 处理 |
|---|---|---|
| npm 11 安装脚本门禁 | `electron`、`esbuild` 的安装脚本默认被拦截，`electron` 二进制不会下载（`node_modules/electron/dist` 缺失） | 使用 `npm approve-scripts electron esbuild` 显式批准 |
| Electron 二进制下载源 | 默认下载失败 | 经 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 执行 `node install.js` 下载成功 |
| 外层 `NODE_ENV=production` | 会让 `npm install` 静默跳过全部 devDependencies（本次曾只装上 6 个包） | 所有门禁脚本显式设置 `NODE_ENV=development` |
| `vite` 必须锁 `7.x` | `electron-vite@5` 的 peer 范围为 `^5 \|\| ^6 \|\| ^7`，不含 `8` | 锁定 `7.3.6`；依据记入支持矩阵 |
| `typescript` 必须锁 `5.9.3` | `typescript-eslint@8` 的 peer 上限为 `<6.1.0`，且不使用 TS 7 预览版 | 锁定 `5.9.3` |

## 9. 明确未验证

- **未启动 Cua 驱动进程**，未做任何真实桌面输入（属 P1-05）。
- **未对真实 pi-web 服务跑端到端聊天**：本次启动冒烟故意指向无人监听的端口，只验证“缺服务时如实报告”。与真实 pi-web 的完整流程属 P1-02。
- **未验证快捷键在真实按键下的行为**：本次实测到 `shortcutRegistered=true`，但唤醒／收起／冲突／退出注销的逐项用例属 P1-03。
- 未验证多显示器、elevated 窗口、macOS/Linux。
- 未执行 `git push`；本次仅本仓库本地提交。
