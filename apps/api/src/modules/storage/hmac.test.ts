import { describe, expect, it } from "vitest";
import { signStorageUrl, verifyStorageSignature } from "./hmac.js";

const SECRET = "a".repeat(32);

describe("storage HMAC signing", () => {
  it("accepts a signature it just issued", () => {
    const { exp, sig } = signStorageUrl("school1/file.png", 60, SECRET);
    expect(verifyStorageSignature("school1/file.png", exp, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered storage key", () => {
    const { exp, sig } = signStorageUrl("school1/file.png", 60, SECRET);
    expect(verifyStorageSignature("school1/other.png", exp, sig, SECRET)).toBe(false);
  });

  it("rejects an expired signature", () => {
    const { sig } = signStorageUrl("school1/file.png", -1, SECRET);
    const pastExp = Math.floor(Date.now() / 1000) - 1;
    expect(verifyStorageSignature("school1/file.png", pastExp, sig, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const { exp, sig } = signStorageUrl("school1/file.png", 60, SECRET);
    expect(verifyStorageSignature("school1/file.png", exp, sig, "b".repeat(32))).toBe(false);
  });
});
