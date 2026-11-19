// Hilbert-curve geometry and key->vertex mapping. Pure (no three.js), so it is
// unit-testable in node. Reimplements the original project's hilbert3D.js and
// keysToMappings concepts.
//
// hilbert3D traces a 3D Hilbert curve and returns its points as [x, y, z]
// triples. Canonical three.js permutations (Dylan Grafmyre, after Thomas
// Diewald). NOTE its base case returns the 8 cube corners, so a call with
// recursion depth d yields 8^(d+1) points. Use hilbertCurve() to ask for a
// point count directly. The original returned THREE.Vector3; here points are
// plain arrays and viz.js builds the BufferGeometry.

export function hilbert3D(center, size = 10, depth = 1, v0 = 0, v1 = 1, v2 = 2, v3 = 3, v4 = 4, v5 = 5, v6 = 6, v7 = 7) {
  const half = size / 2;
  const [cx, cy, cz] = center;
  const corners = [
    [cx - half, cy + half, cz - half],
    [cx - half, cy + half, cz + half],
    [cx - half, cy - half, cz + half],
    [cx - half, cy - half, cz - half],
    [cx + half, cy - half, cz - half],
    [cx + half, cy - half, cz + half],
    [cx + half, cy + half, cz + half],
    [cx + half, cy + half, cz - half],
  ];
  const vec = [corners[v0], corners[v1], corners[v2], corners[v3], corners[v4], corners[v5], corners[v6], corners[v7]];

  if (--depth >= 0) {
    const out = [];
    out.push(...hilbert3D(vec[0], half, depth, v0, v3, v4, v7, v6, v5, v2, v1));
    out.push(...hilbert3D(vec[1], half, depth, v0, v7, v6, v1, v2, v5, v4, v3));
    out.push(...hilbert3D(vec[2], half, depth, v0, v7, v6, v1, v2, v5, v4, v3));
    out.push(...hilbert3D(vec[3], half, depth, v2, v3, v0, v1, v6, v7, v4, v5));
    out.push(...hilbert3D(vec[4], half, depth, v2, v3, v0, v1, v6, v7, v4, v5));
    out.push(...hilbert3D(vec[5], half, depth, v4, v3, v2, v5, v6, v1, v0, v7));
    out.push(...hilbert3D(vec[6], half, depth, v4, v3, v2, v5, v6, v1, v0, v7));
    out.push(...hilbert3D(vec[7], half, depth, v6, v5, v2, v1, v0, v3, v4, v7));
    return out;
  }
  return vec;
}

// Build a curve with exactly 8^levels points (depth = levels - 1).
export function hilbertCurve(size, levels) {
  return hilbert3D([0, 0, 0], size, levels - 1);
}

// Number of vertices for a given level count.
export function hilbertPointCount(levels) {
  return 8 ** levels;
}

// Map a hex string (private key, public key, or address) to a vertex index in
// [0, 8^levels). Samples `levels` hex nibbles evenly across the string, folds
// each to an octal digit (0..7), and reads them as a base-8 place value, so the
// result exactly fills the index range of a hilbertCurve(_, levels). This is the
// original keysToMappings concept with the digit count matched to the vertex
// count (the original used 8^(iterations+1) vertices with an iterations-digit
// map, which under-filled; here it fills the whole curve).
export function keyToVertexIndex(hex, levels) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const step = Math.floor(clean.length / levels) || 1;
  let index = 0;
  for (let i = 0; i < levels; i++) {
    const nibble = parseInt(clean.charAt(i * step), 16);
    const octal = (Number.isNaN(nibble) ? 0 : nibble) >> 1; // 0..15 -> 0..7
    index += octal * 8 ** (levels - 1 - i);
  }
  return index;
}
