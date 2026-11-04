// Source scan: every <input|select|textarea> needs an accessible name (aria-label, aria-labelledby,
// id + <label htmlFor>, wrapped by <label>, type=hidden, or a spread). Brace-aware tag extraction.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'D:/dr-sr/frontend/src'
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const files = walk(root).filter((f) => /\.tsx$/.test(f) && !/__tests__|\.test\./.test(f))

/** Return [tagName, attrsText, startIndex] for each opening tag of the wanted elements. */
function* tags(src, names) {
  const re = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g')
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length
    let depth = 0
    let quote = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null
        continue
      }
      if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    yield [m[1], src.slice(m.index + m[0].length, i), m.index]
  }
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
const report = []
let total = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const forIds = new Set([...src.matchAll(/htmlFor=(?:"([^"]+)"|\{\s*[`'"]([^`'"]+)[`'"]\s*\})/g)].map((m) => m[1] ?? m[2]))
  for (const [tag, attrs, idx] of tags(src, ['input', 'select', 'textarea'])) {
    total++
    if (/type=["']hidden["']/.test(attrs)) continue
    if (/\baria-label=|\baria-labelledby=/.test(attrs)) continue
    if (/\{\.\.\./.test(attrs)) continue
    const id = attrs.match(/\bid=(?:"([^"]+)"|\{[`'"]([^`'"]+)[`'"]\})/)
    if (id && forIds.has(id[1] ?? id[2])) continue
    // wrapped by <label>: nearest preceding <label ...> without a closing </label> in between
    const before = src.slice(0, idx)
    const lastOpen = before.lastIndexOf('<label')
    const lastClose = before.lastIndexOf('</label>')
    if (lastOpen > lastClose && lastOpen !== -1) continue
    report.push(`${relative(join(root, '..'), f).replace(/\\/g, '/')}:${lineOf(src, idx)} <${tag}${id ? ' id=' + (id[1] ?? id[2]) : ''}${/placeholder=/.test(attrs) ? ' placeholder-only' : ''}>`)
  }
}
console.log(`controls scanned: ${total}; without an accessible name: ${report.length}`)
for (const r of report) console.log('  ' + r)
