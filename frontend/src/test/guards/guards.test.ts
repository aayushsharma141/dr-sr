// Source-level guards for Phase 18. Each describe block adds one rule; the
// file-level helpers below are shared by every block added to this file.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f))
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/')

describe('no blocking dialogs (UX-03)', () => {
  // Catches alert(, confirm(, prompt(), and the same calls through window. or globalThis.
  // A method call on another object (foo.confirm() ) is not a blocking browser dialog.
  const BLOCKING = /(?<![\w$.])(?:window\.|globalThis\.)?(alert|confirm|prompt)\(/

  it('no alert(), confirm() or prompt() calls in application source', () => {
    const offenders = files.filter((f) => BLOCKING.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })
})

describe('legibility guard (UX-04)', () => {
  // On-screen text must not be below 12px, must not use the failing grey shades (300/400) or
  // the semantic colours that fail 4.5:1 on white. Print-only documents keep their small
  // print type by design. The guard reads class names, so it cannot see the surface behind
  // the text: a light-on-dark panel needs a documented exception (see PENDING below).
  const PRINT_ONLY = new Set(['PrintLetterhead.tsx', 'RegistrationCard.tsx', 'PrescriptionPrint.tsx', 'ReceiptPrint.tsx'])
  const SIZE = /(?<![\w-])(?:[a-z-]+:)*text-\[(\d+(?:\.\d+)?)(px|rem)\]/g // rem counts as 16px
  const GREY = /(?<![\w-])((?:[a-z-]+:)*)text-(?:neutral|slate|gray|zinc|stone)-(?:300|400)(?![\w-])/g
  const SEMANTIC = /(?<![\w-])((?:[a-z-]+:)*)text-(?:red-500|emerald-600|amber-600|teal-600)(?![\w-])/g
  const FONT_SIZE_ATTR = /fontSize=["'](\d+(?:\.\d+)?)["']/g
  const TEXT_XS = /(?<![\w-])text-xs(?![\w-])/g
  const IGNORED_VARIANT = /(^|:)(placeholder|dark):/ // placeholder text and dark-mode variants are not scanned

  const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length

  /** Returns "line N: token" for every legibility violation in one source string. */
  function scan(src: string): string[] {
    const found: string[] = []
    for (const m of src.matchAll(SIZE)) {
      if ((m[2] === 'px' ? +m[1] : +m[1] * 16) < 12) found.push(`line ${lineOf(src, m.index ?? 0)}: ${m[0]} (below 12px)`)
    }
    for (const m of src.matchAll(GREY)) {
      if (!IGNORED_VARIANT.test(m[1])) found.push(`line ${lineOf(src, m.index ?? 0)}: ${m[0].trim()} (grey 300/400)`)
    }
    for (const m of src.matchAll(SEMANTIC)) {
      if (!IGNORED_VARIANT.test(m[1])) found.push(`line ${lineOf(src, m.index ?? 0)}: ${m[0].trim()} (fails 4.5:1 on white)`)
    }
    for (const m of src.matchAll(FONT_SIZE_ATTR)) {
      if (+m[1] < 12) found.push(`line ${lineOf(src, m.index ?? 0)}: ${m[0]} (SVG text below 12px)`)
    }
    return found
  }

  const onScreen = files.filter((f) => f.endsWith('.tsx') && !PRINT_ONLY.has(basename(f)))

  /**
   * TODO(18): temporary, documented allow-list. Each entry is a per-file CAP, not a free pass:
   * a file may not have MORE violations than its cap, and the cap must be lowered as soon as
   * violations are fixed (the ratchet test below). Counts were measured on this branch's base
   * (main at bfae6cc plus Phase 18). Tracked in
   * .planning/phases/18-ui-ux-review-hardening/18-DECISIONS.md.
   */
  const PENDING: Record<string, { max: number; reason: string }> = {
    // Existing code on main that Phase 18 did not touch: fixing it needs its own review.
    'components/AppShell.tsx': { max: 12, reason: '12 sub-12px classes in the shell (sidebar and header). Existing main code.' },
    'components/AdminNavTabs.tsx': { max: 1, reason: '1 sub-12px class. Existing main code.' },
    'pages/AppointmentsReception.tsx': { max: 2, reason: '1 sub-12px class, 1 grey. Existing main code.' },
    'pages/PatientsDirectory.tsx': { max: 4, reason: '4 grey 300/400 classes. Existing main code.' },
    'pages/PendingDuesPage.tsx': { max: 4, reason: '2 grey, 2 semantic colours. Existing main code.' },
    'pages/PatientDetail.tsx': { max: 1, reason: '1 sub-12px class in the payments table header (11px). The four grey section labels were fixed to neutral-600. Existing main code.' },
    // Held by client decisions.
    'components/VasTrendChart.tsx': { max: 4, reason: 'SVG font sizes (3) and 1 class: needs a visual review before changing. Held by the client.' },
    'pages/admin/AuditViewerPage.tsx': { max: 5, reason: 'Dark log panel uses light grey on near-black on purpose; needs a surface exception or a restyle. Held by the client.' },
    'pages/admin/BackupManagerPage.tsx': { max: 1, reason: 'Label chip at line 187: change rejected (it became larger than the filename beside it). Held by the client.' },
    'pages/TreatmentPlanWorkspace.tsx': { max: 2, reason: 'Addendum header and status badge: changes rejected for visual hierarchy. Held by the client.' },
  }

  // Root font size: this branch has no root font-size override, so the browser default 16px applies
  // and Tailwind text-xs renders at 12px. If a root size below 16px is ever added, text-xs drops under
  // 12px: record that decision here (set true) and the ceiling below stops new text-xs uses.
  const ROOT_SIZE_DEFERRED = false
  // Only used while ROOT_SIZE_DEFERRED is true: count of text-xs uses when the deferral was recorded.
  const BASELINE_TEXT_XS = 277

  const rootPx = (() => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8')
    let px = 16
    for (const block of css.matchAll(/(?:^|\n)\s*(?::root|html)\s*\{([^}]*)\}/g)) {
      const m = block[1].match(/font-size:\s*(\d+(?:\.\d+)?)px/)
      if (m) px = +m[1]
    }
    return px
  })()

  it('the scanner flags what it should and ignores what it should', () => {
    expect(scan('<p className="text-[10px]">')).toHaveLength(1)
    expect(scan('<p className="text-[0.7rem]">')).toHaveLength(1) // 11.2px
    expect(scan('<p className="text-[12px]">')).toHaveLength(0)
    expect(scan('<p className="text-neutral-400">')).toHaveLength(1)
    expect(scan('<p className="hover:text-slate-300">')).toHaveLength(1)
    expect(scan('<p className="placeholder:text-neutral-400 dark:text-slate-400">')).toHaveLength(0)
    expect(scan('<p className="text-neutral-500 text-neutral-600">')).toHaveLength(0)
    expect(scan('<p className="text-red-500">')).toHaveLength(1)
    expect(scan('<p className="text-red-600 text-emerald-700 text-amber-700 text-teal-700">')).toHaveLength(0)
    expect(scan('<text fontSize="9">')).toHaveLength(1)
    expect(scan('<text fontSize="12">')).toHaveLength(0)
  })

  it('no file has more legibility violations than its documented cap', () => {
    const over: string[] = []
    for (const f of onScreen) {
      const found = scan(readFileSync(f, 'utf8'))
      const cap = PENDING[rel(f)]?.max ?? 0
      if (found.length > cap) over.push(`${rel(f)}: ${found.length} found, cap ${cap}\n    ${found.join('\n    ')}`)
    }
    expect(over, over.join('\n')).toEqual([])
  })

  it('allow-list caps match reality: a fixed violation must lower its cap (no stale exemptions)', () => {
    const stale: string[] = []
    for (const [file, entry] of Object.entries(PENDING)) {
      const path = join(SRC, file)
      const found = scan(readFileSync(path, 'utf8')).length
      if (found < entry.max) stale.push(`${file}: ${found} found but cap is ${entry.max}. Lower the cap${found === 0 ? ' (remove the entry)' : ''}.`)
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('text-xs: the root size deferral is recorded and no new text-xs is added while it holds', () => {
    const textXsPx = rootPx * 0.75
    const count = onScreen.reduce((n, f) => n + (readFileSync(f, 'utf8').match(TEXT_XS) ?? []).length, 0)
    if (textXsPx < 12) {
      // text-xs renders below 12px: this must be a recorded deferral, with a ceiling that only goes down.
      expect(ROOT_SIZE_DEFERRED, `text-xs renders at ${textXsPx}px. Record the decision in ROOT_SIZE_DEFERRED.`).toBe(true)
      expect(count, `text-xs uses went UP (baseline ${BASELINE_TEXT_XS}). New on-screen text must not use text-xs while it renders below 12px.`).toBeLessThanOrEqual(BASELINE_TEXT_XS)
      expect(count, `text-xs uses went DOWN to ${count}. Lower BASELINE_TEXT_XS so the improvement is locked in.`).toBeGreaterThanOrEqual(BASELINE_TEXT_XS)
    } else {
      expect(ROOT_SIZE_DEFERRED, 'The root size now makes text-xs 12px or more: set ROOT_SIZE_DEFERRED to false and remove the ceiling.').toBe(false)
    }
  })
})
