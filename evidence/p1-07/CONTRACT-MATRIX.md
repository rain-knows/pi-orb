# P1 合同对照：非破坏性不变量（N1–N8）与发布必测项（§7.1）

> 用途：P1-07 要求「N1–N8 对照有证据」且「§7.1 中当前已交付能力对应的必测项通过」。本文件是这两项的唯一对照表。
>
> 证据路径均相对仓库根。**状态只写实际做到的**：未验证的能力在表里就是未验证，不因实现已存在而记为通过。

## 1. 非破坏性不变量 N1–N8（P1 范围）

P0 已就同一组不变量给出结论（见 [`../p0-01/README.md`](../p0-01/README.md)）。下表是 **P1 交付后**的重新对照：左侧是合同要求，右侧是 P1 阶段新增的可复现证据。

| 不变量 | 合同要求 | P1 证据 | 状态 |
|---|---|---|---|
| **N1** 普通非 Orb cwd 会话的工具、系统提示、模型默认值、资源加载与命令行为不被 Orb 主动改变 | 安装前后对比**有效工具/提示**，不只看按钮 | `../p1-06/tool-exposure.json`：普通 cwd 的 provider 实际收到 `tools=["bash","read"]` 且无 orb 工具；`../p1-01/result.json`：普通目录请求无 `orb_mode` section，且与安装扩展前的基线一致 | **通过**（本 P1 测试面） |
| **N2** 不静默改写全局 defaultTools、模型默认值、凭据、用户主题、现有插件配置 | 配置 diff | Orb 只写自己的数据目录（`src/main/config-store.ts`、`bridge-server.ts`）；`evidence/p1-07/release-gate.json` 的写入面审计证明写入仅限三个模块且不指向 pi-web/node_modules；所有测试使用隔离 `PI_CODING_AGENT_DIR` / `HOME` | **通过**（本 P1 测试面） |
| **N3** 普通会话不会因 Orb 扩展静态注册工具而意外新增模型可见 GUI 能力 | 检模型看到的 schema | `../p1-06/tool-exposure.json`：普通会话 `orbTools=[]`；Orb 会话恰好 `orb_click/orb_observe/orb_scroll/orb_type`；`before_agent_start` 只在精确匹配时写 section | **通过** |
| **N4** 悬浮窗/网页共用后端；连接别人的已有 pi-web 不得擅自重启、升级或关闭它 | 连接/退出/崩溃/重复启动流程与进程归属 | `../p0-03/result.json`：壳退出后服务存活、会话仍可访问；P1 壳启动只探测与认证，无任何启动/停止服务的代码路径（`src/main/pi-web-client.ts` 仅有 probe/authenticate/会话命令） | **通过** |
| **N5** 不让两个运行时同时写同一会话文件；控制任务只由一个入口持有 | 双客户端与重连测试 | `../p0-03/result.json`：双客户端同 sessionId、reload 后 sessionId 稳定、旧代次被拒；P1 新增运行代次与单任务锁（`src/main/generations.ts`，`tests/generations.test.ts`） | **通过**（本 P1 测试面） |
| **N6** 安装/关闭/卸载不删除用户工作区文件或历史；不把用户已有源码改动纳入本项目 | 写入清单与源码 diff | `../p0-01/verify-baseline.mjs` 每次门禁重跑：pi-web HEAD 与 6 个既有改动文件哈希不变；写入面审计（见 N2） | **通过** |
| **N7** 扩展与壳退出可清理资源；断连、重载、换会话、恢复后不继承桌面操作授权 | 权限失效、按键释放、锁释放、监听器注销 | `../p1-07/lifecycle-regression.json`（10/10）：折叠撤权、显式停止撤权、**杀掉 pi-web 后刷新即撤权**、撤权不结束会话/不改代次；`tests/window-lifecycle.test.ts` 断言"每次隐藏必伴随 revoke+discard" | **通过**（授权与锁）；**按键/鼠标释放见 §2「原生输入」** |
| **N8** 明确版本与小型适配模块，不维护旧废弃路径、静默 fallback 或多版本兼容层 | 支持版本表、依赖锁、升级门禁 | `doc/support-matrix.md`、`package.json` 精确锁定（驱动 `0.30.1`、Electron `44.4.5`、Pi SDK `0.87.1`）；门禁校验三者一致；本阶段实际移除了被废弃的路径（`isStillForeground`、`TargetRecording`、helper 的 `-IsStillForeground`、适配器的"最前窗口"回退） | **通过** |

**退出条件自查**：P1 未以「插件代码没改上游」代替非破坏性论证——每个不变量都有指向具体证据文件的引用；未修改 pi-web 源码、其 `node_modules` 或用户 6 个已有改动文件。

### 1.1 一个必须随产品一起声明的例外

Pi 无条件加载**用户级** `$HOME/.agents/skills`，`HOME` 在运行时解析，**与 cwd、agentDir 无关**。因此该目录存在时其内容会进入**每一个**会话（含普通非 Orb 会话）的 prompt。

- 证据：`../p1-01/result.json` 的 `promptLeakDeclaration`（隔离 HOME 下放入夹具后，普通 cwd 与 Orb cwd 的 provider 请求体**都**命中该标记，且安装扩展前后次数不变）。
- 产品含义：Orb 能承诺「**不主动改变**它」，**不能**承诺 prompt 内容逐字节零差异。此例外已在 `README.md` 与 `doc/support-matrix.md` 中声明。

## 2. 发布必测项（§7.1）与 P1 证据

合同的 §7.1 明确：**只对当次发布启用的能力**取适用范围；未启用的 P2 能力不阻塞 v0.1，但共享的生命周期与普通 Web 非破坏性回归不得跳过；仅聊天/看图的预览版本必须标注未启用输入。

| 测试类 | P1 证据 | 状态 |
|---|---|---|
| **普通 Web 非破坏性** | `../p1-06/tool-exposure.json`、`../p1-01/result.json`、`../p0-01/verify-baseline.mjs` | 通过。未覆盖 `read-only/default/full/configured` 等**预设切换**的逐项对比（P0-02 覆盖了 `set_tools` 置空与恢复）；**部分** |
| **cwd 与模式** | `../p1-01/result.json`（精确匹配、子目录、前缀相似同级目录、大小写、junction）；`tests/workspace.test.ts`、`tests/orb-config.test.ts` | 通过。**未**验证"两个 cwd 同时运行"与网络路径实际访问 |
| **生命周期** | `../p1-07/lifecycle-regression.json`；`../p0-03/result.json`（reload/resume/双客户端） | 通过。**未**覆盖 fork/换目录后的授权继承（换工作区已由 `src/main/index.ts` 撤权并留日志） |
| **工具选择** | `../p1-06/tool-exposure.json`（模型实际收到的 schema）；`../p0-02/result.json`（W1 自动追加、reload、chat-only）；`tests/desktop-broker.test.ts`（终止同批后续动作）；`../p1-06/real-model-c7-reference-backend.json`、`real-model-d6-scroll-reference-backend.json`、`real-model-d8-type-reference-backend.json` | 通过（模型看到的 schema 为准，非 UI 标签）；当前参考 backend 已取得真实模型 C7、D6、D8 的目标日志证据 |
| **图像** | `../p1-04/result.json`（41/41：目标记录、句柄匹配、尺寸与真实像素测量、遮罩排除、丢弃零上传、确认字节与 provider 收到字节 hash 一致）；`tests/screenshot-flow.test.ts` | 通过（含正向截图→预览→确认发送）。**未**验证：多屏、被遮挡窗口、高权限窗口、截图前窗口被关闭/句柄复用 |
| **原生输入** | `../p1-05/input-verification.json`（历史 Cua 基线）；`tests/reference-windows.test.ts`、`tests/reference-windows-driver.test.ts`、`tests/desktop-broker.test.ts`；`../p1-06/loop-verification-reference-backend.json`、`real-model-d6-scroll-reference-backend.json`、`real-model-d8-type-reference-backend.json` | **部分**：当前参考 backend 的滚动/输入目标日志已验证，撤权到 native action 的取消链由竞态测试覆盖；高权限窗口对比、真实前台中途撤销时序仍未验证。历史 Cua 适配器测试已删除，不能作为当前生产证据。 |
| **快捷键** | `../p1-03/result.json`、`../p1-03/edge-guard-integration.json`（真实 Electron + native hook，合成 F24 长按）、`../p1-03/README.md`；`tests/shortcut-edge-guard.test.ts` | OS 注册链路和合成长按集成通过；真实长按仍需运行中人工复测。托盘逻辑已修复并有单测，但需运行中人工复测。AltGr/非 US 布局、锁屏恢复未验证；双 Alt 属 P2，未启用 |
| **进程与认证** | `../p0-03/result.json`（401/403/伪造 Host、壳退出不杀服务、旧代次拒绝）；`tests/bridge-server.test.ts`（令牌、浏览器来源、代次、策略拒绝上抛） | 通过。**未**验证 LAN 请求与真实 Electron 跨 origin cookie/SameSite 细节 |
| **打包／卸载** | `THIRD_PARTY_NOTICES.md`、`../p1-07/license-inventory.json`、门禁的写入面审计（N6） | **部分**：许可与写入面已审计；**未**构建真实安装包，**未**做安装/卸载实测 |

图例：**通过** = 对应能力在本机可复现验证；**部分** = 部分用例已验证、其余明确未验证；未列出的 P2 能力（双 Alt、选区、额外平台）本版本未启用，不阻塞。

## 3. 本版本的能力声明（不得超范围宣称）

| 能力 | 可否声明 |
|---|---|
| 专用 cwd 的独立会话与聊天 | **可用** |
| 全局快捷键唤醒/收起、托盘备用入口 | **可用**（按键人工体验待人工确认） |
| 普通 Web 非破坏性、不双写会话、退出不杀服务 | **可用** |
| 授权截图（预览、删除、确认发送） | **可用**：拒绝路径与正向路径均已实测（含预览字节与 provider 收到字节的 hash 一致）；未验证范围限多屏/遮挡/高权限窗口 |
| 桌面点击闭环（一动作一观察、授权、预算、失败即停） | **可用**：后台点击与**前台点击**均已实测；失败即停由单测覆盖。模型给出的位置是**截图分数（0–1000）**，由宿主映射到窗口，不再要求模型提供屏幕绝对坐标 |
| 桌面滚动 | **可用**：前台升级后目标记录到真实 `wheel` 且滚动条实际位移，由目标自身事件日志判定 |
| 向 Chromium 内容输入文本 | **不可声明**：后台投递对该窗口类不可用，前台升级尚未做到稳定投递 |
| 完整 v0.1（M1+M2+M3+P1-07） | **不可声明**：多显示器、高权限窗口、向 Chromium 内容输入文本仍未验证 |

## 4. 维护约定

- 新增能力时同步更新本表，并附可复现证据路径；不得只改结论。
- `evidence/p1-07/run-release-gate.mjs` 会检查各阶段证据文件存在、且 `../p1-05/README.md`、`../p1-06/README.md` 仍保留「明确未验证」小节，防止发布时通过删记录来"变绿"。
- 已发布版本的组合以 `doc/support-matrix.md` 为准；本文件只作合同对照，不另行声明兼容性。
