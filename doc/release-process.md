# 发布

适用于当前 Windows 未签名预览版的发布者。

版本和文件名以 manifest 为准；更新 CHANGELOG，支持结论只维护 [支持矩阵](support-matrix.md)。遵守 [验证策略](verification.md)，对同一次最终安装器构建完成审计、插件加载和实际启动，失败阻断发布。

检查实际生产依赖许可证和凭据泄漏；复用源码保留版权、源提交和未复用原因。只提交支持结论变化、发布或关键故障的精选记录；附最终安装器 SHA256 及本次验证报告，不引用旧报告证明新构建通过。

发布为 prerelease，明确未签名和支持限制。手动 workflow 要求 unsigned 确认；标签触发以标签作为发布请求。不得重复创建已有 release。实际流程见 [release-preview](../.github/workflows/release-preview.yml)。本次重构不自动发布。

来源：旧单体 `.github/workflows/{ci,release}.yml` 的 checkout、权限、并发和产物习惯；不搬自托管 runner、monorepo 扇出和组织审批机制。安装器发布链的 Pi 差异见 [打包](packaging.md)。
