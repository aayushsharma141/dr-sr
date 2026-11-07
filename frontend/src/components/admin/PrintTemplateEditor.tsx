import React, { useState, useEffect } from 'react'
import {
  usePrintTemplates,
  useUpdatePrintTemplate,
} from '../../api/queries'
import type { PrintDocumentType, PrintTemplateOut } from '../../api/types'
import { ConflictBanner } from '../ConflictBanner'

interface DocumentTabOption {
  type: PrintDocumentType
  label: string
  labelHi: string
}

const DOCUMENT_TABS: DocumentTabOption[] = [
  { type: 'prescription', label: 'Prescription Slip', labelHi: 'पर्चा' },
  { type: 'receipt', label: 'Payment Receipt', labelHi: 'रसीद' },
  { type: 'registration_card', label: 'Registration Identity Card', labelHi: 'पहचान पत्र' },
  { type: 'consultation_summary', label: 'Patient Consultation Summary', labelHi: 'परामर्श सारांश' },
]

export function PrintTemplateEditor() {
  const { data: templates, isLoading, error: fetchError, refetch, isFetching } = usePrintTemplates()
  const updateMutation = useUpdatePrintTemplate()

  const [activeTab, setActiveTab] = useState<PrintDocumentType>('prescription')

  // Form field state for active template
  const [headerEn, setHeaderEn] = useState('')
  const [headerHi, setHeaderHi] = useState('')
  const [footerEn, setFooterEn] = useState('')
  const [footerHi, setFooterHi] = useState('')
  const [hasConflict, setHasConflict] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Find active template from fetched list
  const activeTemplate: PrintTemplateOut | undefined = templates?.find(
    (t) => t.document_type === activeTab,
  )

  // Sync form state when active template changes or is loaded
  useEffect(() => {
    if (activeTemplate) {
      setHeaderEn(activeTemplate.header_en || '')
      setHeaderHi(activeTemplate.header_hi || '')
      setFooterEn(activeTemplate.footer_en || '')
      setFooterHi(activeTemplate.footer_hi || '')
      setHasConflict(false)
      setSaveError(null)
      setSaveSuccess(false)
    }
  }, [activeTemplate, activeTab])

  const handleTabChange = (newTab: PrintDocumentType) => {
    setActiveTab(newTab)
    setSaveSuccess(false)
    setSaveError(null)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTemplate) return

    setSaveError(null)
    setSaveSuccess(false)
    setHasConflict(false)

    try {
      await updateMutation.mutateAsync({
        docType: activeTab,
        payload: {
          header_en: headerEn,
          header_hi: headerHi,
          footer_en: footerEn,
          footer_hi: footerHi,
          version: activeTemplate.version,
        },
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('409') || err?.code === 'version_conflict') {
        setHasConflict(true)
      } else {
        setSaveError(err?.message || 'Failed to update print template.')
      }
    }
  }

  const handleReload = () => {
    refetch()
    setHasConflict(false)
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-[#8E1C3D]" />
        <span className="ml-3 text-sm text-slate-600">Loading print templates...</span>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-semibold">Error loading templates</p>
        <p>{(fetchError as Error).message || 'Unable to load print templates from server.'}</p>
        <button
          onClick={() => refetch()}
          className="mt-3 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 1. Document Selector Tabs across top */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-2 sm:space-x-8 overflow-x-auto" aria-label="Print Document Tabs">
          {DOCUMENT_TABS.map((tab) => {
            const isActive = activeTab === tab.type
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => handleTabChange(tab.type)}
                className={`whitespace-nowrap border-b-2 py-3 px-3 text-sm font-medium transition-colors cursor-pointer min-h-[44px] ${
                  isActive
                    ? 'border-[#8E1C3D] text-[#8E1C3D] font-semibold'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-800'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
                <span className="ml-1.5 text-xs text-slate-500 font-normal">({tab.labelHi})</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* 2. Split-Screen Layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column (Editor Form - 5 cols) */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {DOCUMENT_TABS.find((t) => t.type === activeTab)?.label}
              </h2>
              <p className="text-xs text-slate-500">Bilingual letterhead &amp; footer configuration</p>
            </div>
            {activeTemplate && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                Version {activeTemplate.version}
              </span>
            )}
          </div>

          {hasConflict && (
            <div className="mt-4">
              <ConflictBanner onReload={handleReload} isReloading={isFetching} />
            </div>
          )}

          {saveSuccess && (
            <div className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              Print template saved successfully (version incremented).
            </div>
          )}

          {saveError && (
            <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}

          <form onSubmit={handleSave} className="mt-6 space-y-5">
            {/* English Header */}
            <div>
              <label htmlFor="header_en" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                English Header Text
              </label>
              <textarea
                id="header_en"
                name="header_en"
                rows={3}
                value={headerEn}
                onChange={(e) => setHeaderEn(e.target.value)}
                placeholder="Hospital name, department title, or English letterhead text..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] min-h-[44px]"
              />
            </div>

            {/* Hindi Header */}
            <div>
              <label htmlFor="header_hi" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Hindi Header Text <span className="font-normal text-slate-500">(हिंदी)</span>
              </label>
              <textarea
                id="header_hi"
                name="header_hi"
                lang="hi"
                rows={3}
                value={headerHi}
                onChange={(e) => setHeaderHi(e.target.value)}
                placeholder="अस्पताल का नाम, विभाग शीर्षक, या हिंदी लेटरहेड टेक्स्ट..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] min-h-[44px]"
              />
            </div>

            {/* English Footer */}
            <div>
              <label htmlFor="footer_en" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                English Footer Text
              </label>
              <textarea
                id="footer_en"
                name="footer_en"
                rows={3}
                value={footerEn}
                onChange={(e) => setFooterEn(e.target.value)}
                placeholder="Emergency contact, working hours, or English footer note..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] min-h-[44px]"
              />
            </div>

            {/* Hindi Footer */}
            <div>
              <label htmlFor="footer_hi" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Hindi Footer Text <span className="font-normal text-slate-500">(हिंदी)</span>
              </label>
              <textarea
                id="footer_hi"
                name="footer_hi"
                lang="hi"
                rows={3}
                value={footerHi}
                onChange={(e) => setFooterHi(e.target.value)}
                placeholder="आपातकालीन नंबर, क्लिनिक का पता या शुभकामना संदेश..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] min-h-[44px]"
              />
            </div>

            {/* Save CTA */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="w-full inline-flex items-center justify-center rounded-md bg-[#8E1C3D] px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#721631] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 min-h-[44px] cursor-pointer"
              >
                {updateMutation.isPending ? 'Saving Template...' : 'Save Print Template'}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column (Live A4 Simulation Canvas - 7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Live A4 Document Simulation
            </h3>
            <span className="text-xs text-slate-500 font-mono">210mm × 297mm (A4 Proportion)</span>
          </div>

          {/* A4 Paper Aspect Ratio Container */}
          <div className="w-full max-w-[560px] mx-auto aspect-[1/1.414] bg-white rounded-lg shadow-md border border-slate-300 p-4 sm:p-6 flex flex-col justify-between text-slate-900 transition-all select-none overflow-hidden">
            {/* Document Top: Letterhead Banner */}
            <div>
              <div className="bg-[#9E1B42] text-white p-3 rounded-xs text-center">
                <h4 lang="hi" className="text-base sm:text-lg font-bold leading-tight">
                  {headerHi || 'कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र'}
                </h4>
                <p className="text-xs sm:text-sm font-semibold tracking-wide uppercase opacity-95">
                  {headerEn || 'Kalyan Hospital & Physiotherapy Centre'}
                </p>
                <div className="mt-1 border-t border-red-300/40 pt-1 text-xs text-red-100 uppercase tracking-widest font-mono">
                  {DOCUMENT_TABS.find((t) => t.type === activeTab)?.label}
                </div>
              </div>

              {/* Patient Identity Strip */}
              <div className="mt-3 border-y border-slate-300 py-1.5 text-xs grid grid-cols-3 gap-2 text-slate-700 font-medium">
                <div>
                  <span className="text-slate-500">Patient:</span> <span className="font-semibold text-slate-900">Ram Kumar</span>
                </div>
                <div>
                  <span className="text-slate-500">URN:</span> <span className="font-mono font-semibold text-slate-900">KH-2026-0042</span>
                </div>
                <div>
                  <span className="text-slate-500">Age/Sex:</span> 45 Y / M
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Address:</span> Station Road, Ara, Bhojpur
                </div>
                <div>
                  <span className="text-slate-500">Date:</span> 08 Nov 2026
                </div>
              </div>

              {/* Document Body Simulation */}
              <div className="mt-4 px-1 text-xs">
                {activeTab === 'prescription' && (
                  <div className="space-y-3">
                    <div className="text-base font-serif font-black text-[#9E1B42]">℞</div>
                    <div className="space-y-1.5 pl-2 font-mono text-xs text-slate-800">
                      <div className="flex justify-between border-b border-dotted border-slate-200 pb-1">
                        <span>1. Tab. Paracetamol 500mg</span>
                        <span>1-0-1 (After Meals) × 5 Days</span>
                      </div>
                      <div className="flex justify-between border-b border-dotted border-slate-200 pb-1">
                        <span>2. Cap. Amoxicillin 500mg</span>
                        <span>1-0-1 (After Meals) × 5 Days</span>
                      </div>
                      <div className="flex justify-between border-b border-dotted border-slate-200 pb-1">
                        <span>3. Syp. B-Complex</span>
                        <span>10ml TDS × 7 Days</span>
                      </div>
                    </div>
                    <div className="pt-6 flex justify-end">
                      <div className="text-center text-xs text-slate-500 border-t border-slate-500 w-36 pt-1">
                        Doctor Signature &amp; Stamp
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'receipt' && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs border-b border-slate-200 pb-2">
                      <span className="font-semibold text-slate-700">Receipt No: REC-2026-0089</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800 text-xs">CASH</span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between py-1">
                        <span>Consultation Fee (Dr. Madan Mohan Dwivedi)</span>
                        <span className="font-semibold">₹ 500.00</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-300 pt-2 font-bold text-slate-900">
                        <span>Total Paid</span>
                        <span>₹ 500.00</span>
                      </div>
                    </div>
                    <div className="pt-6 flex justify-end">
                      <div className="text-center text-xs text-slate-500 border-t border-slate-500 w-32 pt-1">
                        Authorized Cashier
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'registration_card' && (
                  <div className="space-y-3 p-2 bg-slate-50 rounded border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-20 bg-slate-200 rounded border border-slate-300 flex items-center justify-center text-xs text-slate-500 text-center">
                        Photo Placeholder
                      </div>
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-slate-900">Ram Kumar</p>
                        <p className="font-mono text-slate-700">KH-2026-0042</p>
                        <p className="text-slate-600">Mobile: +91 9876543210</p>
                        <p className="text-xs text-emerald-700 font-semibold">Active Hospital Card</p>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 font-mono text-center pt-2 border-t border-slate-200">
                      ||| | ||||| || |||| |||||| ||| (Barcode)
                    </div>
                  </div>
                )}

                {activeTab === 'consultation_summary' && (
                  <div className="space-y-2 text-xs">
                    <div className="bg-slate-100 px-2 py-1 font-semibold text-slate-800 rounded text-xs">
                      Physiotherapy Clinical Assessment
                    </div>
                    <p className="text-slate-700">
                      <span className="font-semibold">Chief Complaint:</span> Low back pain with radiation to left leg x 3 weeks.
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Pain Assessment:</span> Starting VAS 7/10, Lumbar flexion restricted.
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Plan:</span> Lumbar traction 5 sessions, Core strengthening exercises.
                    </p>
                    <div className="pt-4 flex justify-end">
                      <div className="text-center text-xs text-slate-500 border-t border-slate-500 w-36 pt-1">
                        Consultant Doctor
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Document Bottom: Letterhead Footer */}
            <div className="mt-4 border-t-2 border-[#9E1B42] pt-2 text-center text-xs text-slate-600 space-y-0.5">
              {footerHi ? (
                <p lang="hi" className="font-medium text-slate-800">
                  {footerHi}
                </p>
              ) : (
                <p lang="hi" className="font-medium text-slate-800">
                  क्लिनिक: 1. नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301
                </p>
              )}
              {footerEn ? (
                <p className="text-slate-600 font-medium">
                  {footerEn}
                </p>
              ) : (
                <p className="text-slate-500">
                  Phone: +91 6182 000000 | Emergency 24x7
                </p>
              )}
            </div>
          </div>

          {/* Historical Reprint Snapshot callout note */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-1">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <span>Historical Reprint Snapshot Rule (D-20-05, D-20-06)</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              When print templates are updated, changes apply immediately to newly issued documents. Historical reprints (Receipts, Prescriptions, Consultation Summaries) retain the stored template version and patient snapshot captured at original issuance, marked DUPLICATE.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
