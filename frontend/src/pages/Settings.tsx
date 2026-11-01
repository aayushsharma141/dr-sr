import { useState, useEffect, type FormEvent } from 'react'
import { useClinicSettings, useUpdateClinicSettings, useMe } from '../api/queries'
import { ApiError } from '../api/client'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import type { ClinicSettingsUpdate } from '../api/types'

export function Settings() {
  const { data: me } = useMe()
  const { data: settings, isPending, isError, error, refetch } = useClinicSettings()
  const updateMutation = useUpdateClinicSettings()

  const [nameEn, setNameEn] = useState('')
  const [nameHi, setNameHi] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [receiptSequenceCycle, setReceiptSequenceCycle] = useState<'FINANCIAL_YEAR' | 'CALENDAR_YEAR'>('FINANCIAL_YEAR')
  const [printHeaderEn, setPrintHeaderEn] = useState('')
  const [printHeaderHi, setPrintHeaderHi] = useState('')
  const [printFooterEn, setPrintFooterEn] = useState('')
  const [printFooterHi, setPrintFooterHi] = useState('')
  const [consultationValidityDays, setConsultationValidityDays] = useState(7)
  const [versionId, setVersionId] = useState(1)

  const [isConflict, setIsConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setNameEn(settings.name_en)
      setNameHi(settings.name_hi)
      setAddress1(settings.address_1)
      setAddress2(settings.address_2 || '')
      setPhone(settings.phone)
      setEmail(settings.email || '')
      setReceiptSequenceCycle(settings.receipt_sequence_cycle)
      setPrintHeaderEn(settings.print_header_en || '')
      setPrintHeaderHi(settings.print_header_hi || '')
      setPrintFooterEn(settings.print_footer_en || '')
      setPrintFooterHi(settings.print_footer_hi || '')
      setConsultationValidityDays(settings.consultation_validity_days)
      setVersionId(settings.version_id)
    }
  }, [settings])

  const handleReload = async () => {
    setIsReloading(true)
    setErrorMessage(null)
    try {
      const res = await refetch()
      if (res.data) {
        setNameEn(res.data.name_en)
        setNameHi(res.data.name_hi)
        setAddress1(res.data.address_1)
        setAddress2(res.data.address_2 || '')
        setPhone(res.data.phone)
        setEmail(res.data.email || '')
        setReceiptSequenceCycle(res.data.receipt_sequence_cycle)
        setPrintHeaderEn(res.data.print_header_en || '')
        setPrintHeaderHi(res.data.print_header_hi || '')
        setPrintFooterEn(res.data.print_footer_en || '')
        setPrintFooterHi(res.data.print_footer_hi || '')
        setConsultationValidityDays(res.data.consultation_validity_days)
        setVersionId(res.data.version_id)
      }
      setIsConflict(false)
    } finally {
      setIsReloading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaveSuccess(false)
    setErrorMessage(null)

    const payload: ClinicSettingsUpdate = {
      name_en: nameEn.trim(),
      name_hi: nameHi.trim(),
      address_1: address1.trim(),
      address_2: address2.trim() || null,
      phone: phone.trim(),
      email: email.trim() || null,
      receipt_sequence_cycle: receiptSequenceCycle,
      print_header_en: printHeaderEn.trim() || null,
      print_header_hi: printHeaderHi.trim() || null,
      print_footer_en: printFooterEn.trim() || null,
      print_footer_hi: printFooterHi.trim() || null,
      consultation_validity_days: Number(consultationValidityDays),
      version_id: versionId,
    }

    try {
      const updated = await updateMutation.mutateAsync(payload)
      setVersionId(updated.version_id)
      setIsConflict(false)
      setSaveSuccess(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsConflict(true)
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update settings')
      }
    }
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Clinic Settings</h2>
            <p className="text-sm text-neutral-500">
              Manage bilingual clinic identity, addresses, and print configuration
            </p>
          </div>
        </div>

        {isConflict && (
          <ConflictBanner onReload={handleReload} isReloading={isReloading} />
        )}

        {saveSuccess && (
          <div role="status" className="p-4 bg-green-50 border border-green-200 rounded text-green-900 text-sm">
            Clinic settings saved successfully.
          </div>
        )}

        {errorMessage && (
          <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded text-red-900 text-sm">
            {errorMessage}
          </div>
        )}

        {isPending ? (
          <p className="text-sm text-neutral-500 py-8 text-center">Loading settings...</p>
        ) : isError ? (
          <p className="text-sm text-red-600 py-8 text-center">
            {error instanceof Error ? error.message : 'Failed to load clinic settings.'}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-neutral-200 p-6 shadow-xs space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="settings-name-en" className="block text-sm font-medium text-neutral-800 mb-1">
                  Clinic Name (English)
                </label>
                <input
                  id="settings-name-en"
                  type="text"
                  required
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-name-hi" className="block text-sm font-medium text-neutral-800 mb-1">
                  Clinic Name (Hindi)
                </label>
                <input
                  id="settings-name-hi"
                  type="text"
                  required
                  value={nameHi}
                  onChange={(e) => setNameHi(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-phone" className="block text-sm font-medium text-neutral-800 mb-1">
                  Phone Number
                </label>
                <input
                  id="settings-phone"
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-email" className="block text-sm font-medium text-neutral-800 mb-1">
                  Email
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="settings-address-1" className="block text-sm font-medium text-neutral-800 mb-1">
                  Primary Address
                </label>
                <input
                  id="settings-address-1"
                  type="text"
                  required
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="settings-address-2" className="block text-sm font-medium text-neutral-800 mb-1">
                  Secondary Address (Optional)
                </label>
                <input
                  id="settings-address-2"
                  type="text"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-receipt-cycle" className="block text-sm font-medium text-neutral-800 mb-1">
                  Receipt Sequence Cycle
                </label>
                <select
                  id="settings-receipt-cycle"
                  value={receiptSequenceCycle}
                  onChange={(e) => setReceiptSequenceCycle(e.target.value as 'FINANCIAL_YEAR' | 'CALENDAR_YEAR')}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-red-800"
                >
                  <option value="FINANCIAL_YEAR">Financial Year (April - March: RCPT-2627-XXXX)</option>
                  <option value="CALENDAR_YEAR">Calendar Year (Jan - Dec: RCPT-2026-XXXX)</option>
                </select>
              </div>

              <div>
                <label htmlFor="settings-validity-days" className="block text-sm font-medium text-neutral-800 mb-1">
                  Consultation Validity (Days)
                </label>
                <input
                  id="settings-validity-days"
                  type="number"
                  required
                  min={1}
                  max={365}
                  value={consultationValidityDays}
                  onChange={(e) => setConsultationValidityDays(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-header-en" className="block text-sm font-medium text-neutral-800 mb-1">
                  Print Header (English)
                </label>
                <textarea
                  id="settings-header-en"
                  rows={2}
                  value={printHeaderEn}
                  onChange={(e) => setPrintHeaderEn(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-header-hi" className="block text-sm font-medium text-neutral-800 mb-1">
                  Print Header (Hindi)
                </label>
                <textarea
                  id="settings-header-hi"
                  rows={2}
                  value={printHeaderHi}
                  onChange={(e) => setPrintHeaderHi(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-footer-en" className="block text-sm font-medium text-neutral-800 mb-1">
                  Print Footer (English)
                </label>
                <textarea
                  id="settings-footer-en"
                  rows={2}
                  value={printFooterEn}
                  onChange={(e) => setPrintFooterEn(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>

              <div>
                <label htmlFor="settings-footer-hi" className="block text-sm font-medium text-neutral-800 mb-1">
                  Print Footer (Hindi)
                </label>
                <textarea
                  id="settings-footer-hi"
                  rows={2}
                  value={printFooterHi}
                  onChange={(e) => setPrintFooterHi(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-neutral-200">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  )
}
