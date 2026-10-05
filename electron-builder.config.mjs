/**
 * Windows packaging configuration for pi-orb, consumed by electron-builder.
 *
 * Reference reuse: the packaging posture comes from `deepseek-harness-orb` commit
 * `72f1d738458a223696685a909e806b683eff5885`, `apps/desktop/scripts/electron-builder-config.mjs` —
 * a JS config module rather than a yml file, `asar: true` (`:112`), the `**\/*.{node,dll,exe}`
 * unpack glob for native modules (`:71-72`), a per-user NSIS target with elevation disabled
 * (`:235`, `:245-247`), and `publish: null` so an unsigned build emits no update metadata
 * (`:253`). The invocation shape (`electron-builder --config <file> --win --x64 --publish never
 * [--dir]`) follows `apps/desktop/scripts/package-target.ts:267-283`.
 *
 * Deliberately not copied, because it is dsh-monorepo plumbing rather than pi-orb's packaging:
 * the `DSH_DESKTOP_*` environment contract with a required `appId`, the bundled Node runtime and
 * `dsh/` payload mappings, the custom NSIS page/`installer.nsh` overrides, the SafeNet
 * code-signing chain, the release-record/upload flow, and the auto-update feed. pi-orb is a
 * standalone shell that talks to the user's existing pi-web; v0.1 ships an unsigned per-user
 * installer and no updater (see `doc/p2-05-distribution.md`).
 *
 * Env overrides: `PI_ORB_APP_ID` (AUMID and uninstall registry identity).
 */
export default {
  appId: process.env.PI_ORB_APP_ID ?? "io.github.rain-knows.pi-orb",
  productName: "pi-orb",
  copyright: "Copyright (c) 2026 pi-orb contributors",
  directories: {
    buildResources: "resources",
    output: "release/${version}",
  },
  // Ship the built main/preload/renderer trees plus the manifest; electron-builder adds the
  // production dependency graph (koffi, uiohook-napi) on its own.
  //
  // The exclusions below keep a Windows x64 release to what actually runs. electron-builder's
  // "smart unpack" moves a whole package directory out of the archive as soon as one file in it
  // matches `asarUnpack`, which dragged koffi's C++ sources, its vendored node-addon-api headers
  // and its documentation, plus uiohook-napi's vendored libuiohook C sources and the prebuilt
  // binaries for macOS and Linux, into `resources/app.asar.unpacked`. The reference project trims
  // the same package with its own runtime file policy
  // (`apps/desktop/scripts/runtime-file-policy.ts:42`); these patterns are the pi-orb form of it.
  files: [
    "out/**/*",
    "!out/pi-plugin/**",
    "package.json",
    "!**/*.map",
    "!node_modules/koffi/doc/**",
    "!node_modules/koffi/src/**",
    "!node_modules/koffi/vendor/**",
    "!node_modules/koffi/lib/**",
    "!node_modules/koffi/build/koffi/*/**",
    "node_modules/koffi/build/koffi/win32_x64/**",
    // The koffi import library and export file are link-time artifacts; the reference deletes the
    // same file (`runtime-file-policy.ts:42`, "Koffi import library") before it ships.
    "!node_modules/koffi/build/koffi/win32_x64/koffi.lib",
    "!node_modules/koffi/build/koffi/win32_x64/koffi.exp",
    "!node_modules/uiohook-napi/src/**",
    "!node_modules/uiohook-napi/libuiohook/**",
    "!node_modules/uiohook-napi/prebuilds/*/**",
    "node_modules/uiohook-napi/prebuilds/win32-x64/**",
  ],
  asar: true,
  // Do not rebuild the native modules. `koffi` and `uiohook-napi` both ship prebuilt
  // win32-x64 Node-API binaries, which is what every P1 evidence run on this machine executed;
  // `@electron/rebuild` would replace them with a from-source build that needs MSVC and would no
  // longer be the artifact the evidence describes. Turning this off is what makes packaging
  // reproducible on a machine without Visual Studio.
  npmRebuild: false,
  // Native addons and helper binaries must sit outside the archive: a .node loaded from inside
  // asar is not a loadable image on Windows. Same glob as the reference config.
  asarUnpack: ["**/*.{node,dll,exe}"],
  // The packaged app carries its own license obligations with it, not only in the repository.
  extraResources: [
    { from: "out/pi-plugin", to: "pi-plugin" },
    { from: "LICENSE", to: "LICENSE" },
    { from: "THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" },
    { from: "CHANGELOG.md", to: "CHANGELOG.md" },
  ],
  win: {
    icon: "resources/icon.ico",
    target: ["nsis"],
  },
  nsis: {
    include: "resources/installer.nsh",
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "pi-orb",
    artifactName: "${productName}-${version}-win-${arch}.${ext}",
  },
  // No update feed in v0.1. With no publish provider electron-builder emits no app-update.yml,
  // and the reference project's own updater gate keys off that file's absence.
  publish: null,
};
