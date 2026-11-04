// Baseline for the UX-04 guard: forbidden text sizes (<12px) and low-contrast greys (300/400) in src/**/*.tsx.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'D:/dr-sr/frontend/src'
const ALLOW = new Set(['PrintLetterhead.tsx', 'RegistrationCard.tsx', 'PrescriptionPrint.tsx', 'ReceiptPrint.tsx'])
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const files = walk(root).filter((f) => /\.tsx$/.test(f) && !/__tests__|\.test\./.test(f))

const SIZE = /(?<![\w-])((?:[a-z-]+:)*)text-\[(\d+(?:\.\d+)?)(px|rem)\]/g
const GREY = /(?<![\w-])((?:[a-z-]+:)*)text-(neutral|slate|gray|zinc|stone)-(300|400)(?![\w-])/g

const rows = []
const totals = { size: 0, grey: 0, sizeAllowed: 0, greyAllowed: 0, xs: 0 }
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const base = f.split(/[\\/]/).pop()
  const allowed = ALLOW.has(base)
  let size = 0, grey = 0, xs = 0
  const sizes = []
  for (const m of src.matchAll(SIZE)) {
    const px = m[3] === 'px' ? +m[2] : +m[2] * 16
    if (px < 12) { size++; sizes.push(m[2] + m[3]) }
  }
  for (const m of src.matchAll(GREY)) {
    const variants = m[1]
    if (/(^|:)(placeholder|dark|disabled|print):/.test(m[1] + ':') || /placeholder:|dark:/.test(variants)) continue
    grey++
  }
  xs = (src.match(/(?<![\w-])text-xs(?![\w-])/g) || []).length
  if (size || grey || xs) rows.push({ file: relative(join(root, '..'), f).replace(/\\/g, '/'), size, grey, xs, allowed, sizes: [...new Set(sizes)].join(',') })
  if (allowed) { totals.sizeAllowed += size; totals.greyAllowed += grey } else { totals.size += size; totals.grey += grey; totals.xs += xs }
}
rows.sort((a, b) => (b.size + b.grey) - (a.size + a.grey))
console.log('file | text-[<12px] | grey 300/400 | text-xs | allowlisted print file | distinct small sizes')
for (const r of rows) console.log(`${r.file} | ${r.size} | ${r.grey} | ${r.xs} | ${r.allowed ? 'ALLOW' : ''} | ${r.sizes}`)
console.log('\nOn-screen (non-allow-listed) violations: text-[<12px] =', totals.size, ', grey 300/400 =', totals.grey, ', text-xs uses =', totals.xs)
console.log('Allow-listed (print) occurrences: text-[<12px] =', totals.sizeAllowed, ', grey 300/400 =', totals.greyAllowed)
