# Pi Web 0.10 / Pi 1.0 验证

详细改动与边界见 [阶段记录](../../doc/pi-web-0.10-compatibility.md)。

| 文件 | 证据 |
|---|---|
| `environment.json` | SDK/CLI/Web 版本、配置完整性、聚焦与全量测试边界 |
| `prompt-audit.json` | 实际 Pi SDK + 本机 Prompt Architect + Orb，捕获 provider-facing system transcript，29/29 |
| `prompt-audit-old-rejected.json` | 备份旧 composer 在同一真实运行时下失败，证明审计能捕获覆盖问题 |
| `policy-measurement.json` | 四段估算尺寸与 21 项 capability/dedupe 自检 |
| `prompt-architect.patch` | 本机全局提示词扩展的可审查差异；不作为 Orb 运行时加载文件 |
| `mcp-conversion.json` | 5 个配置的 native validator 通过；仅记录名称与已移除字段 |
| `live-plugins.json` | 当前包版本、disabled 状态、无装配诊断、五个真实 MCP 工具列表 |
| `native-mcp-real-model.json` | 普通生产 Pi Web + 全局插件 + 真实模型 + Code mode + Anysearch 实际搜索，5/5 |
| `config-routes.json` | 隔离配置下实际生产保存接口 3/3；包含 MCP 连续 20 次替换落盘 |
| `cli-runtime.json` | 实际全局 Pi 1.0.1 带全局插件完成真实模型调用，3/3 |
| `session-access-regression.json` | 最新 Pi Web + Electron + 本地模型夹具，授权与队列/Stop/断连 21/21 |
| `real-model-desktop.json` | 新全局 Prompt Architect + 最新 Pi Web + 真实模型 + broker/native + disposable target，7/7 |
| `package-audit.json` / `packaged-smoke.json` / `stage-result.json` | 本轮完整 P2-05 runner 的产物内容 27/27、实际启动 22/22 |

重跑时明确指定实际 Pi Web 生产构建与全局 Prompt Architect 路径：

```powershell
$env:PI_ORB_EVIDENCE_PI_WEB = 'C:\Users\JUSTLIKEZYP\OneDrive\文档\daily\pi-web'
$env:PI_ORB_EVIDENCE_PROMPT_ARCHITECT = 'C:\Users\JUSTLIKEZYP\.pi\agent\extensions\prompt-architect\index.ts'
node evidence/upgrade-0.10/run-prompt-audit.mjs
node evidence/upgrade-0.10/check-live-plugins.mjs
node evidence/upgrade-0.10/run-native-mcp-model.mjs
node evidence/upgrade-0.10/run-config-routes.mjs
node evidence/upgrade-0.10/run-cli.mjs
node evidence/p1-07/run-lifecycle-regression.mjs --output=evidence/upgrade-0.10/session-access-regression.json
node evidence/tool-speed/run-real-model.mjs --output=evidence/upgrade-0.10/real-model-desktop.json
node evidence/p2-05/run-p2-05.mjs
```

`convert-mcp.mjs <mcp.json>` 为此次已执行的一次性配置转换，先备份再校验写入；
不属于产品运行路径。`PI_PROMPT_ARCHITECT` 可替换 provider 审计装入的文件，用于失败反证。
真实模型任务使用配置中的模型/凭据但不复制其内容到仓库报告；会调用服务并产生常规模型用量。
桌面探针仅操作其创建的 disposable target。历史 P2-05 报告保留；本轮副本集中在此。
完整提示词、用户会话和密钥不作为公开证据。
