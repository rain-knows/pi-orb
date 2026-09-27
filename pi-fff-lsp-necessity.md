# FFF 与 LSP 对当前 Pi 插件体系的需要程度评估

> 评估日期：2026-09-27
> 评估范围：当前用户级 Pi 配置、已安装包、用户扩展，以及 `D:/workself/daily`、`D:/work/costgraph`、`D:/work/agent_demo` 和额外参考项目 `pi-web`。
> 评估性质：只读研究与决策建议；没有安装 FFF/LSP、修改 Pi 配置、安装语言服务器或做性能/兼容性实测。

## 1. 结论摘要

| 能力 | 当前需要程度 | 建议 | 结论依据 |
|---|---:|---|---|
| **FFF / pi-fff** | 中等、条件性 | **条件引入，先试用，不立即全局替换** | 对大型代码仓库和长时间会话有索引、模糊匹配、Git/frecency 排序收益；对当前 `daily` 的文档/HTML 小工作区收益有限，且会增加原生索引、数据库和启动资源成本。 |
| **LSP** | 分层：文档工作流低；代码工作流高 | **代码项目优先条件引入；不建议现在无选择地全局启用** | `costgraph`、`agent_demo`（Python + JS/TS 系列）以及 `pi-web`（TypeScript/TSX）存在潜在的诊断、定义、引用、符号和重构需求；但本机当前 PATH 未发现对应语言服务器，启用前必须按项目配置并验证。 |

一句话决策：**如果目标是提升代码开发质量，LSP 的优先级高于 FFF；如果目标是降低大型仓库中的“找文件/搜内容”成本，再验证 FFF。当前日常调研、Markdown、HTML 制作不需要为了“插件齐全”而引入二者。**

## 2. 当前环境事实

### 2.1 已有 Pi 插件体系

Pi 版本为 `0.87.1`。用户级 `C:/Users/JUSTLIKEZYP/.pi/agent/settings.json` 配置了 11 个包，主要职责是：

- `pi-goal-x`：目标与任务状态；
- `pi-subagents`：子代理与相关技能；
- `pi-mcp-adapter`、`pi-web-access`：外部工具、MCP 和网页研究；
- `pi-rewind`：修改回滚与检查点；
- `pi-open-tui`、`@janvitos/pi-usage`：界面和使用量展示；
- `prompt-architect`：用户扩展，负责按当前工具组合成系统提示；
- 另有计划模式、提问和顾问包；`@quintinshaw/pi-dynamic-workflows` 虽在配置中声明，但其 `extensions`、`skills`、`prompts`、`themes` 均被过滤为空，本次不把它视为已启用能力。

检查结果：

- 用户包清单中没有 `fff`、`pi-fff` 或 LSP 包；
- `C:/Users/JUSTLIKEZYP/.pi/agent/extensions/` 中只有 `prompt-architect`；
- 当前工作区 `.pi/` 只有目标状态文件，没有项目级 FFF/LSP 配置；
- Pi 文档定义的内置 `find`、`grep` 工具仍是现有能力的一部分。注意：`settings.json` 的 `defaultTools` 仅是启动配置快照，不能据此推断运行时绝对没有 `find`/`grep`；本次评估不把该字段当成工具使用频次证据。

### 2.2 代表性工作区

| 工作区 | 观察到的内容 | 对插件的含义 |
|---|---|---|
| `D:/workself/daily` | 以 Markdown、HTML、CSS、MJS、JSON 为主；当前任务和历史记录显示大量文档阅读、网页研究、内容编辑。 | 文本查找通常足够；LSP 的语义收益低，FFF 只有在目录持续扩大或搜索重复很多次时才有价值。 |
| `D:/work/costgraph` | Git 跟踪的自有代码包括 `backend/` 下 97 个 Python 文件、`frontend/` 下 45 个 JS/TS 系列文件，README 明确是 FastAPI + React/Vite 项目；未把缓存、虚拟环境和生成物计入。该统计包含测试等跟踪文件，不等同于生产源码数量。 | LSP 有潜在的类型/定义/引用/诊断价值；FFF 的索引和路径/内容检索也可能有收益。仍需限制忽略目录和索引范围。 |
| `D:/work/agent_demo` | Git 跟踪的自有代码包括 `backend/` 下 105 个 Python 文件、`frontend/` 下 55 个 JS/TS 系列文件；README 包含 pytest、FastAPI/前端构建等日常验证流程。该统计包含测试等跟踪文件，不等同于生产源码数量。 | 同时存在 Python 后端和前端 JS/TS 系列代码，LSP 有明确的项目级验证候选价值；FFF 是否有额外收益取决于跨目录搜索频率。 |
| `C:/Users/JUSTLIKEZYP/OneDrive/文档/daily/pi-web`（额外参考） | Next.js/React/TypeScript 项目，`package.json` 中包含 Pi 0.87.1 依赖。 | TypeScript LSP 具有实际价值；FFF 可改善跨目录文件定位，但不取代语义工具。 |

当前环境 PATH 检查到 Node 24、PowerShell 7 和 Java 21；没有发现以下主要语言服务器命令：

- `typescript-language-server`；
- `pyright` / `pyright-langserver`；
- `gopls`；
- `rust-analyzer`；
- `clangd`；
- `jdtls`；
- `lua-language-server`。

这只证明它们没有出现在本次 Pi 进程可见的 PATH 中，不能证明 IDE 私有环境或其他安装位置绝对不存在；但对 Pi 的直接可用性而言，这已经是一个需要解决的前置条件。

## 3. FFF 评估

### 3.1 能力边界

核对的 `@ff-labs/pi-fff` 说明和源码表明，它使用 Rust 原生引擎及 Node 原生绑定，提供：

- `fffind`：模糊文件/路径搜索；
- `ffgrep`：内容搜索、分页、上下文和约束；
- `fff-multi-grep`：多模式 OR 搜索；
- `@文件` 模糊补全；
- 后台索引、文件 watcher、Git 状态、frecency/history 排序。

它有三种模式：

- `tools-and-ui`：新增 FFF 工具并接管 `@` 文件补全；
- `tools-only`：只新增工具，不接管原生补全；
- `override`：在 `find`、`grep` 和 `multi_grep` 这些原有名称下注册 FFF 实现，替换 Pi 的内置搜索实现。

FFF Node 文档声明提供 Windows x64/ARM64 原生包，必要时可从 release 下载；这是发布包的支持声明，不是本机已安装或性能已验证的证据。

### 3.2 对当前体系的实际收益

**有收益的场景：**

1. 在 `costgraph` 这类前后端分目录项目中，反复查找分散在深层目录的文件；
2. 在 `pi-web` 中以不完整、带拼写误差的路径寻找组件或 hook；
3. 长时间 Pi 会话里多次搜索同一仓库，索引和 frecency 能减少重复扫描与上下文噪声；
4. 需要同时查多个文字模式，并希望通过分页限制模型上下文时。

**收益有限的场景：**

1. `daily` 中少量 Markdown/HTML/CSS 文件的一次性搜索；
2. 只读写当前已知路径，几乎不做模糊定位的任务；
3. 主要困难是“代码含义/类型关系”，而不是“文件在哪”。FFF 不提供定义、引用、类型和编译诊断。

### 3.3 成本与风险

- 启动后需要建立原生索引；大型目录、HOME 目录或包含构建产物的目录可能增加 CPU、内存和等待时间；
- 使用 LMDB 保存 frecency/history，需要考虑本地数据库锁、损坏恢复和数据目录管理；
- 原生 Node binding 增加平台二进制和供应链维护面；Windows 支持需实际启动验证；
- `override` 可能改变现有工具名/行为。默认 `tools-and-ui` 更容易回退，但会同时暴露多套搜索工具，增加模型选择成本；
- FFF 的索引质量、忽略规则、符号链接和生成目录边界需要以实际仓库验收，不能只依据“比 ripgrep 快”的宣传；本次未做基准测试。索引按当前工作区/请求路径建立，不等于启动后扫描整台机器。

### 3.4 FFF 决策

**不建议现在立即全局启用或直接使用 `override`。建议条件引入：**

1. 先选 `D:/work/costgraph` 或 `pi-web` 作为单一试点；
2. 初始使用 `tools-and-ui` 或 `tools-only`，保留 Pi 原生搜索；
3. 明确排除 `node_modules`、构建产物、`.pyc`、缓存和不需要的外部链接目录；
4. 对比 10～20 个真实搜索任务：首次索引耗时、重复搜索耗时、CPU/内存、结果准确率、返回上下文大小；
5. 只有当结果稳定且确实降低搜索往返，再考虑 `override`；
6. `daily` 目录暂不需要为了 FFF 增加索引与原生依赖成本；这不是“全局扫描”的判断，而是基于该目录当前规模和搜索需求的收益/成本判断。

**暂不引入的条件：**仓库规模小、搜索次数少、现有 `grep`/`find` 已足够，或者索引启动成本明显打断日常交互。

## 4. LSP 评估

### 4.1 能力边界

LSP 插件把语言服务器的 IDE 能力暴露给 Pi，常见能力包括：

- 诊断、错误和警告；
- hover 类型/文档；
- 跳转定义、查找引用、查找实现；
- 文件/工作区符号和调用层级；
- 重命名预览、代码操作；
- 写入/编辑后的增量诊断。

候选实现并不完全相同：

- `samfoy/pi-lsp-extension` 包含 LSP 工具，并有 tree-sitter fallback；它要求按语言安装 server，README 列出 TypeScript、Python、Rust、Go、Java 等常见组合；
- `@gitawego/pi-lsp` 偏配置驱动，提供持久化项目会话、progressive diagnostics、官方 server catalog 和部分自动安装策略；
- `trotsky1997/pi-lsp-extension` 进一步组合 formatter、analyzer、debug/DAP，能力更宽，因而维护和配置面也更大。

这三者不应同时安装。需要先按“最小满足当前项目”的原则选择一个实现；本评估不替用户锁定具体仓库。

### 4.2 对当前工作流的实际收益

**`costgraph`（Python + JS/TS 系列）：高收益候选。**

- Git 跟踪的自有代码有 97 个 Python 文件和 45 个 JS/TS 系列文件；项目 README 说明其后端是 FastAPI、前端是 React/Vite；这些文件包含测试等跟踪文件，数量本身不证明存在搜索瓶颈；
- 定义/引用、类型信息和编辑后诊断有望减少定位和修改错误，但仍待真实任务验证；
- 前提是项目依赖、虚拟环境、生成代码和 server 工作区根目录配置正确。

**`agent_demo`（Python + JS/TS 系列）：高收益候选。**

- Git 跟踪的自有代码有 105 个 Python 文件和 55 个 JS/TS 系列文件，且日常流程明确包含后端 pytest 与前端构建；这些文件包含测试等跟踪文件，数量本身不证明存在搜索瓶颈；
- 可用一个后端诊断和一个前端定义/引用任务验证 LSP，收益判断应以真实任务为准，而不是仅凭文件数量。

**`pi-web`（TypeScript/TSX）：高收益候选。**

- Next.js/React 项目中组件、hook、类型和导入关系较多；
- TypeScript LSP 对定义、引用、类型和错误诊断有直接价值；
- 该项目有自己的 `typescript` 开发依赖，但这不等于安装了 `typescript-language-server`，需要单独配置/验证。

**`daily`（Markdown/HTML/CSS/MJS）：低到中收益。**

- MJS/HTML/CSS 可以受语言工具帮助，但当前工作重点是内容研究和网页素材，不是大型语义重构；
- Markdown LSP、HTML/CSS LSP 可作为特定项目需求再加，不值得为整个 Pi 环境预先启用；
- 对事实核验、网页研究、文档组织，现有 `pi-web-access`、MCP、搜索和提示编排比 LSP 更关键。

### 4.3 成本与风险

- 每种语言都需要匹配的 server、版本、项目根目录和依赖环境；插件本身不是完整的语言分析器；
- server 进程常驻会增加内存和启动/关闭管理复杂度；大型 Java 项目等 server 可能更重；
- 诊断可能包含依赖链或生成代码导致的误报，需要按项目限流或关闭自动注入；LSP 反馈也不能替代项目已有的类型检查、测试、构建和人工审阅；
- Windows 下 server 的 PATH、PowerShell 启动环境和路径解析需要实测。公开资料中有过 Windows/PowerShell 下 server 发现异常的 issue；该 issue 的当前修复状态本次未核实，因此不能据此判定当前实现不可用，也不能仅依据“跨平台”声明判定可用；
- 某些实现有 server 启动/关闭、daemon、原生进程残留等维护风险；应先选择成熟度和范围合适的实现，不要把 formatter/analyzer/debug 全套能力一并引入；
- LSP 工具名在不同实现间不同。现有 `prompt-architect` 对精确名称 `lsp` 有专门路由，但不会自动识别所有 `lsp_diagnostics`、`lsp_definition` 等名称；这只是提示增强缺口，不代表工具不可见或必须修改，因为扩展也可以提供自己的 prompt guidelines。试用时应检查实际路由。

### 4.4 LSP 决策

**不建议对所有工作区无条件启用；建议按代码项目条件引入，并优先于 FFF。**

推荐顺序：

1. **先在 `agent_demo` 或 `costgraph` 选择一个代表任务验证 LSP**：选择 Python 后端诊断或前端 JS/TS 定义/引用任务，确认 server 可启动、能识别项目根目录，并在一次真实编辑后返回有用反馈；
2. **再按实际语言配置**：Python 优先使用项目实际解释器/虚拟环境对应的 Pyright 或同等方案，JS/TS 则验证 TypeScript server，检查导入、类型存根和生成目录噪声；
3. `pi-web` 作为额外参考项目，只有在用户需要其独立开发支持时再验证；`daily` 仅在出现明确的 JS/HTML/CSS 语义导航或大量重构需求时配置；
4. 暂不引入同时包含 formatter、analyzer、debug/DAP 的“大而全”包，除非这些能力有独立的近期需求。

**暂不引入的条件：**当前任务主要是调研/写作、项目没有稳定依赖环境、无法接受常驻 server，或实际诊断噪声大于节省的人工检查时间。

## 5. 与现有插件体系的兼容性

### 5.1 FFF 与现有搜索工具

FFF 不与 `pi-mcp-adapter` 形成必然互补：FFF 的 Pi 原生扩展直接注册本地搜索工具，通常比把搜索再绕过 MCP 代理更简单。除非需要跨宿主共享 FFF MCP server，否则不建议两条路径都配置。

现有提示架构对 `grep`/`find` 有精确工具策略；FFF 的默认新增模式使用 `ffgrep`/`fffind`，因此需要试用时检查模型是否能正确选择它们。FFF 源码也提供自己的工具 guidelines，提示路由缺口不等于功能不可用。若选择 `override`，工具名更接近原有提示策略，但会付出替换内置行为和调试回退困难的代价。**不要为了提示词匹配而牺牲可回退性。**

### 5.2 LSP 与现有提示/代理体系

LSP 可以作为模型调用工具，与 read/edit/write、子代理、回滚和 prompt-architect 互补：

- read/edit/write 负责文本和文件变更；
- LSP 负责语义查询和编辑后反馈；
- rewind 负责恢复错误修改；
- subagents 可把独立代码调查交给子代理。

风险在于工具数量、server 生命周期和提示词路由增加。应先只启用定义、引用、诊断等最需要的能力，确认模型真的调用并能利用结果，再扩大工具集合。

## 6. 建议的验证矩阵

### FFF 试点

| 项目 | 验收证据 |
|---|---|
| 初始化 | 在试点仓库启动 Pi，记录首次索引耗时、是否阻塞首轮交互、CPU/内存峰值。 |
| 搜索质量 | 用真实的路径模糊、拼写错误、内容、Git modified、排除目录案例与原生工具对照。 |
| 上下文效率 | 比较同一任务需要的搜索调用次数、返回行数和模型上下文大小。 |
| 稳定性 | 修改/新增/重命名文件后重搜；测试 `/reload`、恢复会话、关闭 Pi、数据库锁冲突。 |
| 边界 | 确认 `node_modules`、`.pyc`、构建目录、符号链接和 OneDrive 路径不会造成不受控扫描。 |
| 回退 | 关闭 FFF 后原生 `find`/`grep` 可正常工作；未先验证前不使用 `override`。 |

### LSP 试点

| 项目 | 验收证据 |
|---|---|
| Server 发现 | 在 Pi 启动方式（PowerShell）下记录 server 的实际路径、版本和启动日志。 |
| 工作区根目录 | 在 monorepo/子目录中确认使用正确的 `package.json`、`pyproject.toml` 或其他 root marker。 |
| 语义查询 | 用一个已知函数测试 hover、definition、references、symbols；结果必须指向真实符号而非文本同名项。 |
| 编辑反馈 | 修改一个可控 fixture，确认诊断能返回且不会污染所有无关文件。 |
| 噪声控制 | 检查依赖缺失、生成文件、类型存根和测试目录造成的误报；记录可接受的配置。 |
| 生命周期 | 测试 session resume、`/reload`、`session_shutdown`，确认没有残留或反复启动的 server 进程。 |
| 提示路由 | 确认模型知道何时用 LSP，且扩展工具名与 prompt-architect/扩展自带 guidelines 一致。 |

## 7. 最终行动建议

### 现在

- **不安装 FFF/LSP，不修改全局配置。** 当前目标是评估而非实施，且 daily 文档任务没有迫切缺口；
- 将 **LSP 作为代码开发能力的优先候选**，先针对 `agent_demo` 或 `costgraph` 做一个后端/前端最小验证，再视需要验证 `pi-web`；
- 将 **FFF 作为大型仓库搜索优化候选**，先在一个仓库以非 override 模式试用；
- 不同时试装多个 LSP 实现，也不把 FFF MCP 与 pi-fff 叠加。

### 若下一步允许试用

1. 先选一个代表项目和一项可重复任务；
2. 先做 LSP 单项目验证（TypeScript 或 Python 二选一）；
3. 记录诊断/导航是否真正减少人工搜索和返工；
4. 再做 FFF 单仓库搜索对照；
5. 只有验证有收益，才写入用户级配置；项目特定配置优先放项目 `.pi` 或项目约定位置；
6. 任何一步出现 server 残留、索引明显拖慢启动、结果噪声过高或 Windows 路径问题，先停止并修正边界，不通过增加更多插件掩盖问题。

## 8. 证据与限制

本报告依据：

- 本机 Pi `0.87.1` 文档、`settings.json`、`pi list` 输出和用户扩展目录；
- `D:/workself/daily`、`D:/work/costgraph`、`D:/work/agent_demo` 和 `pi-web` 的目录/README/manifest 只读检查；
- [FFF Pi 扩展 README](https://github.com/dmtrKovalenko/fff/blob/main/packages/pi-fff/README.md)、[扩展注册源码](https://github.com/dmtrKovalenko/fff/blob/main/packages/pi-fff/src/index.ts) 和 [Node 平台说明](https://github.com/dmtrKovalenko/fff/blob/main/packages/fff-node/README.md)；
- [samfoy/pi-lsp-extension README](https://github.com/samfoy/pi-lsp-extension)、[CHANGELOG](https://github.com/samfoy/pi-lsp-extension/blob/main/CHANGELOG.md)；[@gitawego/pi-lsp README](https://github.com/gitawego/pi-lsp/blob/main/README.md) 及其 [Windows/PowerShell issue](https://github.com/gitawego/pi-lsp/issues/1)；[trotsky1997/pi-lsp-extension README](https://github.com/trotsky1997/pi-lsp-extension)。

版本说明：samfoy 主分支 `package.json` 为 `1.4.0`；CHANGELOG 曾注明 npm 最新为 `1.3.0`；当前 npm 发布版本未独立核实，实施时须核对。本报告不把 Git 主分支版本等同于已发布版本。Windows issue 的修复状态也未核实。

以下事项**没有验证**：

- FFF 在本机 Windows 上的实际安装、索引耗时、内存占用、搜索速度和 native binding 稳定性；
- 任一 LSP server 在本机 Pi/PowerShell 中的安装、启动、诊断准确率和进程清理；
- `costgraph` 的精确 Python 环境、依赖完整性和是否适合 Pyright；
- `pi-web` 当前项目实际编辑任务中 LSP 的收益；
- 不同 LSP 实现与现有 prompt-architect 的最终工具路由表现。

因此本报告的“需要程度”是基于现状证据的决策分级，不是性能基准或兼容性承诺。
