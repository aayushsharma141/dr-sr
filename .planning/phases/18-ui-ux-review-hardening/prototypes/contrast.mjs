// WCAG contrast of Tailwind v4 palette steps (oklch in theme.css) on white and the app surfaces.
import { readFileSync } from 'node:fs'

const theme = readFileSync('D:/dr-sr/frontend/node_modules/tailwindcss/theme.css', 'utf8')
const colors = {}
for (const m of theme.matchAll(/--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+%?)\s+([\d.]+)\s+([\d.]+|none)\)/g)) {
  const L = m[3].endsWith('%') ? parseFloat(m[3]) / 100 : parseFloat(m[3])
  colors[`${m[1]}-${m[2]}`] = [L, parseFloat(m[4]), m[5] === 'none' ? 0 : parseFloat(m[5])]
}

function oklchToRgb([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)))
  return lin // linear sRGB 0..1
}
const lumFromLinear = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const hexToLinear = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
const toHex = (lin) =>
  '#' + lin.map((c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('')
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

const bgs = {
  white: hexToLinear('#FFFFFF'),
  'kh-surface #F5F7FA': hexToLinear('#F5F7FA'),
  'neutral-50': oklchToRgb(colors['neutral-50']),
  'neutral-100': oklchToRgb(colors['neutral-100']),
  'slate-50': oklchToRgb(colors['slate-50']),
}

const families = process.argv.slice(2).length ? process.argv.slice(2) : ['neutral', 'slate', 'gray', 'zinc', 'stone']
for (const fam of families) {
  console.log(`\n${fam}: step | hex | on white | on #F5F7FA | on neutral-50 | on neutral-100`)
  for (const step of [300, 400, 500, 600, 700]) {
    const lin = oklchToRgb(colors[`${fam}-${step}`])
    const lum = lumFromLinear(lin)
    const cols = ['white', 'kh-surface #F5F7FA', 'neutral-50', 'neutral-100'].map((k) => {
      const r = ratio(lum, lumFromLinear(bgs[k]))
      return r.toFixed(2) + (r >= 4.5 ? ' ok' : ' FAIL')
    })
    console.log(`  ${step} | ${toHex(lin)} | ${cols.join(' | ')}`)
  }
}
// project text tokens for reference
console.log('\nproject tokens on white:')
for (const [n, hex] of Object.entries({ 'text-secondary #475569': '#475569', 'text-muted #64748B': '#64748B', 'placeholder #94A3B8': '#94A3B8' })) {
  console.log(`  ${n}: ${ratio(lumFromLinear(hexToLinear(hex)), 1).toFixed(2)}`)
}
// other colours frequently used for small text
console.log('\nstatus/semantic text on white:')
for (const k of ['red-500', 'red-600', 'red-700', 'emerald-600', 'emerald-700', 'amber-600', 'amber-700', 'teal-600', 'teal-700', 'blue-600', 'blue-700']) {
  console.log(`  ${k}: ${ratio(lumFromLinear(oklchToRgb(colors[k])), 1).toFixed(2)}`)
}
