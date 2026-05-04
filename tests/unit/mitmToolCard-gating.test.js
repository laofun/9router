import { describe, expect, it } from "vitest";
import { getMitmDnsGateState } from "../../src/app/(dashboard)/dashboard/cli-tools/components/mitmDnsGateState.js";

describe("getMitmDnsGateState", () => {
  it("uses server-reported Windows status instead of browser user agent", () => {
    expect(
      getMitmDnsGateState({
        hasCachedPassword: false,
        status: { isWindows: true, isAdmin: false },
      })
    ).toEqual({
      isWindows: true,
      isAdmin: false,
      needsSudoPassword: false,
      dnsToggleBlocked: true,
    });
  });

  it("requires sudo password on non-Windows when no cached password exists", () => {
    expect(
      getMitmDnsGateState({
        hasCachedPassword: false,
        status: { isWindows: false, isAdmin: true },
      })
    ).toEqual({
      isWindows: false,
      isAdmin: true,
      needsSudoPassword: true,
      dnsToggleBlocked: false,
    });
  });

  it("skips password prompt on non-Windows when password is already cached", () => {
    expect(
      getMitmDnsGateState({
        hasCachedPassword: true,
        status: { isWindows: false, isAdmin: true },
      })
    ).toEqual({
      isWindows: false,
      isAdmin: true,
      needsSudoPassword: false,
      dnsToggleBlocked: false,
    });
  });
});
