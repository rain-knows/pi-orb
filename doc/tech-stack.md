# pi-orb 技术栈与选型依据

- 文档状态：当前实现基线与选型记录
- 依据：[`pi-orb-development-goals.md`](./pi-orb-development-goals.md) 及其中记录的 Pi、pi-web、Electron 和 DeepSeek Orb 证据；FFF/LSP 仅作为可选开发工具另行评估
- 版本原则：只支持经过验证的一组版本；不在代码中保留废弃 API 的兼容层、静默回退或多版本迁移路径

## 1. 结论

pi-orb 应采用**单仓库、TypeScript 为主、Electron 桌面壳 + 现有 pi-web/Pi 会话服务 + Pi 扩展 + 独立桌面能力适配器**的最小分层架构。

首发建议如下：

| 领域 | 推荐技术栈 | 选型结论 |
|---|---|---|
| 桌面壳 | Electron 主进程、受限 preload、简洁 renderer | 已确定方向。Electron 是产品核心，不复制 Pi 会话引擎 |
| 运行时与语言 | Node.js 24.19.0、TypeScript strict | 已按当前开发基线固定 |
| renderer | React + TypeScript + Vite；普通 CSS 或轻量样式模块 | 推荐最小 UI 方案；不使用 Next.js，不复制 pi-web 页面状态树 |
| Pi 接入 | Pi SDK 及 Pi 扩展 API；独立 `orb_` 工具与结构化 prompt section | 已确定接入方向；当前证据基线为 Pi SDK `0.87.1` |
| pi-web 接入 | 小型 HTTP/SSE 客户端适配层 | 复用会话创建、消息、图片、事件和停止行为；不访问私有 registry 或 hook 私有方法 |
| 本机桥接 | 认证的 loopback 连接、named pipe 或 Unix socket 之一 | 需要 P0-03 选择；不以关闭认证、wildcard CORS 或暴露 Node 给 renderer 代替桥接 |
| 桌面能力 | 直接复用 DeepSeek Orb 的 Windows 原生 backend（`koffi`/GDI/`SendInput`/clipboard）；由 `reference-windows-driver.ts` 接入 Orb 授权 | Cua 仅用于独立探针和历史证据，不进入生产 action path |
| 截图与快捷键 | Electron `desktopCapturer`、`globalShortcut` + `uiohook-napi` key-up edge guard；双 Alt 单独评估 | Electron 负责注册和冲突诊断，hook 只补充普通组合键的 key-up 边沿；当前窗口截图、DPI、真实长按、双 Alt 均需实测 |
| Orb 自有配置 | Electron `app.getPath('userData')` 下的独立配置 | 只保存工作区、窗口、快捷键等 Orb 配置；不改写 Pi 全局默认值 |
| 测试 | TypeScript 类型检查、单元/协议测试、Electron 集成测试、Windows 真机 smoke | 推荐分层；mock 不能替代原生输入取消与释放测试 |
| 打包 | Electron Forge 作为首选候选，Windows x64 优先 | 需通过干净机器安装、卸载和许可检查后才能锁定 |
| FFF/LSP | 不作为产品运行时依赖 | 作为可选开发工具单独试点；不应混入 pi-orb 运行时技术栈 |

## 2. 已确定方向、推荐项与待验证项

### 2.1 已确定方向

这些内容来自开发目标文档，不因技术栈文档而扩大范围：

- 使用 Electron 实现浮窗、唤醒、收起、托盘、截图预览和原生权限生命周期。
- 复用已经运行的 pi-web/Pi 服务、模型与凭据配置、插件安装和会话存储；Orb 使用独立会话，不另写模型调用循环或会话引擎。
- 用专用 `cwd` 作为 Orb 模式识别条件；它是组织和模式标记，不是文件访问沙箱或 OS 权限边界。
- Pi 扩展负责 cwd 条件、工具注册/选择、提示追加和动作结果图片；Electron 主进程负责窗口、授权和桌面能力生命周期。
- renderer 使用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，只通过最小化的 `contextBridge` 暴露能力。
- 普通 pi-web 会话的工具、提示、模型默认值、凭据、主题和插件行为必须保持不变。

### 2.2 推荐但尚未锁定

- Windows x64 是首发优先候选，但仍需在 P0-01 确认；macOS/Linux 不因代码可编译就宣称支持。
- renderer 采用 React + Vite，而不是 Next.js。浮窗是单一客户端 UI，不需要再引入服务端渲染和路由框架；React 也与 pi-web 的现有前端生态一致，但 Orb 不复制其组件树或内部状态。
- 使用 npm 与 `package-lock.json` 作为初始依赖管理方案。当前项目规模不需要提前拆包或引入 monorepo；如果上游接入实际要求其他包管理器，须在 P0 记录原因并只支持一种方案。
- Electron Forge 作为首选打包工具，以减少自建 Windows 安装流程；v0.1 不默认加入自动更新，避免未经确认重启或替换用户当前 pi-web/Orb 环境。
- 测试采用 Vitest（纯函数、协议和适配器）加 Electron 集成测试；renderer 交互只有在出现稳定 UI 验收需求时再引入 Playwright。原生截图、输入、权限和取消必须在批准的 Windows 真机验证。
- IPC 协议使用 TypeScript 判别联合、明确的请求代次/session 绑定和边界校验。只有在协议复杂度实际增加时，才引入运行时 schema 库；类型声明本身不能代替来自 renderer 或本机连接的数据校验。

这些推荐不是已安装依赖，也不代表已通过兼容性测试。

## 3. 分层技术说明

### 3.1 Electron 主进程与 preload

**主进程职责：**

- 创建和管理浮窗、托盘、置顶、展开/收起和退出；
- 注册和注销常规全局快捷键；
- 管理截图预览、授权、任务锁、取消和桌面后端；
- 保存 Orb 自有配置，并管理由 Orb 自己启动的子进程；
- 通过经过认证的适配器连接 pi-web。

**preload 职责：**

- 只暴露面向产品能力的最小方法，例如窗口控制、状态订阅、截图预览、发送消息和显式停止；
- 不暴露原始 Node API、任意 shell、文件系统遍历或通用 IPC；
- 校验来源、请求代次和可接受参数，并对不可用能力返回明确错误。

**renderer 职责：**

- 展示聊天流、错误、工作区状态、截图预览和授权状态；
- 不拥有模型凭据、桌面输入权限或任意文件访问权限；
- 不通过 iframe、DOM 注入或复制 pi-web 内部 React 状态来改造普通页面。

### 3.2 Pi 与 pi-web

Pi 扩展是首选的模式装配点。优先验证以下能力组合：`session_start` 中依据 `ctx.cwd` 条件注册资源、`before_agent_start` 添加结构化 prompt section、按需选择工具，以及 `session_shutdown` 清理资源。Orb 工具使用 `orb_` 前缀，避免与用户扩展重名。

pi-web 客户端适配层只封装已观察到的公开行为：

- 创建指定 cwd 的独立会话；
- 发送文本和图片消息；
- 订阅 SSE 事件、读取历史和停止任务；
- 处理认证、重连、会话运行代次和错误。

当前实测基线是 pi-web `@agegr/pi-web@0.9.3` 与 Pi SDK `0.87.1`；跨 origin 认证、独立会话、桥接和生命周期已有 P0/P1 证据。不能依赖 pi-web 的内部 `SessionManager` 注册表、私有全局变量、页面菜单实现或未确认的工具 preset 注册接口。

### 3.3 桌面能力后端

桌面后端必须通过单一适配器提供观察、截图、点击、输入、滚动、取消和清理语义。实现基线直接取 DeepSeek Orb 固定提交中的 `windows.ts`、`windows-native.ts`、`windows-foreground.ts` 和坐标测试；pi-orb 的适配只负责授权、代次、目标记录和 bridge。

P0-04 的 Cua Driver MCP 只读探针仍作为证据，记录版本、许可证、工具目录、截图尺寸、坐标空间、权限和取消语义；探针结果不能决定生产 backend，也不能在 native backend 失败时自动接管。P1-05 只验证最终选择的原生 backend 在丢弃目标上的输入、DPI、焦点、普通/高权限窗口和取消释放。

DeepSeek Orb 中已经验证的 koffi/GDI/SendInput、clipboard、窗口激活和坐标实现优先作为生产实现来源；先复用固定提交中的代码与测试，再针对 pi-web/Orb 授权边界做最小适配。JXA/CGEvent 等当前平台之外的实现按同一原则在需要时集成。任何驱动都不得自行选择模型、拥有聊天循环或扩大 OS 权限。截图正常不等于点击安全，mock 通过也不等于输入取消和按键释放通过。

### 3.4 本机连接与数据边界

Electron renderer 与 pi-web 的 Node 服务不是同一进程，不能把 renderer IPC 当作跨进程认证方案。P0-03 应在合法认证、来源校验、CSRF/origin 规则和本机连接所有权明确后，选择 loopback、named pipe 或 Unix socket 中的一种。

- 凭据留在 Pi/pi-web 服务侧；
- 截图默认只在内存中处理，确认发送后才进入会话数据；
- 日志只记录脱敏的动作类别、错误码和耗时，不写入截图 base64、密钥或敏感输入；
- 桌面授权绑定会话运行代次、任务范围、有效期和限额，不持久化为可恢复的 `enabled=true`；
- 断连、重载、换会话、恢复、锁屏和退出都必须撤销临时桌面授权并释放按键、鼠标、锁和监听器。

## 4. 版本边界与支持策略

### 4.1 当前证据基线

| 组件 | 当前文档中的证据 | 解释 |
|---|---|---|
| Pi SDK | `0.87.1` | 本机安装包和调研基线；不是已验证的 pi-orb 运行组合 |
| pi-web | `@agegr/pi-web@0.9.3` | 当前记录的本机包版本；远端固定提交需重新核验 |
| Electron | `44.4.5` | 已锁定并通过 Electron 浮窗、截图、桥接和构建验证 |
| Node.js | `24.19.0` | 当前开发与验收基线；其它版本未验证 |
| 桌面驱动 | 已选定：参考项目 Windows native backend，固定提交 `72f1d738458a223696685a909e806b683eff5885` | Windows x64 生产路径已接入；真实模型 C7、D6、D8 已通过，其他环境项仍按支持矩阵单独验收 |
| OS | Windows 11 x64 | 首发目标；多屏、高权限和其它平台仍未验证 |

### 4.2 锁定规则

在 P0-01/P0-05 完成前，不宣称任意版本兼容。首个支持组合至少要记录：

- pi-orb 版本、Node.js 版本和 Electron 版本；
- pi-web 版本/提交与 Pi SDK 版本；
- renderer 构建工具和桌面驱动版本；
- Windows 版本、架构、键盘布局及相关权限状态；
- 安装包、许可证和第三方 notice 的版本。

升级流程是在独立测试环境验证新组合，然后发布明确的支持矩阵；不是在代码中保留旧 API fallback 或迁移层。若上游接口不满足 N1–N8，停止受影响能力并记录具体符号、复现和替代方案，不能通过 monkey patch、修改 node_modules 或长期维护 fork 越过门槛。

## 5. P0 验证门槛

| 门槛 | 必须证明的事实 | 未通过时的处理 |
|---|---|---|
| P0-01 基线 | 普通 cwd 的工具、prompt、命令、模型和配置前后一致；支持版本和写入清单明确 | 不在日常配置上继续试验，先记录冲突 |
| P0-02 扩展 | cwd 条件注册、工具选择、prompt section 在创建、reload、恢复、fork、chat-only 和多 cwd 下不泄漏 | 停止实现 Orb 工具，评估受支持的最小接入点 |
| P0-03 桥接 | 合法 Electron 客户端可认证、创建会话、发消息、重连和停止；伪造来源/旧代次/无授权请求均被拒绝 | 不关闭认证、不公开控制 API、不让 renderer 获得 Node 权限 |
| P0-04 驱动 | 只读观察、图片、坐标和清理语义真实可用且许可明确 | 不能把截图探针当输入验收，必要时停在聊天/看图版本 |
| P0-05 决策 | 只有一个最小接入方案和一个桌面后端候选，未通过项与上游改动清楚 | 提交决策给用户，不自行扩大范围 |

P0 和大部分 P1 已完成。当前产品已启用显式授权的桌面工具；当前参考 backend 的 C7、D6、D8 已通过，但完整 v0.1 仍受多屏、高权限、Chromium 内容输入和取消时序等未验证项约束。

## 6. 明确不纳入技术栈

- 不复制 Pi 的模型调用循环、模型管理、插件市场、会话引擎或 DeepSeek Orb 的整个后端。
- 不把 FFF、LSP、MCP 搜索工具作为 pi-orb 运行时依赖；它们只属于可选开发工作流，原有评估见 [`pi-fff-lsp-necessity.md`](./pi-fff-lsp-necessity.md)。
- 不引入通用多租户权限系统、cwd 强隔离、远程桌面控制、全桌面常驻录制或完整后台调度中心。
- 不依赖双 Alt 才能启动 MVP，不推测 Codex 的内部实现，也不自动上传截图。
- 不在首版预设多个平台后端、多个 LSP/FFF 实现、多个包管理器或多个 renderer 框架。
- 不以提示词、cwd、Electron UI 标签或工具名称冒充 OS 安全授权。

## 7. 下一步顺序

1. 复测 A4/A5/A8、B9 这类需要当前 Electron 实例或真实键盘的人工项。
2. 有条件时补多显示器、高权限窗口、Chromium 内容输入和按下中途取消；结果写入支持矩阵。
3. 每次参考项目提交变化只在独立环境跑 backend 合同测试和 disposable 目标验收，不能把旧路径重新加回生产构建。
