import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ObservationFramePreference } from "../src/main/observation-frame-preference";

it("defaults on and persists the ribbon toggle across restarts", () => {
  const root = mkdtempSync(join(tmpdir(), "orb-frame-pref-"));
  try {
    const path = join(root, "frame.json");
    const preference = new ObservationFramePreference(path);
    expect(preference.enabled).toBe(true);
    preference.setEnabled(false);
    expect(new ObservationFramePreference(path).enabled).toBe(false);
    preference.setEnabled(true);
    expect(new ObservationFramePreference(path).enabled).toBe(true);
    writeFileSync(path, '{"enabled":"false"}');
    expect(() => new ObservationFramePreference(path)).toThrow("Invalid observation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
