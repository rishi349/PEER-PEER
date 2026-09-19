import { describe, expect, it } from "vitest";
import { haversineDistanceMeters, initialBearingDegrees } from "./location.geo";

describe("haversineDistanceMeters", () => {
  it("returns 0 for identical coordinates", () => {
    const point = { latitude: 12.9716, longitude: 77.5946 };
    expect(haversineDistanceMeters(point, point)).toBeCloseTo(0, 6);
  });

  it("matches the well-known ~111.2km-per-degree-of-latitude approximation", () => {
    const from = { latitude: 0, longitude: 0 };
    const to = { latitude: 1, longitude: 0 };
    expect(haversineDistanceMeters(from, to)).toBeCloseTo(111_194.9, 0);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { latitude: 12.9716, longitude: 77.5946 };
    const b = { latitude: 13.0827, longitude: 80.2707 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

describe("initialBearingDegrees", () => {
  it("is 0 (true north) for a point directly north", () => {
    const from = { latitude: 0, longitude: 0 };
    const to = { latitude: 1, longitude: 0 };
    expect(initialBearingDegrees(from, to)).toBeCloseTo(0, 4);
  });

  it("is 90 (east) for a point directly east on the equator", () => {
    const from = { latitude: 0, longitude: 0 };
    const to = { latitude: 0, longitude: 1 };
    expect(initialBearingDegrees(from, to)).toBeCloseTo(90, 4);
  });

  it("is 180 (south) for a point directly south", () => {
    const from = { latitude: 1, longitude: 0 };
    const to = { latitude: 0, longitude: 0 };
    expect(initialBearingDegrees(from, to)).toBeCloseTo(180, 4);
  });

  it("is 270 (west) for a point directly west on the equator", () => {
    const from = { latitude: 0, longitude: 1 };
    const to = { latitude: 0, longitude: 0 };
    expect(initialBearingDegrees(from, to)).toBeCloseTo(270, 4);
  });

  it("always returns a value in [0, 360)", () => {
    const from = { latitude: 12.9716, longitude: 77.5946 };
    const to = { latitude: 13.0827, longitude: 80.2707 };
    const bearing = initialBearingDegrees(from, to);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});
