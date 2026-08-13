import { describe, expect, it } from "vitest";
import {
  assertSafeNetworkUrl,
  isSafePublicAddress,
} from "../../src/media-providers/safe-network.js";

describe("safe media networking", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.1.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001::80f2:f0d4",
  ])("rejects non-public address %s", (address) => {
    expect(isSafePublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => {
      expect(isSafePublicAddress(address)).toBe(true);
    },
  );

  it("rejects an unsafe literal before network access", () => {
    expect(() => assertSafeNetworkUrl("https://[::ffff:127.0.0.1]/asset")).toThrow(
      "Unsafe media request host",
    );
  });
});
