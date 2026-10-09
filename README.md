# pi-orb

基于 [pi-web](https://github.com/agegr/pi-web) 的 Electron 悬浮助手，通过 Pi 插件接入聊天、历史、截图、桌面操作与后台任务。产品行为优先复用参考 Orb，普通 Pi Web 会话保持原有行为。

版本以 [package.json](package.json) 为准；Windows x64 未签名预览版，已验证范围和限制只见 [支持矩阵](doc/support-matrix.md)。[下载已发布预览版](https://github.com/rain-knows/pi-orb/releases)；本地源码可能包含尚未发布的安装改进。

## 安装与启动

安装包需要已有 Node、Pi CLI 与可运行的 Pi Web。每用户安装后从开始菜单或 Win+R 输入 pi-orb 启动；首次通过 Pi CLI 注册随包插件，复用已有服务或启动自有 Pi Web 后端。详细前置条件与数据保护见 [个人安装与启动](doc/personal-user-installation.md)。本机短命令 piorb 的安装位置与维护见 [本机启动器](doc/winr-piorb.md)。

新 Orb 会话及明确重新打开隐藏窗口默认 Full Access，可产生真实输入。开始任务前检查 Access；Stop、隐藏、断连、锁屏与切换撤销旧授权，见 [权限生命周期](doc/access-lifecycle.md) 和 [SECURITY](SECURITY.md)。

## 从源码运行

```powershell
npm ci
pi install "$PWD\pi-package"
# 通过原有入口启动已构建的 Pi Web
npm run dev
```

开发模式不自动安装插件或启动 Pi Web。连接变量 PI_ORB_PI_WEB_URL、PI_ORB_PI_WEB_PASSWORD、PI_ORB_CONFIG 的定义和默认值见 [配置代码](src/shared/orb-config.ts) 与 [主进程](src/main/index.ts)。凭据仅由主进程使用。

## 开发入口

[文档主题导航](doc/README.md) · [验证策略](doc/verification.md) · [打包](doc/packaging.md) · [发布](doc/release-process.md) · [精选证据](evidence/README.md)

贡献前阅读 [参考取材入口](doc/reference-playbook.md)、[开发约束](AGENTS.md) 与 [贡献指南](CONTRIBUTING.zh.md)。旧阶段资料从 Git 历史追溯。项目采用 [MIT](LICENSE)，复用代码与依赖声明见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
