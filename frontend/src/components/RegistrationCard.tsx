import type { ReactNode } from 'react'
import type { PatientOut, ClinicSettingsOut } from '../api/types'
import {
  LetterheadBanner,
  LetterheadContactLine,
  LetterheadDoctors,
  LetterheadHeaderNote,
  LetterheadFooter,
  PatientStrip,
  PRINT_INK,
} from './PrintLetterhead'

interface RegistrationCardProps {
  patient: PatientOut
  settings?: ClinicSettingsOut | null
  /** Returns to the patient record. Shown as the "Back" control when provided. */
  onBack?: () => void
}

/**
 * A labelled line. Filled from the record when known, otherwise a dotted line to write on.
 * Rendered as a description list so screen readers announce each label with its value.
 */
function FieldLine({
  label,
  children,
  alert = false,
}: {
  label: string
  children?: ReactNode
  alert?: boolean
}) {
  const blank = children === undefined || children === null || children === ''
  return (
    <dl className="flex items-end gap-2 text-[13px]">
      <dt className="shrink-0 font-bold text-slate-600">{label}</dt>
      <dd
        className={`min-h-[18px] flex-1 border-b border-dotted border-slate-600 px-1 font-semibold ${
          alert ? 'text-red-800' : 'text-slate-900'
        }`}
      >
        {children}
        {blank && <span className="sr-only">Blank, to be filled in by hand</span>}
      </dd>
    </dl>
  )
}

function genderLabel(gender: string): string {
  return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Other'
}

export function RegistrationCard({ patient, settings, onBack }: RegistrationCardProps) {
  const clinicNameEn = settings?.name_en || 'Kalyan Hospital'
  const clinicNameHi = settings?.name_hi
  const printFooterEn = settings?.print_footer_en
  const printFooterHi = settings?.print_footer_hi

  const addresses = settings?.address_1
    ? [
        `क्लिनिक: 1. ${settings.address_1}`,
        ...(settings.address_2 ? [`क्लिनिक: 2. ${settings.address_2}`] : []),
      ]
    : undefined

  const fullAddress = [patient.address, patient.district, patient.state].filter(Boolean).join(', ')
  const ageSex = `${patient.age_years} Years / ${genderLabel(patient.gender)}`
  const registeredOn = new Date(patient.created_at).toLocaleDateString('en-IN')

  return (
    <section
      aria-labelledby="registration-card-title"
      className="mx-auto max-w-[210mm] rounded-lg border border-neutral-300 bg-white p-4 shadow-sm print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none"
    >
      {/* Essential on-screen controls - hidden when printing */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3 print:hidden">
        <div>
          <h1 id="registration-card-title" className="text-lg font-bold text-neutral-900">
            Patient Registration Card Preview
          </h1>
          <p className="text-sm text-neutral-600">Standard A4 patient registration record</p>
        </div>
        <div role="group" aria-label="Card actions" className="flex flex-wrap items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="min-h-11 cursor-pointer rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-900"
            >
              Back to patient record
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 cursor-pointer rounded bg-red-900 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-900"
          >
            Print card (A4)
          </button>
        </div>
      </header>

      {/* Printable A4 sheet */}
      <div
        className="registration-card-sheet mx-auto w-[198mm] max-w-full font-sans text-slate-900 print:w-full"
        data-testid="registration-sheet"
      >
        <LetterheadBanner clinicName={clinicNameEn} clinicNameHi={clinicNameHi} />
        <LetterheadHeaderNote settings={settings} />
        <LetterheadDoctors />
        <PatientStrip
          values={{
            name: patient.full_name,
            ageSex,
            date: registeredOn,
            address: fullAddress,
          }}
        />

        <div className="mt-3 flex items-center justify-between border-b border-slate-200 pb-1.5">
          <h2 className="text-[14px] font-extrabold uppercase" style={{ color: PRINT_INK }}>
            Patient Registration &amp; Treatment Record
          </h2>
          <span
            className="rounded px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: PRINT_INK }}
          >
            {`RECORD #${patient.urn}`}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_35mm] gap-4">
          <div className="space-y-2.5">
            <FieldLine label="1. Serial / URN No.:">
              <span className="font-mono" style={{ color: PRINT_INK }}>
                {patient.urn}
              </span>
            </FieldLine>
            <FieldLine label="2. Patient Name:">{patient.full_name}</FieldLine>
            <FieldLine label="3. Age / 4. Sex:">{ageSex}</FieldLine>
            {patient.dob && <FieldLine label="Date of Birth:">{patient.dob}</FieldLine>}
            <FieldLine label="5. Address:">{fullAddress}</FieldLine>
            <FieldLine label="6. Mobile No.:">{patient.mobile}</FieldLine>
            <FieldLine label="Guardian / Spouse:">{patient.guardian_name}</FieldLine>
            <FieldLine label="Emergency Contact:">{patient.emergency_contact}</FieldLine>
            <FieldLine label="Allergies / Alert:" alert>
              {patient.allergies}
            </FieldLine>
          </div>

          <div
            className="flex h-[45mm] w-[35mm] items-center justify-center overflow-hidden border"
            style={{ borderColor: '#4A7AB8' }}
          >
            {patient.photo_path ? (
              <img
                src={`/api/patients/${patient.id}/photo`}
                alt="Patient photo"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="px-1 text-center text-[10px] text-slate-400">
                Patient Photo
                <br />
                35 mm × 45 mm
              </span>
            )}
          </div>
        </div>

        <div className="mt-2.5 space-y-2.5">
          <div className="flex items-center gap-3 text-[13px]" role="group" aria-label="Consulting doctor">
            <span className="font-bold text-slate-600">Consulting Doctor:</span>
            <span>
              <span aria-hidden="true">☐ </span>Dr. Madan Mohan Dwivedi
              <span className="sr-only"> (tick one)</span>
            </span>
            <span>
              <span aria-hidden="true">☐ </span>Dr. Chandan Kr. Dwivedi
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldLine label="7. Patient In (Date & Time):" />
            <FieldLine label="8. Patient Out:" />
          </div>
          <FieldLine label="9. Reference / Referred By:" />
          <FieldLine label="10. Patient Condition:" />
          <FieldLine label="11. No. of Sessions:" />
          {patient.notes && (
            <FieldLine label="Clinical Remarks:">{patient.notes}</FieldLine>
          )}
        </div>

        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[12px] font-bold" style={{ color: PRINT_INK }}>
            12. Payment Details:
          </p>
          <div className="mt-1 grid grid-cols-3 gap-4">
            {['Total Agreed Fee', 'Amount Paid', 'Remaining Balance'].map((label) => (
              <div key={label}>
                <p className="text-[9.5px] font-bold uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-[13px] font-bold">₹ ____________________</p>
              </div>
            ))}
          </div>
        </div>

        {/* Dual signatures */}
        <div className="mt-12 grid grid-cols-2 gap-16 px-6 text-center text-[11px]">
          <div className="border-t border-black pt-1">
            <p className="font-bold">Patient / Attendant Signature</p>
            <p lang="hi" className="text-[10px] text-slate-500">मरीज / परिचारक के हस्ताक्षर</p>
          </div>
          <div className="border-t border-black pt-1">
            <p className="font-bold">Authorized Signatory / Receptionist</p>
            <p lang="hi" className="text-[10px] text-slate-500">
              अधिकृत हस्ताक्षरकर्ता{clinicNameHi ? ` (${clinicNameHi})` : ''}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <LetterheadFooter addresses={addresses} />
          <LetterheadContactLine settings={settings} />
          <p className="mt-1 text-center text-[9px] text-slate-500">
            {[printFooterEn, printFooterHi].filter(Boolean).join(' · ')}
            {printFooterEn || printFooterHi ? ' · ' : ''}
            Please bring this card on every visit. Valid for {settings?.consultation_validity_days || 15} days from date of
            issue.
          </p>
        </div>
      </div>
    </section>
  )
}
