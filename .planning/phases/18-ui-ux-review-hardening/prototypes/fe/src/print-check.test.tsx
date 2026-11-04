// @vitest-environment jsdom
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { PrescriptionPrint } from './components/PrescriptionPrint'
import { PrescriptionPrintDialog } from './components/PrescriptionPrintDialog'
import { Modal } from './components/Modal'
import { ReceiptPrint } from './components/ReceiptPrint'
import { RegistrationCard } from './components/RegistrationCard'
import type { ClinicSettingsOut, PatientOut, PaymentOut, PrescriptionOut } from './api/types'

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean) as string[]
const edge = EDGE_CANDIDATES.find((p) => existsSync(p))
const dist = resolve(process.cwd(), 'dist')
const cssFile = existsSync(join(dist, 'assets'))
  ? readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.css$/.test(f))
  : undefined

/** Dependency-free page count + MediaBox reader for Chromium/Skia PDFs. */
function pdfPages(path: string) {
  const text = readFileSync(path).toString('latin1')
  const pages: { w: number; h: number }[] = []
  for (const obj of text.split('endobj')) {
    if (!/\/Type\s*\/Page(?![s\w])/.test(obj)) continue
    const m = obj.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/)
    if (m) pages.push({ w: ((+m[3] - +m[1]) * 25.4) / 72, h: ((+m[4] - +m[2]) * 25.4) / 72 })
  }
  return pages
}

const settings: ClinicSettingsOut = {
  id: 1,
  name_en: 'Kalyan Hospital',
  name_hi: 'कल्याण अस्पताल',
  address_1: 'नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301',
  address_2: 'श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर, जिला - भोजपुर (बिहार) - 802206',
  phone: '06182-234567',
  email: null,
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: null,
  print_header_hi: null,
  print_footer_en: null,
  print_footer_hi: null,
  consultation_validity_days: 14,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
}
const patient: PatientOut = {
  id: 10,
  urn: 'KH-2026-0010',
  full_name: 'Rajeshwar Prasad Sinha Chaudhary of Bhojpur',
  guardian_name: 'Suresh Narayan Prasad Sinha Chaudhary',
  gender: 'M',
  dob: null,
  age_years: 42,
  mobile: '9876543210',
  address: 'House 12, Main Road, Near Old Bus Stand, Arrah Town, Bhojpur District',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876543211',
  allergies: 'Penicillin, sulfa drugs, NSAID intolerance reported in 2019',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
}
const items = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  item_order: i + 1,
  medicine_name: `Tab Medicine Number ${i + 1} with a long brand name`,
  dosage: '100 mg',
  frequency: 'Twice daily after meals',
  duration_days: 5,
  instructions: 'Take after food with a full glass of water; avoid on empty stomach',
}))
const prescription = {
  id: 1,
  patient_id: 10,
  patient_urn: 'KH-2026-0010',
  patient_name: patient.full_name,
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  diagnosis: 'Chronic lumbar radiculopathy with associated paraspinal spasm',
  dietary_advice: 'Avoid cold drinks. '.repeat(8),
  general_advice: 'Hot fomentation twice a day. '.repeat(8),
  follow_up_date: '2026-11-10',
  version_id: 1,
  created_at: '2026-10-27T14:00:00Z',
  updated_at: '2026-10-27T14:00:00Z',
  items,
} as PrescriptionOut
const payment: PaymentOut = {
  id: 42,
  receipt_number: 'RCP-2026-0042',
  patient_id: 10,
  patient_urn: 'KH-2026-0010',
  patient_name: patient.full_name,
  treatment_plan_id: 5,
  treatment_plan_name: 'Cervical Spondylosis Package of twelve sessions',
  appointment_id: null,
  amount_paise: 250000,
  payment_method: 'UPI',
  notes: 'Second instalment, UPI txn id 4098123409812340981234',
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception1',
  created_at: '2026-03-01T10:30:00Z',
}

function toFixtureHtml(bodyHtml: string): string {
  const base = pathToFileURL(dist).href
  const css = `${base}/assets/${cssFile}`
  const withAssets = bodyHtml.replaceAll('src="/assets/', `src="${base}/assets/`)
  // jsdom cannot put a <dialog> in the browser's top layer, so re-open dialogs with the real showModal().
  const reopen =
    '<script>document.querySelectorAll("dialog[open]").forEach(function(d){d.removeAttribute("open");d.showModal()})</script>'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"></head><body>${withAssets}${reopen}</body></html>`
}

function printToPdf(html: string, name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kh-print-'))
  mkdirSync(dir, { recursive: true })
  const htmlPath = join(dir, `${name}.html`)
  const pdfPath = join(dir, `${name}.pdf`)
  writeFileSync(htmlPath, html, 'utf8')
  const res = spawnSync(
    edge!,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-pdf-header-footer',
      '--virtual-time-budget=4000',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { timeout: 60_000, windowsHide: true },
  )
  expect(existsSync(pdfPath), `Edge produced no PDF (exit ${res.status})`).toBe(true)
  return pdfPages(pdfPath)
}

function mount(ui: React.ReactElement) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['clinic-settings'], settings)
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, { container: root })
  return document.body.innerHTML
}

describe.skipIf(!edge || !cssFile)('headless print check (Edge --print-to-pdf)', () => {
  it('registration card stays on one A4 page', () => {
    const pages = printToPdf(toFixtureHtml(mount(<RegistrationCard patient={patient} settings={settings} />)), 'card')
    expect(pages).toHaveLength(1)
    expect(Math.abs(pages[0].w - 210)).toBeLessThan(1)
    expect(Math.abs(pages[0].h - 297)).toBeLessThan(1)
  })

  it('prescription slip with 10 medicines stays on one A4 page', () => {
    const pages = printToPdf(toFixtureHtml(mount(<PrescriptionPrint prescription={prescription} />)), 'rx')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 210)).toBeLessThan(1)
  })

  it('receipt prints on an 80 mm wide page', () => {
    const html = mount(
      <div className="print-portal" data-print-page="receipt">
        <ReceiptPrint payment={payment} isReprint />
      </div>,
    )
    const pages = printToPdf(toFixtureHtml(html), 'receipt')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 80)).toBeLessThan(1)
  })
  it('prescription slip as a native modal <dialog> (top layer) stays on one A4 page, not clipped', () => {
    const pages = printToPdf(toFixtureHtml(mount(<PrescriptionPrintDialog prescription={{ ...prescription, general_advice: 'Hot fomentation twice a day.', dietary_advice: 'Avoid cold drinks.', items: items.slice(0, 6).map((i) => ({ ...i, medicine_name: 'Tab Medicine ' + i.id, instructions: 'After meals' })) } as PrescriptionOut} />)), 'rx-dialog')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 210)).toBeLessThan(1)
  })

  it('a taller dialog prescription paginates instead of being clipped', () => {
    const pages = printToPdf(toFixtureHtml(mount(<PrescriptionPrintDialog prescription={prescription} />)), 'rx-dialog-tall')
    expect(pages.length, JSON.stringify(pages)).toBeGreaterThanOrEqual(2)
  })

  it('receipt in a native dialog with data-print-page=receipt prints on an 80 mm page', () => {
    const html = mount(
      <dialog open className="print-portal" data-print-page="receipt">
        <ReceiptPrint payment={payment} isReprint />
      </dialog>,
    )
    const pages = printToPdf(toFixtureHtml(html), 'receipt-dialog')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 80)).toBeLessThan(1)
  })
  it('FINAL Modal print="receipt": reprint receipt prints on one 80 mm page', () => {
    const html = mount(
      <Modal open print="receipt" title="Receipt" onClose={() => {}}>
        <ReceiptPrint payment={payment} isReprint />
      </Modal>,
    )
    const pages = printToPdf(toFixtureHtml(html), 'modal-receipt')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 80)).toBeLessThan(1)
  })

  it('FINAL Modal print="a4": registration card inside the print dialog prints on one A4 page', () => {
    const html = mount(
      <Modal open print="a4" title="Card" onClose={() => {}} className="max-w-[220mm]">
        <RegistrationCard patient={patient} settings={settings} />
      </Modal>,
    )
    const pages = printToPdf(toFixtureHtml(html), 'modal-card')
    expect(pages.length, JSON.stringify(pages)).toBe(1)
    expect(Math.abs(pages[0].w - 210)).toBeLessThan(1)
  })
})
