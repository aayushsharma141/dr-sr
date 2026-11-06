import React from 'react'
import type { EncounterRead, PatientOut } from '../api/types'
import { Modal } from './Modal'
import { useClinicSettings } from '../api/queries'
import {
  LetterheadBanner,
  LetterheadDoctors,
  LetterheadFooter,
  PatientStrip,
  PRINT_INK,
} from './PrintLetterhead'

export function formatReprintTimestamp(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} at ${hh}:${min}`
}

export interface ConsultationSummaryPrintProps {
  encounter: EncounterRead
  patient?: PatientOut | null
  followUp?: {
    recommended_date?: string | null
    recommended_doctor_id?: number | null
    doctor_name?: string | null
    reception_notes?: string | null
  } | null
  advice?: string
  isReprint?: boolean
  reprintTimestamp?: string
  onClose?: () => void
}

export function ConsultationSummaryPrint({
  encounter,
  patient,
  followUp,
  advice,
  isReprint,
  reprintTimestamp,
  onClose,
}: ConsultationSummaryPrintProps) {
  const { data: settings } = useClinicSettings()

  // Defense-in-depth: Finalisation gate (DWS-09)
  if (!encounter.is_finalised) {
    return (
      <Modal
        open
        title="Consultation Not Finalised"
        onClose={onClose ?? (() => {})}
        dismiss="any"
      >
        <div className="p-6 text-center space-y-3" role="alert" data-testid="unfinalised-summary-block">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xl">
            ⚠️
          </div>
          <h3 className="text-lg font-bold text-neutral-900">
            Cannot Print Consultation Summary
          </h3>
          <p className="text-sm text-neutral-600 max-w-md mx-auto">
            A patient consultation summary can only be printed on hospital letterhead after the encounter has been finalised.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-neutral-800 text-white rounded-md text-sm font-semibold hover:bg-neutral-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  const clinicNameEn = settings?.name_en || 'Kalyan Hospital'
  const addresses = settings?.address_1
    ? [
        `क्लिनिक: 1. ${settings.address_1}`,
        ...(settings.address_2 ? [`क्लिनिक: 2. ${settings.address_2}`] : []),
      ]
    : undefined

  const consultationDate = encounter.encounter_date
    ? new Date(encounter.encounter_date).toLocaleDateString('en-IN')
    : new Date().toLocaleDateString('en-IN')

  const patientAge = patient?.age_years !== undefined ? `${patient.age_years} Y` : ''
  const patientGender = patient?.gender ? (patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender) : ''
  const ageSexCombined = [patientAge, patientGender].filter(Boolean).join(' / ')

  // Determine reprint text
  const shouldRenderReprint = Boolean(isReprint || reprintTimestamp)
  const stampText = reprintTimestamp || formatReprintTimestamp(new Date())

  const careAdvice = advice || encounter.clinical_notes || 'Routine clinical precautions and care advice discussed.'

  return (
    <Modal
      open
      print="a4"
      title="Patient Consultation Summary"
      onClose={onClose ?? (() => {})}
      dismiss="any"
      className="max-w-4xl"
    >
      {/* Screen action controls - hidden during printing */}
      <div className="flex flex-wrap justify-end gap-3 print:hidden mb-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="cursor-pointer rounded-lg bg-[#8E1C3D] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#731631]"
        >
          Print Consultation Summary (प्रिंट करें)
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-gray-800"
          >
            Close (बंद करें)
          </button>
        )}
      </div>

      {/* Printable single A4 sheet on hospital letterhead */}
      <div
        className="printable-sheet mx-auto w-[198mm] max-w-full bg-white p-3 text-slate-900 print:mt-0 print:w-full print:p-0 print:shadow-none"
        data-testid="consultation-summary-sheet"
      >
        <LetterheadBanner clinicName={clinicNameEn} />
        <LetterheadDoctors />
        
        {/* Patient identity strip */}
        <PatientStrip
          values={{
            name: encounter.patient_name || patient?.full_name,
            ageSex: ageSexCombined,
            date: consultationDate,
            address: patient?.address,
          }}
        />

        <div className="mt-2 flex items-center justify-between text-[12px] border-b border-slate-200 pb-2">
          <span>
            <span className="font-bold text-slate-600">Patient URN (मरीज क्र.):</span>{' '}
            <span className="font-mono font-bold" style={{ color: PRINT_INK }}>
              {encounter.patient_urn || patient?.urn}
            </span>
          </span>
          <span>
            <span className="font-bold text-slate-600">Consulting Doctor (परामर्शदाता चिकित्सक):</span>{' '}
            <span className="font-semibold">{encounter.doctor_name}</span>
          </span>
        </div>

        {/* Document Title */}
        <div className="my-2.5 text-center">
          <h2
            className="text-[15px] font-bold tracking-wide uppercase"
            style={{ color: PRINT_INK }}
          >
            Patient Consultation Summary / मरीज परामर्श सारांश
          </h2>
        </div>

        <div className="space-y-3.5 text-sm">
          {/* Section 1: Chief Complaints & Clinical History */}
          <section className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
              Chief Complaints / मुख्य शिकायतें
            </h3>
            <p className="text-slate-800 text-[13px] whitespace-pre-wrap leading-relaxed">
              {encounter.symptoms || 'None recorded'}
            </p>
          </section>

          {/* Section 2: Clinical Diagnosis */}
          <section className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
              Diagnosis / निदान
            </h3>
            <p className="text-slate-900 font-semibold text-[13px] leading-relaxed">
              {encounter.diagnosis || 'Clinical evaluation ongoing'}
            </p>
          </section>

          {/* Section 3: Treatment & Care Advice */}
          <section className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
              Advice / परामर्श एवं सलाह
            </h3>
            <p className="text-slate-800 text-[13px] whitespace-pre-wrap leading-relaxed">
              {careAdvice}
            </p>
          </section>

          {/* Section 4: Recommended Follow-up Review */}
          <section className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
              Follow-up / पुनः परीक्षण
            </h3>
            <div className="text-[13px] text-slate-800 flex flex-wrap items-center gap-x-6 gap-y-1">
              <div>
                <span className="text-slate-600 font-medium">Recommended Date: </span>
                <span className="font-semibold text-slate-900">
                  {followUp?.recommended_date
                    ? new Date(followUp.recommended_date).toLocaleDateString('en-IN')
                    : 'As advised clinically'}
                </span>
              </div>
              <div>
                <span className="text-slate-600 font-medium">Consulting Doctor: </span>
                <span className="font-semibold text-slate-900">
                  {followUp?.doctor_name || encounter.doctor_name}
                </span>
              </div>
            </div>
            {followUp?.reception_notes && (
              <p className="text-xs text-slate-600 italic mt-1">
                Instructions: {followUp.reception_notes}
              </p>
            )}
          </section>

          {/* Guarantee: Strict Medication Exclusion Disclaimer (T-19-12, D-19-29) */}
          <div className="rounded border border-amber-200 bg-amber-50/60 p-2 text-center text-xs text-amber-900">
            <p className="font-semibold">
              Notice: For prescribed medications, refer exclusively to the authorised Kalyan Hospital Prescription Slip.
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              (दवाओं के विवरण के लिए केवल अधिकृत प्रिस्क्रिप्शन पर्ची मान्य है।)
            </p>
          </div>
        </div>

        {/* Doctor signature box */}
        <div className="mt-8 mb-4 flex justify-between items-end px-2">
          {/* Reprint timestamp note (if reprint active) */}
          <div className="text-[11px] text-slate-500 italic">
            {shouldRenderReprint && (
              <p data-testid="reprint-stamp">
                Reprinted on: {stampText}
              </p>
            )}
          </div>

          <div className="text-center w-64 border-t border-slate-700 pt-1.5">
            <p className="font-bold text-[13px] text-slate-900">
              {encounter.doctor_name || 'Consulting Doctor'}
            </p>
            <p className="text-[11px] text-slate-600 font-serif italic">
              Doctor's Signature / चिकित्सक के हस्ताक्षर
            </p>
          </div>
        </div>

        <LetterheadFooter addresses={addresses} />
      </div>
    </Modal>
  )
}
