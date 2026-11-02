import { createPortal } from 'react-dom'
import type { PrescriptionOut } from '../api/types'
import { useClinicSettings } from '../api/queries'
import {
  LetterheadBanner,
  LetterheadDoctors,
  LetterheadFooter,
  PatientStrip,
  PRINT_INK,
} from './PrintLetterhead'

interface PrescriptionPrintProps {
  prescription: PrescriptionOut
  onClose?: () => void
}

export function PrescriptionPrint({ prescription, onClose }: PrescriptionPrintProps) {
  const { data: settings } = useClinicSettings()

  const clinicNameEn = settings?.name_en || 'Kalyan Hospital'
  const addresses =
    settings?.address_1 && settings?.address_2
      ? [`क्लिनिक: 1. ${settings.address_1}`, `क्लिनिक: 2. ${settings.address_2}`]
      : undefined
  const issuedOn = new Date(prescription.created_at).toLocaleDateString('en-IN')

  // Rendered in a portal on <body> so printing can hide the rest of the app (see index.css),
  // instead of printing the workspace page behind the slip.
  return createPortal(
    <div className="print-portal prescription-print-modal fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 print:static print:block print:overflow-visible print:bg-transparent print:p-0">
      {/* Screen action controls - hidden during printing */}
      <div className="fixed right-4 top-4 z-50 flex gap-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="cursor-pointer rounded-lg bg-red-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-red-800"
        >
          Print Prescription Slip (प्रिंट करें)
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-800"
          >
            Close (बंद करें)
          </button>
        )}
      </div>

      {/* Printable A4 sheet */}
      <div
        className="printable-sheet mx-auto mt-12 w-[198mm] max-w-full bg-white p-3 text-slate-900 shadow-2xl print:mt-0 print:w-full print:p-0 print:shadow-none"
        data-testid="prescription-sheet"
      >
        <LetterheadBanner clinicName={clinicNameEn} />
        <LetterheadDoctors />
        <PatientStrip
          values={{ name: prescription.patient_name, date: issuedOn }}
        />

        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span>
            <span className="font-bold text-slate-600">Patient URN (मरीज क्र.):</span>{' '}
            <span className="font-mono font-bold" style={{ color: PRINT_INK }}>
              {prescription.patient_urn}
            </span>
          </span>
          <span>
            <span className="font-bold text-slate-600">Doctor (चिकित्सक):</span>{' '}
            <span className="font-semibold">{prescription.doctor_name}</span>
          </span>
        </div>

        {prescription.diagnosis && (
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px]">
            <span className="font-bold text-slate-600">Diagnosis (रोग निदान):</span>{' '}
            <span className="font-semibold">{prescription.diagnosis}</span>
          </div>
        )}

        {/* Rx symbol and medication table */}
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-serif text-3xl font-black leading-none" style={{ color: PRINT_INK }}>
              ℞
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Prescribed Medications (दवा का विवरण)
            </span>
          </div>

          <table className="w-full border-collapse border border-slate-300 text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-300 bg-rose-50" style={{ color: PRINT_INK }}>
                <th className="w-8 border-r border-slate-300 px-2 py-1.5 text-center">#</th>
                <th className="border-r border-slate-300 px-2 py-1.5">Medicine Name (दवा का नाम)</th>
                <th className="w-24 border-r border-slate-300 px-2 py-1.5">Dosage (मात्रा)</th>
                <th className="w-24 border-r border-slate-300 px-2 py-1.5">Frequency (आवृत्ति)</th>
                <th className="w-20 border-r border-slate-300 px-2 py-1.5">Days (दिन)</th>
                <th className="px-2 py-1.5">Instructions (निर्देश)</th>
              </tr>
            </thead>
            <tbody>
              {prescription.items.map((item) => (
                <tr key={item.id} className="break-inside-avoid border-b border-slate-200">
                  <td className="border-r border-slate-200 px-2 py-1.5 text-center font-mono text-slate-500">
                    {item.item_order}
                  </td>
                  <td className="border-r border-slate-200 px-2 py-1.5 font-semibold">
                    {item.medicine_name}
                  </td>
                  <td className="border-r border-slate-200 px-2 py-1.5">{item.dosage}</td>
                  <td className="border-r border-slate-200 px-2 py-1.5 font-medium">{item.frequency}</td>
                  <td className="border-r border-slate-200 px-2 py-1.5">{item.duration_days} d</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-600">{item.instructions || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Advice and follow-up */}
        {(prescription.general_advice || prescription.dietary_advice) && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            {prescription.general_advice && (
              <div className="break-inside-avoid rounded border border-slate-200 bg-slate-50 p-2">
                <span className="mb-0.5 block font-bold text-slate-600">
                  General Advice (सामान्य सलाह):
                </span>
                <p className="whitespace-pre-wrap">{prescription.general_advice}</p>
              </div>
            )}
            {prescription.dietary_advice && (
              <div className="break-inside-avoid rounded border border-slate-200 bg-slate-50 p-2">
                <span className="mb-0.5 block font-bold text-slate-600">
                  Dietary Guidance (आहार संबंधी सलाह):
                </span>
                <p className="whitespace-pre-wrap">{prescription.dietary_advice}</p>
              </div>
            )}
          </div>
        )}

        {prescription.follow_up_date && (
          <div
            className="mt-3 break-inside-avoid rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-medium"
            style={{ color: PRINT_INK }}
          >
            Next Consultation / Follow-up (पुनः परामर्श दिनांक):{' '}
            <span className="font-bold">
              {new Date(prescription.follow_up_date).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}

        {/* Doctor signature */}
        <div className="mt-10 flex break-inside-avoid items-end justify-between text-[11px]">
          <p className="text-slate-500">Computer generated prescription slip · Valid with clinician seal</p>
          <div className="w-60 border-t border-black pt-1 text-center">
            <p className="font-bold">{prescription.doctor_name}</p>
            <p className="text-slate-600">Authorised Signatory (चिकित्सक हस्ताक्षर)</p>
          </div>
        </div>

        <div className="mt-3 break-inside-avoid">
          <LetterheadFooter addresses={addresses} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
