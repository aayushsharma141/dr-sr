import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const root = 'D:/dr-sr/frontend/src'
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p] })
const files = walk(root).filter((f) => /\.(tsx|ts)$/.test(f) && !/__tests__|\.test\./.test(f))
// Devanagari run: letters, matras, virama, danda, digits, plus joining spaces/punct between words
const RUN = /[\u0900-\u097F\u200c\u200d]+(?:[ \t.,!?()/\-–·:'"0-9]*[\u0900-\u097F\u200c\u200d]+)*/g
let total = 0, withLang = 0
const rows = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split(/\r?\n/)
  let n = 0, lang = 0, lineSet = new Set()
  lines.forEach((line, i) => {
    const m = line.match(RUN)
    if (m) {
      n += m.length; lineSet.add(i + 1)
      if (/lang=["']hi["']/.test(line)) lang += m.length
    }
  })
  if (n) { rows.push([relative('D:/dr-sr/frontend', f).replace(/\\/g, '/'), n, lineSet.size, lang]); total += n; withLang += lang }
}
rows.sort((a, b) => b[1] - a[1])
console.log('file | devanagari runs | lines | runs on a line with lang="hi"')
for (const r of rows) console.log(r.join(' | '))
console.log('TOTAL runs', total, 'files', rows.length, 'already lang=hi', withLang)
const lang = readdirSync(root)
// any lang= attributes at all
let langAttr = 0
for (const f of files) { const s = readFileSync(f, 'utf8'); langAttr += (s.match(/\blang=/g) || []).length }
console.log('total lang= attributes in non-test src:', langAttr)
