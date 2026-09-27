import { describe, expect, it } from "vitest";
import {
  createDefaultOrbConfig,
  isOrbWorkspace,
  normalizeDirPath,
  ORB_CONFIG_ENV,
  ORB_CONFIG_VERSION,
  parseOrbConfig,
  resolveOrbConfigPath,
  serializeOrbConfig,
  type OrbConfig,
} from "@shared/orb-config";

describe("normalizeDirPath", () => {
  it("normalizes separators, duplicate separators and trailing separators", () => {
    expect(normalizeDirPath("C:/work/orb", "win32")).toBe("c:\\work\\orb");
    expect(normalizeDirPath("C:\\work\\\\orb\\\\", "win32")).toBe("c:\\work\\orb");
    expect(normalizeDirPath("/home/u/orb/", "linux")).toBe("/home/u/orb");
  });

  it("is case-insensitive on win32 and case-sensitive elsewhere", () => {
    expect(normalizeDirPath("C:\\Work\\Orb", "win32")).toBe("c:\\work\\orb");
    expect(normalizeDirPath("/Work/Orb", "linux")).toBe("/Work/Orb");
  });

  it("keeps drive roots and filesystem roots intact", () => {
    expect(normalizeDirPath("C:\\", "win32")).toBe("c:\\");
    expect(normalizeDirPath("/", "linux")).toBe("/");
  });

  it("keeps the UNC prefix of a network path", () => {
    expect(normalizeDirPath("\\\\server\\share\\orb", "win32")).toBe(
      "\\\\server\\share\\orb",
    );
  });

  it("rejects relative paths and empty input instead of guessing a base", () => {
    expect(normalizeDirPath("work/orb", "win32")).toBeNull();
    expect(normalizeDirPath("", "win32")).toBeNull();
    expect(normalizeDirPath("   ", "linux")).toBeNull();
  });
});

describe("isOrbWorkspace", () => {
  const workspace = "C:\\work\\orb-workspace";

  it("matches the exact directory regardless of separator or case", () => {
    expect(isOrbWorkspace("C:/work/orb-workspace", workspace, "win32")).toBe(true);
    expect(isOrbWorkspace("c:\\WORK\\Orb-Workspace", workspace, "win32")).toBe(true);
  });

  it("does not match a subdirectory", () => {
    expect(isOrbWorkspace("C:\\work\\orb-workspace\\sub", workspace, "win32")).toBe(
      false,
    );
  });

  it("does not match a prefix-similar sibling directory", () => {
    expect(isOrbWorkspace("C:\\work\\orb-workspace-2", workspace, "win32")).toBe(false);
    expect(isOrbWorkspace("C:\\work\\orb", workspace, "win32")).toBe(false);
  });

  it("matches nothing when the workspace is unset", () => {
    expect(isOrbWorkspace("C:\\work\\orb-workspace", null, "win32")).toBe(false);
    expect(isOrbWorkspace("C:\\work\\orb-workspace", undefined, "win32")).toBe(false);
    expect(isOrbWorkspace(undefined, workspace, "win32")).toBe(false);
  });
});

describe("parseOrbConfig", () => {
  const valid = createDefaultOrbConfig();

  it("round-trips a default config through serialize/parse", () => {
    expect(parseOrbConfig(JSON.parse(serializeOrbConfig(valid)))).toEqual(valid);
  });

  it("rejects a config with an unknown schema version", () => {
    expect(parseOrbConfig({ ...valid, version: ORB_CONFIG_VERSION + 1 })).toBeNull();
    expect(parseOrbConfig({ ...valid, version: "1" })).toBeNull();
  });

  it("rejects malformed top-level and nested values", () => {
    expect(parseOrbConfig(null)).toBeNull();
    expect(parseOrbConfig("nope")).toBeNull();
    expect(parseOrbConfig({})).toBeNull();
    expect(parseOrbConfig({ ...valid, shortcut: "" })).toBeNull();
    expect(parseOrbConfig({ ...valid, orbWorkspace: 42 })).toBeNull();
    expect(parseOrbConfig({ ...valid, window: null })).toBeNull();
    expect(parseOrbConfig({ ...valid, window: { ...valid.window, width: 0 } })).toBeNull();
    expect(parseOrbConfig({ ...valid, window: { ...valid.window, x: "0" } })).toBeNull();
  });

  it("rejects a relative workspace path", () => {
    expect(parseOrbConfig({ ...valid, orbWorkspace: "relative/dir" })).toBeNull();
  });

  it("accepts a config with an unset workspace and explicit window origin", () => {
    const configured: OrbConfig = {
      ...valid,
      orbWorkspace: "C:\\work\\orb",
      window: { ...valid.window, x: 10, y: 20 },
    };
    expect(parseOrbConfig(JSON.parse(serializeOrbConfig(configured)))).toEqual(configured);
  });
});

describe("resolveOrbConfigPath", () => {
  // The Electron shell writes this file and the Pi extension reads it. If the two
  // sides resolved it differently, Orb mode would silently never activate. These
  // tests pin one shared resolution.

  it("honours the explicit override for both sides", () => {
    expect(
      resolveOrbConfigPath({ [ORB_CONFIG_ENV]: "D:\\custom\\orb.json" }, {
        userDataDir: "C:\\ignored",
      }),
    ).toBe("D:\\custom\\orb.json");
    expect(resolveOrbConfigPath({ [ORB_CONFIG_ENV]: "D:\\custom\\orb.json" })).toBe(
      "D:\\custom\\orb.json",
    );
  });

  it("ignores a blank override instead of producing an unusable path", () => {
    expect(
      resolveOrbConfigPath(
        { [ORB_CONFIG_ENV]: "   " },
        { userDataDir: "C:\\data", platform: "win32" },
      ),
    ).toBe("C:\\data\\orb-config.json");
  });

  it("uses the Electron userData directory when the shell supplies it", () => {
    expect(resolveOrbConfigPath({}, { userDataDir: "C:\\Users\\u\\AppData\\Roaming\\pi-orb", platform: "win32" })).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\pi-orb\\orb-config.json",
    );
  });

  it("derives the same Windows location without Electron, so the extension agrees", () => {
    expect(
      resolveOrbConfigPath(
        { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
        { platform: "win32" },
      ),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\pi-orb\\orb-config.json");
  });

  it("falls back to USERPROFILE when APPDATA is absent", () => {
    expect(
      resolveOrbConfigPath(
        { USERPROFILE: "C:\\Users\\u" },
        { platform: "win32" },
      ),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\pi-orb\\orb-config.json");
  });

  it("derives the documented non-Windows location", () => {
    expect(
      resolveOrbConfigPath({ XDG_CONFIG_HOME: "/home/u/.config" }, { platform: "linux" }),
    ).toBe("/home/u/.config/pi-orb/orb-config.json");
    expect(resolveOrbConfigPath({}, { platform: "linux", homeDir: "/home/u" })).toBe(
      "/home/u/.config/pi-orb/orb-config.json",
    );
  });
});
