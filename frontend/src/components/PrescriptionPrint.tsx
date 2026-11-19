import type { PrescriptionOut } from '../api/types'
import { Modal } from './Modal'
import * as queries from '../api/queries'
import { withDoctorTitle } from '../format'
import {
  isHardcodedPhysioDoctor,
  isPhysiotherapyDepartment,
  LetterheadBanner,
  LetterheadContactLine,
  LetterheadDoctors,
  LetterheadHeaderNote,
  LetterheadFooter,
  PatientStrip,
  PRINT_INK,
} from './PrintLetterhead'

interface PrescriptionPrintProps {
  prescription: PrescriptionOut
  departmentName?: string | null
  onClose?: () => void
}

function formatIstDate(value: string): string {
  const trimmed = value.trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
}

function nonPrintableWatermarkLabel(status?: PrescriptionOut['status']): string {
  switch (status) {
    case 'DRAFT':
      return 'DRAFT — NOT AUTHORISED (प्रिंट हेतु मान्य नहीं)'
    case 'CANCELLED':
      return 'CANCELLED — VOID (रद्द प्रिस्क्रिप्शन)'
    case 'SUPERSEDED':
      return 'SUPERSEDED — REVISED (संशोधित / अप्रचलित)'
    default:
      return 'NOT AUTHORISED — DO NOT DISPENSE'
  }
}

function getUseDoctorsHook(): typeof queries.useDoctors | null {
  // Vitest module mocks throw on missing exports via a Proxy; guard so tests mocking only useClinicSettings still pass.
  try {
    return typeof queries.useDoctors === 'function' ? queries.useDoctors : null
  } catch {
    return null
  }
}

export function PrescriptionPrint({ prescription, departmentName, onClose }: PrescriptionPrintProps) {
  const { data: settings } = queries.useClinicSettings()
  const useDoctorsHook = getUseDoctorsHook()
  const doctors = useDoctorsHook ? useDoctorsHook(false).data : undefined

  const clinicNameEn = settings?.name_en || 'Kalyan Hospital'
  const addresses = settings?.address_1
    ? [
        `क्लिनिक: 1. ${settings.address_1}`,
        ...(settings.address_2 ? [`क्लिनिक: 2. ${settings.address_2}`] : []),
      ]
    : undefined
  const issuedOn = formatIstDate(prescription.created_at)

  const isPrintable =
    prescription.status !== undefined
      ? prescription.status === 'AUTHORISED' && prescription.is_printable !== false
      : prescription.is_printable ?? false

  const matchedDoctor = doctors?.find((d) => d.id === prescription.doctor_id)
  const doctorDisplayName = withDoctorTitle(prescription.doctor_name)
  const isPhysioDoctor = isHardcodedPhysioDoctor(matchedDoctor?.name_en || prescription.doctor_name)
  const useAuthoringDoctorHeader =
    (Boolean(departmentName?.trim()) && !isPhysiotherapyDepartment(departmentName)) ||
    (!isPhysioDoctor && Boolean(prescription.doctor_name || matchedDoctor))

  const authoringDoctor = useAuthoringDoctorHeader
    ? {
        name: withDoctorTitle(matchedDoctor?.name_en || prescription.doctor_name),
        qualification: matchedDoctor?.qualification ?? null,
        registrationNumber: matchedDoctor?.registration_number ?? null,
      }
    : null

  // Shared Modal renders this as a print portal on <body>, so printing hides the rest of the
  // app (print.css and index.css) instead of printing the workspace page behind the slip.
  return (
    <Modal
      open
      print="a4"
      title="Prescription slip"
      onClose={onClose ?? (() => {})}
      dismiss="any"
      className="max-w-4xl"
    >
      {/* Screen action controls - hidden during printing */}
      <div className="flex flex-wrap items-center justify-end gap-3 print:hidden">
        {!isPrintable && (
          <span className="mr-auto text-xs font-semibold text-red-800">
            Only authorised prescriptions can be printed.
          </span>
        )}
        <button
          type="button"
          disabled={!isPrintable}
          title={
            !isPrintable
              ? `Printing is disabled because prescription status is ${prescription.status ?? 'not authorised'}.`
              : undefined
          }
          onClick={() => {
            if (isPrintable) window.print()
          }}
          className="cursor-pointer rounded-lg bg-red-900 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:opacity-70"
        >
          Print Prescription Slip (प्रिंट करें)
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-gray-800"
          >
            Close (बंद करें)
          </button>
        )}
      </div>

      {/* Printable A4 sheet */}
      <div
        className="printable-sheet mx-auto mt-4 w-[198mm] max-w-full bg-white p-3 text-slate-900 print:mt-0 print:w-full print:p-0 print:shadow-none"
        data-testid="prescription-sheet"
      >
        {/* Non-print:hidden status watermark so native browser Ctrl+P cannot produce a valid-looking slip */}
        {!isPrintable && (
          <div
            role="alert"
            data-testid="rx-status-watermark"
            className="mb-2 rounded border-2 border-dashed border-red-700 bg-red-50 px-3 py-2 text-center text-[13px] font-extrabold uppercase tracking-wider text-red-900"
          >
            {nonPrintableWatermarkLabel(prescription.status)}
          </div>
        )}

        <LetterheadBanner
          clinicName={clinicNameEn}
          clinicNameHi={settings?.name_hi}
          departmentName={departmentName}
          authoringDoctor={authoringDoctor}
          useAuthoringDoctorHeader={useAuthoringDoctorHeader}
        />
        <LetterheadHeaderNote settings={settings} />
        <LetterheadDoctors authoringDoctor={authoringDoctor} />
        <PatientStrip
          values={{
            name: prescription.patient_name,
            date: issuedOn,
            address: prescription.patient_address ?? undefined,
          }}
        />

        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span>
            <span className="font-bold text-slate-600">Patient URN (मरीज क्र.):</span>{' '}
            <span className="font-mono font-bold" style={{ color: PRINT_INK }}>
              {prescription.patient_urn}
            </span>
          </span>
          {prescription.patient_mobile && (
            <span>
              <span className="font-bold text-slate-600">Mobile (मोबाइल):</span>{' '}
              <span className="font-mono font-semibold text-slate-900">{prescription.patient_mobile}</span>
            </span>
          )}
          <span>
            <span className="font-bold text-slate-600">Doctor (चिकित्सक):</span>{' '}
            <span className="font-semibold">{doctorDisplayName}</span>
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
                <th className="w-28 border-r border-slate-300 px-2 py-1.5">Dosage / Route (मात्रा)</th>
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
                    <div>{item.medicine_name}</div>
                    {(item.form || item.strength) && (
                      <div className="text-[11px] font-normal text-slate-600">
                        {[item.form, item.strength].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="border-r border-slate-200 px-2 py-1.5">
                    <div>{item.dosage}</div>
                    {item.route && (
                      <div className="text-[11px] font-medium text-slate-600">{item.route}</div>
                    )}
                  </td>
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
              {formatIstDate(prescription.follow_up_date)}
            </span>
          </div>
        )}

        {/* Doctor signature */}
        <div className="mt-10 flex break-inside-avoid items-end justify-between text-[11px]">
          <p className="text-slate-500">Computer generated prescription slip · Valid with clinician seal</p>
          <div className="w-60 border-t border-black pt-1 text-center">
            <p className="font-bold">{doctorDisplayName}</p>
            <p className="text-slate-600">Authorised Signatory (चिकित्सक हस्ताक्षर)</p>
          </div>
        </div>

        <div className="mt-3 break-inside-avoid">
          <LetterheadFooter addresses={addresses} />
        <LetterheadContactLine settings={settings} />
        </div>
      </div>
    </Modal>
  )
}
