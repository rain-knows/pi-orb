# 截图分享

适用于用户主动附加截图，不替代 GUI 观察。

捕获当前非 Orb 目标，预览并确认后才发送；取消或代次改变丢弃 pending capture。支持图像的模型才接收图片；选区上下文与截图按相应请求组合。双 Alt 触发截图流程；真实键盘覆盖见支持矩阵。

像素默认留在内存；保存或复制仅由明确用户操作触发。renderer 不获得任意路径读写或原生 API。预览授权与桌面工具授权分别管理。

来源：旧单体 `apps/desktop/src/desktop-screenshot.ts`、`floating-window.ts` 与 renderer 截图流程；Pi 使用 preload/会话代次替换 dsh 事件协议。双 Alt 适配不声称为原参考代码移植，来源注释见 [double-alt](../src/main/double-alt.ts)。

实现：[capture](../src/main/desktop-capture.ts)、[flow](../src/main/screenshot-flow.ts)、[export](../src/main/screenshot-export.ts)。回归：[截图流程](../tests/screenshot-flow.test.ts)、[导出](../tests/screenshot-export.test.ts)、[手势](../tests/double-alt.test.ts)。支持见 [支持范围](support-matrix.md)。
