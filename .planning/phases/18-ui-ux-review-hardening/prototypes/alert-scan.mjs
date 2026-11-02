// Find error/status banners rendered without role="alert"/"status" (UX-03: failures must be announced).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = 'D:/dr-sr/frontend/src'
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const files = walk(root).filter((f) => /\.tsx$/.test(f) && !/__tests__|\.test\./.test(f))
const out = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    // conditional error blocks: {errorMessage && (  /  {docError && (  /  {isError && (  / {error && (
    if (/\{\s*(?:\w*[eE]rr(?:or|Msg|orMessage)\w*|isError|restoreStatus)\s*&&\s*\(?\s*$/.test(line) || /\{\s*(?:\w*[eE]rr(?:or|Msg|orMessage)\w*|isError)\s*&&\s*\(/.test(line)) {
      const window = lines.slice(i, i + 4).join(' ')
      const hasRole = /role=["'](alert|status)["']/.test(window)
      if (!hasRole) out.push(`${relative(join(root, '..'), f).replace(/\\/g, '/')}:${i + 1}  ${line.trim().slice(0, 70)}`)
    }
    // ternary / early-return error states: isError ? ( ... or "Failed to load"
    if (/Failed to (load|reload)/.test(line) && !/role=/.test(lines.slice(Math.max(0, i - 3), i + 1).join(' '))) {
      out.push(`${relative(join(root, '..'), f).replace(/\\/g, '/')}:${i + 1}  [text] ${line.trim().slice(0, 70)}`)
    }
  })
}
console.log('error/status banners without role=alert|status:', out.length)
for (const o of [...new Set(out)]) console.log('  ' + o)
