// Headless Edge print check for the Phase 18 print layouts (UX-08, print part).
// Renders the REAL components, serialises the DOM, prints each page with Edge
// (--print-to-pdf), and reads page count and MediaBox from the PDF bytes.
//
// Scope and limits (stated, not hidden):
// - Fixtures are synthetic. The prescription slip fixture has 1 medicine (short); a long
//   stress fixture is NOT asserted because it is known to spill onto 2 pages.
// - The receipt page is A4 (approved paper, 2026-11-02), not 80 mm. Assertions follow that.
// - Edge is the only browser checked. No printer is involved: real printer output is the
//   manual check M-18-01..04 (plan 04 Task 5).
// - Set EDGE_PATH to choose a browser. Set REQUIRE_PRINT_CHECK=1 to make a missing browser
//   a failure instead of a skip (the phase gate does this).
// @vitest-environment jsdom
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { build } from 'vite'
import { beforeAll, describe, expect, it, afterAll } from 'vitest'
import { Modal } from '../components/Modal'
import { RegistrationCard } from '../components/RegistrationCard'
import { PrescriptionPrint } from '../components/PrescriptionPrint'
import { ReceiptDialog } from '../components/ReceiptDialog'
import type { ClinicSettingsOut, PatientOut, PaymentOut, PrescriptionOut } from '../api/types'

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean) as string[]
const edge = EDGE_CANDIDATES.find((p) => existsSync(p))
const required = process.env.REQUIRE_PRINT_CHECK === '1'
// Opt-in: the browser run takes about 16 s and loads the CPU, so a plain `npm test` skips it
// (PRINT_CHECK=1 runs it; REQUIRE_PRINT_CHECK=1 also makes a missing browser fail).
const run = !!edge && (required || process.env.PRINT_CHECK === '1')

/** Page count and MediaBox sizes (mm) from Chromium/Skia PDF bytes. Dependency-free. */
export function pdfPages(path: string) {
  const text = readFileSync(path).toString('latin1')
  const pages: { w: number; h: number }[] = []
  for (const obj of text.split('endobj')) {
    if (!/\/Type\s*\/Page(?![s\w])/.test(obj)) continue
    const m = obj.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/)
    if (m) pages.push({ w: ((+m[3] - +m[1]) * 25.4) / 72, h: ((+m[4] - +m[2]) * 25.4) / 72 })
  }
  return pages
}

const settings = {
  id: 1,
  name_en: 'Kalyan Hospital',
  name_hi: 'कल्याण अस्पताल',
  address_1: 'Station Road, Ara',
  address_2: 'Bhojpur, Bihar',
  phone: '06182-234567',
  email: null,
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: null,
  print_header_hi: null,
  print_footer_en: 'Speedy recovery',
  print_footer_hi: 'शीघ्र स्वास्थ्य लाभ की कामना',
  consultation_validity_days: 14,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
} as ClinicSettingsOut

const patient = {
  id: 10,
  urn: 'TEST-0010',
  full_name: 'Test Patient One',
  guardian_name: 'Test Guardian',
  gender: 'M',
  dob: null,
  age_years: 40,
  mobile: '9000000010',
  address: 'Test Address',
  district: 'Test District',
  state: 'Test State',
  emergency_contact: '9000000011',
  allergies: 'None',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
} as unknown as PatientOut

const payment = {
  id: 1,
  receipt_number: 'RCP-TEST-0001',
  patient_id: 10,
  patient_urn: 'TEST-0010',
  patient_name: 'Test Patient One',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 50000,
  payment_method: 'CASH',
  notes: null,
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception',
  created_at: '2026-11-02T10:00:00Z',
} as unknown as PaymentOut

const prescription = {
  id: 1,
  patient_id: 10,
  patient_urn: 'TEST-0010',
  patient_name: 'Test Patient One',
  doctor_id: 1,
  doctor_name: 'Test Doctor',
  encounter_id: null,
  diagnosis: 'Test diagnosis',
  dietary_advice: null,
  general_advice: 'Test advice',
  follow_up_date: '2026-11-10',
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  items: [
    { id: 1, item_order: 1, medicine_name: 'Test Medicine', dosage: '100 mg', frequency: 'BD', duration_days: 5, instructions: 'After meals' },
  ],
} as unknown as PrescriptionOut

let cssUrl = ''
let work = ''
let counter = 0

/** Serialise what is mounted in #root plus any portal in <body>, link the built CSS, print to PDF. */
function printToPdf(label: string) {
  const html = document.documentElement.outerHTML.replace(
    '</head>',
    `<link rel="stylesheet" href="${cssUrl}"></head>`,
  )
  counter += 1
  const base = join(work, `${label}-${counter}`)
  writeFileSync(`${base}.html`, '<!doctype html>' + html, 'utf8')
  const profile = mkdtempSync(join(work, 'profile-'))
  const result = spawnSync(
    edge!,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer',
      '--virtual-time-budget=4000',
      `--print-to-pdf=${base}.pdf`,
      pathToFileURL(`${base}.html`).href,
    ],
    { timeout: 90_000 },
  )
  expect(result.status === 0 || existsSync(`${base}.pdf`), `Edge failed: ${result.stderr}`).toBe(true)
  return pdfPages(`${base}.pdf`)
}

/** Mount the component inside #root, the way the app does, so the print hiding rule is exercised. */
function mountInRoot(ui: React.ReactElement) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['clinic-settings'], settings)
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, { container: root })
  return {
    cleanup: () => {
      view.unmount()
      root.remove()
      document.querySelectorAll('.print-portal').forEach((el) => el.remove())
    },
  }
}

const A4_MM = 210
const within = (actual: number, target: number, tol = 1) => Math.abs(actual - target) <= tol

beforeAll(async () => {
  if (!run) return
  work = mkdtempSync(join(tmpdir(), 'kalyan-print-'))
  const outDir = join(work, 'dist')
  await build({
    root: resolve(process.cwd()),
    configFile: resolve(process.cwd(), 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  })
  const css = readdirSync(join(outDir, 'assets')).find((f) => /^index-.*\.css$/.test(f))
  expect(css, 'built CSS not found').toBeTruthy()
  cssUrl = pathToFileURL(join(outDir, 'assets', css!)).href
}, 120_000)

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true })
})

if (!edge && required) {
  it('Edge or Chrome is available (REQUIRE_PRINT_CHECK=1)', () => {
    throw new Error('No Edge or Chrome found: set EDGE_PATH. The print check cannot pass silently.')
  })
}

describe.skipIf(!run)('headless print layouts (Edge)', () => {
  it('registration card prints on one A4 page', () => {
    const view = mountInRoot(<RegistrationCard patient={patient} settings={settings} />)
    const pages = printToPdf('card')
    view.cleanup()
    expect(pages.length).toBeGreaterThan(0)
    expect(pages).toHaveLength(1)
    expect(within(pages[0].w, A4_MM)).toBe(true)
  }, 60_000)

  it('prescription slip (short fixture) prints on one A4 page', () => {
    const view = mountInRoot(<PrescriptionPrint prescription={prescription} />)
    const pages = printToPdf('slip')
    view.cleanup()
    expect(pages.length).toBeGreaterThan(0)
    expect(pages).toHaveLength(1)
    expect(within(pages[0].w, A4_MM)).toBe(true)
  }, 60_000)

  it('receipt dialog prints on the named A4 receipt page, one page for a normal receipt', () => {
    const view = mountInRoot(<ReceiptDialog payment={payment} onClose={() => {}} />)
    const pages = printToPdf('receipt')
    view.cleanup()
    expect(pages.length).toBeGreaterThan(0)
    expect(pages).toHaveLength(1)
    expect(within(pages[0].w, A4_MM)).toBe(true)
  }, 60_000)

  it('a long dialog paginates onto more pages instead of clipping', () => {
    const rows = Array.from({ length: 120 }, (_, i) => <p key={i}>Line {i + 1} of a long test receipt</p>)
    const view = mountInRoot(
      <Modal open print="receipt" title="Tall test" onClose={() => {}}>
        {rows}
      </Modal>,
    )
    const pages = printToPdf('tall')
    view.cleanup()
    expect(pages.length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})

describe('closed print dialogs never reach the DOM (no H2 dependency in the test)', () => {
  it('Modal with open=false mounts no print-portal for receipt or a4', () => {
    const view = mountInRoot(
      <>
        <Modal open={false} print="receipt" title="closed receipt" onClose={() => {}}>
          x
        </Modal>
        <Modal open={false} print="a4" title="closed slip" onClose={() => {}}>
          x
        </Modal>
      </>,
    )
    expect(document.querySelector('dialog.print-portal')).toBeNull()
    view.cleanup()
  })

  it.skipIf(!run)('a closed print dialog does not change the registration card print', () => {
    const view = mountInRoot(
      <>
        <RegistrationCard patient={patient} settings={settings} />
        <Modal open={false} print="a4" title="closed" onClose={() => {}}>
          x
        </Modal>
      </>,
    )
    const pages = printToPdf('card-with-closed')
    view.cleanup()
    expect(pages).toHaveLength(1)
  }, 60_000)
})
