# pi-Orb third-party notices

This file records the third-party components redistributed with a pi-Orb Windows x64 release, and
the license obligations that follow. It is generated and checked against
[`evidence/p1-07/license-inventory.json`](./evidence/p1-07/license-inventory.json), which is
reproducible with `node evidence/p1-07/collect-licenses.mjs`.

- Inventory captured for: pi-Orb `0.1.0` (unreleased), Windows x64
- Desktop driver: `@trycua/cua-driver@0.30.1` with `@trycua/cua-driver-win32-x64-msvc@0.30.1`

## 1. pi-Orb itself

pi-Orb is MIT licensed (see [`LICENSE`](./LICENSE)). Its own source is the only first-party code in
a release.

## 2. Redistributed components by license

| Component | Version | License | Ships a license file | Obligation |
|---|---|---|---|---|
| `@trycua/cua-driver` | 0.30.1 | MIT | no | include copyright and permission notice |
| `@trycua/cua-driver-win32-x64-msvc` | 0.30.1 | **MIT AND MPL-2.0** | no (ships `node-runtime-NOTICE.md`) | include both notices; MPL file-level obligations for the derived runtime |
| `@ubjs/core` | 0.31.0-3 | **MPL-2.0** | no | include notice; state how to obtain the corresponding source |
| `@ubjs/node` | 0.31.0-3 | **MPL-2.0** | no | include notice; state how to obtain the corresponding source |
| `@ubjs/node-win32-x64-msvc` | 0.31.0-3 | **MPL-2.0** | no | include notice; state how to obtain the corresponding source |
| `react` | 19.3.0 | MIT | yes (`LICENSE`) | include copyright and permission notice |
| `react-dom` | 19.3.0 | MIT | yes (`LICENSE`) | include copyright and permission notice |
| `scheduler` | 0.28.0 | MIT | yes (`LICENSE`) | include copyright and permission notice |

No AGPL, GPL-3 or SSPL component is present in the production graph; the inventory fails the release
gate if one appears.

Declared optional packages for other operating systems and architectures (`darwin-*`, `linux-*`,
`win32-arm64-msvc`) are **not installed** on this platform and therefore do not ship. They are listed
under `notInstalledOnThisPlatform` in the inventory rather than being silently omitted.

## 3. The MPL-2.0 question, answered with evidence

MPL-2.0 is file-level weak copyleft. Redistributing these artifacts unmodified requires carrying the
notice and telling recipients how to obtain the corresponding source. It does not make the rest of
pi-Orb MPL, and it does not require publishing pi-Orb's own source.

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

The MPL-2.0 text is at <https://www.mozilla.org/MPL/2.0/>.

### 3.4 The packages that declare MPL-2.0 ship no license text

`@ubjs/core`, `@ubjs/node` and `@ubjs/node-win32-x64-msvc` each declare `license: "MPL-2.0"` in
`package.json` and each ship **no** `LICENSE`/`COPYING`/`NOTICE` file. Their license text is therefore
supplied by this notice rather than by the package, which is why the link above is included here
instead of relying on the dependency tree.

## 4. Components deliberately not included

| Component | Reason |
|---|---|
| `cua-agent[omni]` | pulls in `ultralytics`, which is AGPL-3.0 |
| ClawHub skill copies | MIT-0; a separate distribution, not part of this package |
| Kasm (MIT), OmniParser (CC-BY-4.0) | not redistributed by pi-Orb |
| Any `darwin-*` / `linux-*` / `win32-arm64` platform package | not installed on Windows x64, so not shipped |

## 5. Trademarks

pi-Orb is an independent open-source project. It is not affiliated with, endorsed by, or an official
product of the pi-web, Pi, Cua or DeepSeek projects. The MIT licenses of those projects do not grant
trademark rights.

## 6. What this file does not claim

- It is not legal advice and not a license compatibility opinion.
- It records what is installed and what the shipped artifacts contain. It does not audit the source
  repositories of the dependencies.
- A component that declares a license in `package.json` but ships no license text is recorded as
  such rather than assumed to be either MIT or MPL beyond its own declaration.
