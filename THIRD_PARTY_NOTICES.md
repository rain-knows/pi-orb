# pi-orb third-party notices

This file records the third-party components redistributed with a pi-orb Windows x64 release, and
the license obligations that follow. It is generated and checked against
[`evidence/p1-07/license-inventory.json`](./evidence/p1-07/license-inventory.json), which is
reproducible with `node evidence/p1-07/collect-licenses.mjs`.

- Inventory captured for: pi-orb `0.1.0` (unreleased), Windows x64
- Desktop backend: Windows source imported from `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885` (MIT)
- Windows native FFI: `koffi@2.14.1` (MIT)
- Keyboard edge detection: `uiohook-napi@1.5.5` (MIT)

## 1. pi-orb itself

pi-orb is MIT licensed (see [`LICENSE`](./LICENSE)). Its own source is the only first-party code in
a release.

## 2. Redistributed components by license

| Component | Version | License | Ships a license file | Obligation |
|---|---|---|---|---|
| `scheduler` | 0.28.0 | MIT | yes (`LICENSE`) | include copyright and permission notice |
| `uiohook-napi` | 1.5.5 | MIT | yes (`LICENSE`) | include copyright and permission notice |
| `koffi` | 2.14.1 | MIT | yes (`LICENSE`) | include copyright and permission notice |
| `node-gyp-build` | 4.8.4 | MIT | yes (`LICENSE`) | include copyright and permission notice |

No AGPL, GPL-3 or SSPL component is present in the production graph; the inventory fails the release
gate if one appears.

Declared optional packages for other operating systems and architectures (`darwin-*`, `linux-*`,
`win32-arm64-msvc`) are **not installed** on this platform and therefore do not ship. They are listed
under `notInstalledOnThisPlatform` in the inventory rather than being silently omitted.

## 3. Historical Cua evidence

The repository contains historical Cua probe records under `evidence/p0-04` and `evidence/p1-05`.
Those packages are no longer production dependencies and are not redistributed by current pi-orb.
The following records are retained only to explain the earlier P1 investigation and the decision to
replace that path with the imported MIT backend.

## 3.1 Historical MPL-2.0 analysis

MPL-2.0 is file-level weak copyleft. Redistributing these artifacts unmodified requires carrying the
notice and telling recipients how to obtain the corresponding source. It does not make the rest of
pi-orb MPL, and it does not require publishing pi-orb's own source.

### 3.1 Which files carry MPL-2.0

| File | Package | Bytes | Basis |
|---|---|---|---|
| `cua_driver_node_runtime.node` | `@trycua/cua-driver-win32-x64-msvc` | 633 168 | named explicitly by the upstream `node-runtime-NOTICE.md` as a compatibility build derived from `uniffi-bindgen-react-native` 0.31.0-3 |
| `uniffi-runtime-napi.win32-x64-msvc.node` | `@ubjs/node-win32-x64-msvc` | 537 088 | the `@ubjs/*` packages declare `license: "MPL-2.0"` and point at `github.com/jhugman/uniffi-bindgen-react-native`, which is the same project the upstream notice names |

The two files are **not** identical (different sizes and SHA-256 hashes); the Cua file is a derived
build, which is what the upstream notice says it is.

### 3.2 `cua_driver_sdk.dll` is not attributed to MPL-2.0 by the shipped evidence

The upstream `node-runtime-NOTICE.md` names only the `.node` runtime, while the package license field
is `MIT AND MPL-2.0`. That left open whether the 26.8 MB `cua_driver_sdk.dll` also carries an MPL
obligation. Inspecting the shipped artifact:

| Check | Result |
|---|---|
| ASCII license text (`MIT License`, `Mozilla Public`, `Permission is hereby granted`) | 0 occurrences |
| UTF-16 license text | 0 occurrences |
| The single `license` string in the file | a Rust symbol-metadata key name, not a license grant |
| References to `uniffi-bindgen-react-native`, `uniffi_bindgen`, or `cua_driver_node_runtime` | 0 occurrences |
| Imported libraries | only operating-system libraries (`kernel32`, `user32`, `gdi32`, `ole32`, `oleacc`, `d3d11`, `bcrypt`, `dwmapi`, `dbghelp`, …) |

A first-grep result of "894 MPL occurrences" was **discarded as a false positive**: matching ASCII on a
binary produced x86 opcode coincidences, and every match was noise rather than a string. The table
above uses UTF-16 decoding plus context inspection of the one real hit.

**Conclusion:** nothing in the shipped artifact attributes MPL-2.0 to `cua_driver_sdk.dll`, and no
shipped file links it to the MPL-licensed runtime. It is therefore treated as part of the MIT-licensed
Cua driver and is **not** listed as an MPL component. This is an inference from the shipped bytes and
the declared package license, not a legal opinion: the DLL's source repository was not inspected, and
no claim is made about upstream source files that are not part of this package. If upstream later
states that the DLL is MPL-derived, this file must be updated and the DLL added to §3.1.

### 3.3 How to obtain the corresponding source

- Cua driver (MIT, and the derived `.node` runtime): <https://github.com/trycua/cua> at the release
  tag matching `0.30.1`. The upstream notice states the derived runtime's source is the pinned npm
  development dependency plus the deterministic transformations in `scripts/build-node-runtime.mjs`.
- `@ubjs/*` (MPL-2.0): <https://github.com/jhugman/uniffi-bindgen-react-native> at
  `0.31.0-3`, path `runtimes/napi`.
- `uiohook-napi` (MIT): <https://github.com/SnosMe/uiohook-napi> at the npm `1.5.5` source tree.

The MPL-2.0 text is at <https://www.mozilla.org/MPL/2.0/>.

### 3.4 The packages that declare MPL-2.0 ship no license text

`@ubjs/core`, `@ubjs/node` and `@ubjs/node-win32-x64-msvc` each declare `license: "MPL-2.0"` in
`package.json` and each ship **no** `LICENSE`/`COPYING`/`NOTICE` file. Their license text is therefore
supplied by this notice rather than by the package, which is why the link above is included here
instead of relying on the dependency tree.

## 3.5 Design derived from `deepseek-harness-orb` (MIT)

The model-facing position convention (a position is a fraction `0-1000` of the screenshot the model
is looking at, mapped by the host onto the observed window's rect) is derived from the reference
implementation [`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb),
which is MIT licensed:

> MIT License — Copyright (c) 2026 DeepSeek

The following source files are imported from that fixed commit under
`src/main/reference-windows/`:

- `windows.ts` (one deliberate divergence: input paths release held keys and buttons in a `finally` block)
- `windows-native.ts` (adapted to `koffi@2`; the reference declares `koffi@^3`)
- `windows-foreground.ts`
- `coordinates.ts` (trimmed to `mapNormalizedToGlobal`; the reference's unused validators are not carried)
- `capture-exclude.ts`
- `observation-limits.ts`
- `wait.ts`
- `backend.ts` (the local host-neutral contract replacing private DSH/Cordis types)

The same commit's Electron shell is reused outside that directory:

- `src/main/floating-geometry.ts` ← `apps/desktop/src/floating-window.ts` (geometry constants)
- `src/main/floating-window-controller.ts` ← `apps/desktop/src/floating-window.ts` (window state machine)
- `src/main/floating-overlay-guard.ts` ← `apps/desktop/src/floating-window.ts:848-868,906-961`
  (reference-counted capture protection and input click-through; called directly by the Pi host)
- `tests/floating-overlay-guard.test.ts` ← `apps/desktop/tests/floating-window.spec.ts`
  (five overlay interval tests; DSH media-source and macOS-only tests omitted)
- `src/renderer/index.html` ← `apps/desktop/renderer/floating.html` (panel, controls, transcript,
  question, history, selection chip, composer, ball and dock DOM; the macOS TCC gate is omitted)
- `src/renderer/floating.css` ← `apps/desktop/renderer/floating.css` (layout, tokens, themes,
  animation and responsive states; DSH iframe and TCC-only selectors are omitted)
- `src/renderer/floating.js` ← `apps/desktop/renderer/floating.js` (composer, hover, pin, drag,
  dock and popover state machine; the DSH RPC/event/iframe boundary is replaced by the existing
  restricted Pi preload bridge)
- `src/renderer/deepseek-avatar-square.gif` ← `apps/desktop/renderer/deepseek-avatar-square.gif`
  (animated orb state asset; copied from the pinned MIT source and used with its original name)
- `src/renderer/orb-surface.css` is pi-orb adaptation styling for its workspace, desktop approval
  and screenshot review surfaces; it is not a reference source copy
- `src/main/selection-monitor.ts`, `src/main/windows-selection*.ts` ← `apps/desktop/src/selection-*.ts`,
  `windows-selection*.ts` (selection reading; the reference's native toolbar is not ported)

They retain the reference implementation's window selection, physical coordinate mapping, GDI
capture, per-monitor DPI handling, Win32 `SendInput`, clipboard restoration and input cleanup. The
model-facing `orb_*` schemas, Pi session, authorization, bridge and screenshot confirmation flow
remain pi-orb code. No reference plugin lifecycle, attachment store, configuration store, bundled
`dsh` runtime, installer pages, or macOS/multi-display runtime was imported. This entry records both
the source commit and the local adaptation boundary.

## 4. Components deliberately not included

| Component | Reason |
|---|---|
| `cua-agent[omni]` | pulls in `ultralytics`, which is AGPL-3.0 |
| ClawHub skill copies | MIT-0; a separate distribution, not part of this package |
| Kasm (MIT), OmniParser (CC-BY-4.0) | not redistributed by pi-orb |
| Any `darwin-*` / `linux-*` / `win32-arm64` platform package | not installed on Windows x64, so not shipped |

## 5. Trademarks

pi-orb is an independent open-source project. It is not affiliated with, endorsed by, or an official
product of the pi-web, Pi, Cua or DeepSeek projects. The MIT licenses of those projects do not grant
trademark rights.

## 6. What this file does not claim

- It is not legal advice and not a license compatibility opinion.
- It records what is installed and what the shipped artifacts contain. It does not audit the source
  repositories of the dependencies.
- A component that declares a license in `package.json` but ships no license text is recorded as
  such rather than assumed to be either MIT or MPL beyond its own declaration.

工具提速的批量提示与动作后截图语义参考并适配自 `packages/experimental/tool-computer-use/src/policy.ts:20-30` 与 `plugin.ts:330-360`，固定提交 `72f1d738458a223696685a909e806b683eff5885`，Copyright (c) 2026 DeepSeek，MIT。Pi 批量桥接为运行时边界适配，不搬 dsh 调度器。

`orb-image-context.ts` 的请求图片预算模式参考 `packages/attachment/attachment-local/src/request-image.ts`（同固定提交、MIT）；使用 Pi 公开钩子适配，未复制 dsh 附件实现。
