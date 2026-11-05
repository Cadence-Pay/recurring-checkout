import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8');

/** Colour variables in a block of CSS, by name without the leading `--rc-`. */
function colors(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--rc-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) out[name] = value;
  }
  return out;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkEnd = css.indexOf('.rc-root {');
const lightBlock = css.slice(css.indexOf(':where(.rc-root)'), darkStart);
const darkBlock = css.slice(darkStart, darkEnd);
const light = colors(lightBlock);
const dark = { ...light, ...colors(darkBlock) };

function channel(hex: string, start: number): number {
  const v = parseInt(hex.slice(start, start + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['muted', 'bg'],
  ['primary', 'bg'], // secondary button text
  ['primary-contrast', 'primary'], // primary button
  ['danger', 'bg'],
  ['success', 'bg'],
];

describe('widget theme', () => {
  it.each(PAIRS)('keeps %s on %s readable in the light theme (4.5:1)', (fg, bg) => {
    expect(contrast(light[fg] ?? '', light[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAIRS)('keeps %s on %s readable in the dark theme (4.5:1)', (fg, bg) => {
    expect(contrast(dark[fg] ?? '', dark[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the focus ring with enough contrast (3:1) in both themes', () => {
    expect(contrast(light['focus'] ?? '', light['bg'] ?? '')).toBeGreaterThanOrEqual(3);
    expect(contrast(dark['focus'] ?? '', dark['bg'] ?? '')).toBeGreaterThanOrEqual(3);
  });

  it('writes colours only in the two variable blocks, so a site can restyle everything', () => {
    // Comments are documentation, not style (one of them shows an example colour).
    const outside = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(lightBlock, '')
      .replace(darkBlock, '');
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(outside).not.toMatch(/\brgba?\(/);
  });

  it('keeps the default variables at zero specificity so the host always wins', () => {
    expect(lightBlock).toContain(':where(.rc-root)');
    expect(darkBlock).toContain(':where(.rc-root)');
  });
});
