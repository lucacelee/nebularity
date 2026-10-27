import { describe, expect, it } from "vitest";
import {
  getMoonTooltipLabel,
  parseMoonImageManifest,
  parseMoonReferences,
} from "../../src/lib/moon-rendering";

describe("parseMoonReferences", () => {
  it("parses valid moon references and trims names", () => {
    expect(parseMoonReferences(JSON.stringify([
      { id: "io", name: " Io " },
      { id: "europa", name: "Europa" },
    ]))).toEqual([
      { id: "io", name: "Io" },
      { id: "europa", name: "Europa" },
    ]);
  });

  it("returns an empty list for absent, malformed, or non-array JSON", () => {
    expect(parseMoonReferences(undefined)).toEqual([]);
    expect(parseMoonReferences("not json")).toEqual([]);
    expect(parseMoonReferences(JSON.stringify({ id: "io", name: "Io" }))).toEqual([]);
  });

  it("filters invalid shapes and unsafe IDs", () => {
    expect(parseMoonReferences(JSON.stringify([
      null,
      1,
      {},
      { id: "../io", name: "Io" },
      { id: "io/../../x", name: "Io" },
      { id: "io", name: "  " },
      { id: "europa", name: 2 },
    ]))).toEqual([]);
  });

  it("deduplicates IDs while preserving the first display name", () => {
    expect(parseMoonReferences(JSON.stringify([
      { id: "io", name: "Io" },
      { id: "io", name: "Jupiter I" },
    ]))).toEqual([{ id: "io", name: "Io" }]);
  });

  it("does not silently lowercase IDs whose case is inconsistent", () => {
    expect(parseMoonReferences(JSON.stringify([
      { id: "Io", name: "Io" },
    ]))).toEqual([]);
  });
});

describe("parseMoonImageManifest", () => {
  it("accepts local moon image paths in supported formats", () => {
    expect(parseMoonImageManifest(JSON.stringify({
      io: "/moons/io.png",
      europa: "/moons/europa.webp",
      titan: "/moons/titan.jpg",
      charon: "/moons/charon.jpeg",
      triton: "/moons/triton.avif",
      moon: "/planets/moon.png",
    }))).toEqual({
      io: "/moons/io.png",
      europa: "/moons/europa.webp",
      titan: "/moons/titan.jpg",
      charon: "/moons/charon.jpeg",
      triton: "/moons/triton.avif",
      moon: "/planets/moon.png",
    });
  });

  it("rejects remote URLs and non-local paths", () => {
    expect(parseMoonImageManifest(JSON.stringify({
      io: "https://example.com/io.png",
      europa: "data:image/png;base64,AAAA",
      titan: "planets/titan.png",
      charon: "/planets/charon.png",
      ioAlias: "/planets/moon.png",
    }))).toEqual({});
  });

  it("rejects paths containing traversal segments or arbitrary nested paths", () => {
    expect(parseMoonImageManifest(JSON.stringify({
      io: "/moons/../secret.png",
      europa: "/moons/subdir/europa.png",
      titan: "/moons/%2e%2e%2fsecret.png",
    }))).toEqual({});
  });

  it("rejects invalid IDs and unsupported image extensions", () => {
    expect(parseMoonImageManifest(JSON.stringify({
      "../io": "/moons/io.png",
      europa: "/moons/europa.gif",
      titan: "/moons/titan.svg",
      phobos: 12,
    }))).toEqual({});
  });

  it("returns an empty object for invalid input", () => {
    expect(parseMoonImageManifest(undefined)).toEqual({});
    expect(parseMoonImageManifest("not json")).toEqual({});
    expect(parseMoonImageManifest(JSON.stringify(null))).toEqual({});
    expect(parseMoonImageManifest(JSON.stringify([]))).toEqual({});
  });
});

describe("getMoonTooltipLabel", () => {
  it("trims the moon name for a stable tooltip", () => {
    expect(getMoonTooltipLabel("  Ganymede  ")).toBe("Ganymede");
  });

  it("uses a safe fallback for an empty name", () => {
    expect(getMoonTooltipLabel("   ")).toBe("Unknown moon");
  });
});
