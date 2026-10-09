# 进程边界

适用于 Electron、Pi 扩展与 Pi Web 的接入。

主进程持有凭据、命名管道认证、原生输入和窗口；沙箱 renderer 仅通过受限 preload IPC 调用功能，不获得 Node、密码或原生模块。观察框为独立无脚本窗口，不暴露聊天桥。

Pi 扩展经认证 Windows named pipe 调用 Electron；Pi Web 公开 HTTP/SSE API 管理会话。session、generation 和观察新鲜度由适配层校验，不作为模型工具参数。运行时依赖与构建版本以 [manifest](../package.json)、[锁文件](../package-lock.json) 和 [插件 manifest](../pi-package/package.json) 为准。

来源：旧单体的 `apps/desktop/src/floating-window.ts` 与 `packages/experimental/tool-computer-use/`；当前插件的 `packages/computer-use/src/plugin.ts`。不复用 Cordis realm、dsh 引擎或其配置体系，因为宿主是 Pi。

实现：[IPC](../src/shared/ipc.ts)、[preload](../src/preload/index.ts)、[bridge](../src/main/bridge-server.ts)、[Pi Web 客户端](../src/main/pi-web-client.ts)。来源身份见 [取材入口](reference-playbook.md)。
