# preview.3 Windows 修正证据

实现与参考来源：`../../doc/windows-startup-and-workspaces.md`。

- `ui-lifecycle.json`：真实 Electron + Pi Web + 本机测试供应商；默认 Full Access 标签、同目录不重建、运行中切换、原授权/撤权合同。
- `current-user-upgrade.json`：当前已安装用户升级、短命令、无控制台与数据保留。
- `../personal-startup/backend-startup.json`：真实生产 Next 入口与 Win32 控制台探针，7/7。
- `../p2-05/`：包内容和打包产物启动。

复现 UI 扩展检查（Pi Web 需要已构建，测试有独立配置、用户目录、工作区和端口）：

```powershell
$env:PI_ORB_EVIDENCE_PI_WEB = '<已构建的 Pi Web>'
node evidence/p1-07/run-lifecycle-regression.mjs --workspace-ui --output=evidence/windows-startup-and-workspaces/ui-lifecycle.json
```

结果只由对应 JSON 判定，不外推干净机器、升级向导或 SmartScreen。截图仅为本机预览，未进入源码分发。
