// Selectable palettes for the "needle in the void" visual. Each theme sets the
// void (background + fog + the vast dim lattice), the needle (the three small
// Hilbert cubes), the connection colours by status, bloom, and blending.
//
// Dark themes glow: the needle + connections use additive blending and bloom on
// a near-black void. Light themes invert it: a bright field with dark, saturated
// lines, normal blending, no bloom. The void lattice is always matte (normal
// blending) so it reads as a faint structure instead of a glowing wash.
//
// Colours are sRGB hex strings. `status.funded` is the hot accent reserved for a
// real funded hit - in normal running the piece never shows it.

export const THEMES = [
  {
    id: 'void', name: 'Void', dark: true,
    background: '#05070e', fog: '#05070e', fogDensity: 0.00040,
    lattice: '#355a8c', latticeOpacity: 0.07,
    cubes: ['#2f6fb0', '#8bd0ff', '#1f4e79'],
    status: { unused: '#2f6fb0', 'used-empty': '#8be9ff', funded: '#ffcf4d' },
    text: '#9fb8d8',
    bloom: { strength: 0.65, radius: 0.4, threshold: 0.22 }, blending: 'additive',
  },
  {
    id: 'nebula', name: 'Nebula', dark: true,
    background: '#0a0716', fog: '#0a0716', fogDensity: 0.00040,
    lattice: '#5a3aa0', latticeOpacity: 0.08,
    cubes: ['#7a46ff', '#27e0ff', '#c04dff'],
    status: { unused: '#6a3cff', 'used-empty': '#27e0ff', funded: '#ffffff' },
    text: '#c9b6ff',
    bloom: { strength: 0.75, radius: 0.45, threshold: 0.2 }, blending: 'additive',
  },
  {
    id: 'phosphor', name: 'Phosphor', dark: true,
    background: '#020800', fog: '#020800', fogDensity: 0.00040,
    lattice: '#2f8a3f', latticeOpacity: 0.07,
    cubes: ['#1f9e3a', '#4dff7a', '#0f6e22'],
    status: { unused: '#1f9e3a', 'used-empty': '#6dff8c', funded: '#ff3b3b' },
    text: '#7dffa0',
    bloom: { strength: 0.65, radius: 0.4, threshold: 0.22 }, blending: 'additive',
  },
  {
    id: 'ember', name: 'Ember', dark: true,
    background: '#0b0803', fog: '#0b0803', fogDensity: 0.00042,
    lattice: '#8a5e2a', latticeOpacity: 0.07,
    cubes: ['#b5702a', '#ffb24d', '#8a4a16'],
    status: { unused: '#b5702a', 'used-empty': '#ffcf8a', funded: '#ffffff' },
    text: '#e0b07a',
    bloom: { strength: 0.6, radius: 0.4, threshold: 0.22 }, blending: 'additive',
  },
  {
    id: 'paper', name: 'Paper', dark: false,
    background: '#f2efe8', fog: '#f2efe8', fogDensity: 0.00045,
    lattice: '#9c917c', latticeOpacity: 0.28,
    cubes: ['#41607a', '#0f7d8c', '#7a3b2e'],
    status: { unused: '#4a6174', 'used-empty': '#0f7d8c', funded: '#c0392b' },
    text: '#4a5568',
    bloom: null, blending: 'normal',
  },
  {
    id: 'blueprint', name: 'Blueprint', dark: false,
    background: '#e9eff7', fog: '#e9eff7', fogDensity: 0.0005,
    lattice: '#7f98bd', latticeOpacity: 0.3,
    cubes: ['#26456f', '#1763c9', '#3a2f6b'],
    status: { unused: '#2d4f7c', 'used-empty': '#1763c9', funded: '#e8730a' },
    text: '#26456f',
    bloom: null, blending: 'normal',
  },
];

const BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export function getTheme(id) { return BY_ID[id] || THEMES[0]; }
export const THEME_IDS = THEMES.map((t) => t.id);
