// frontend/src/test/guards/guards.test.ts   (typechecks under tsc -b; runs red on today's tree: ~96 legibility hits, the 7 controls, the 2 alert() files)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(SRC).filter((f) => f.endsWith('.tsx') && !/__tests__|\.test\./.test(f))
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/')
const PRINT_ONLY = new Set(['PrintLetterhead.tsx', 'RegistrationCard.tsx', 'PrescriptionPrint.tsx', 'ReceiptPrint.tsx'])

describe('legibility guard (UX-04)', () => {
  const SIZE = /(?<![\w-])(?:[a-z-]+:)*text-\[(\d+(?:\.\d+)?)(px|rem)\]/g   // below 12px fails (rem x 16)
  const GREY = /(?<![\w-])((?:[a-z-]+:)*)text-(?:neutral|slate|gray|zinc|stone)-(?:300|400)(?![\w-])/g
  it('no on-screen text below 12px and no 300/400 greys (placeholder:/dark: variants excluded)', () => {
    const bad: string[] = []
    for (const f of files) {
      if (PRINT_ONLY.has(f.split(/[\\/]/).pop()!)) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(SIZE)) if ((m[2] === 'px' ? +m[1] : +m[1] * 16) < 12) bad.push(`${rel(f)}: ${m[0]}`)
      for (const m of src.matchAll(GREY)) if (!/(^|:)(placeholder|dark):/.test(m[1])) bad.push(`${rel(f)}: ${m[0]}`)
      for (const m of src.matchAll(/fontSize=["'](\d+(?:\.\d+)?)["']/g)) if (+m[1] < 12) bad.push(`${rel(f)}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
  // add: readFileSync('src/index.css') must not set font-size on html/:root (R1), or --text-xs x root >= 12px (R2)
})

describe('accessible names guard (UX-06)', () => {
  /** Opening tags of the wanted elements, skipping > inside {...} and quotes (arrow functions contain >). */
  function* tags(src: string, names: string[]) {
    const re = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 0, quote: string | null = null
      for (; i < src.length; i++) {
        const c = src[i]
        if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue }
        if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) break
      }
      yield { tag: m[1], attrs: src.slice(m.index + m[0].length, i), index: m.index }
    }
  }
  it('every input/select/textarea has an accessible name', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const forIds = new Set([...src.matchAll(/htmlFor=(?:"([^"]+)"|\{\s*[`'"]([^`'"]+)[`'"]\s*\})/g)].map((m) => m[1] ?? m[2]))
      for (const { tag, attrs, index } of tags(src, ['input', 'select', 'textarea'])) {
        if (/type=["']hidden["']/.test(attrs) || /\baria-label=|\baria-labelledby=/.test(attrs) || /\{\.\.\./.test(attrs)) continue
        const id = attrs.match(/\bid=(?:"([^"]+)"|\{[`'"]([^`'"]+)[`'"]\})/)
        if (id && forIds.has(id[1] ?? id[2])) continue
        const before = src.slice(0, index)
        if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue   // wrapped by a label
        bad.push(`${rel(f)}:${before.split('\n').length} <${tag}>`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('no blocking dialogs (UX-03)', () => {
  it('no alert(), confirm() or prompt() calls', () => {
    expect(files.filter((f) => /(?<![\w.])(alert|confirm|prompt)\(/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([])
  })
})
