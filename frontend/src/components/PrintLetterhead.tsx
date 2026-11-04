import type { ReactNode } from 'react'

/**
 * Shared letterhead for A4 hospital documents, matching the approved SAMPLE.pdf:
 * crimson banner, both doctors around the caduceus, ruled patient strip, address footer.
 * Colours are fixed here (not theme-driven) because print output must not change with the UI.
 */
export const PRINT_CRIMSON = '#9E1B42'
export const PRINT_INK = '#7A1B3C'
const PURPLE = '#7131A0'
const GREEN = '#15803D'

const LOGO_SRC = '/assets/kalyan_hospital_logo.png'
const CADUCEUS_SRC = '/assets/caduceus_emblem.png'

/** Used only when the clinic settings have no addresses configured. */
export const DEFAULT_CLINIC_ADDRESSES = [
  'क्लिनिक: 1. नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301',
  'क्लिनिक: 2. श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर, जिला - भोजपुर (बिहार) - 802206',
]

const DOCTORS = [
  {
    hindi: 'डॉ० मदन मोहन द्विवेदी',
    english: 'Dr. Madan Mohan Dwivedi',
    lines: [
      'D.P.T (Pat.), O.C.T.M. (Delhi)',
      'O.C.S.P. (Gwaliar), M.B.S.A.P.O. (Bihar)',
      'Sr. Diploma Music (Allahabad)',
    ],
    boldLines: ['SENIOR PHYSIOTHERAPIST', 'SPORTS PHYSIOTHERAPIST'],
    afterBold: ['Ex Sadar Hospital, Arrah (Bhojpur)'],
    honour: 'फिजियोरत्न से सम्मानित',
  },
  {
    hindi: 'डॉ० चंदन कुमार द्विवेदी',
    english: 'Dr. Chandan Kr. Dwivedi',
    lines: [
      'B.P.T. (RGUHS) Bangalore, M.I.A.P.',
      'CDNT - Bangalore, CCT - Bangalore',
      'Ex. INT. NIMHANS - Bangalore',
      'Ex. INT. APOLLO - Bangalore',
      'Ex. INT. RMH - Bangalore',
      'FMATS - Varanasi, UP',
    ],
    boldLines: [] as string[],
    afterBold: [] as string[],
    honour: 'फिजियोथेरेपिस्ट',
  },
]

export function LetterheadBanner({ clinicName }: { clinicName: string }) {
  return (
    <div
      data-testid="letterhead-banner"
      className="grid grid-cols-[30mm_1fr_30mm] items-center px-3 py-1.5 text-white"
      style={{ backgroundColor: PRINT_CRIMSON }}
    >
      <img src={LOGO_SRC} alt="Kalyan Hospital logo" className="h-[28mm] w-[28mm] object-contain" />
      <div className="text-center">
        <h1 className="text-[36px] font-extrabold uppercase leading-none tracking-[0.12em]">
          {clinicName}
        </h1>
        <p className="mt-1.5 font-serif text-[13px] font-bold uppercase tracking-[0.32em]">
          Physiotherapy Department
        </p>
      </div>
      <span />
    </div>
  )
}

export function LetterheadDoctors() {
  return (
    <div className="mt-2 grid grid-cols-[1fr_40mm_1fr] items-start gap-2 text-center">
      {[DOCTORS[0], null, DOCTORS[1]].map((doctor, index) =>
        doctor ? (
          <div key={doctor.english}>
            <p className="text-[17px] font-bold leading-tight" style={{ color: PURPLE }}>
              {doctor.hindi}
            </p>
            <p
              className="mb-1 font-serif text-[16px] font-bold italic leading-tight"
              style={{ color: PRINT_CRIMSON }}
            >
              {doctor.english}
            </p>
            <div className="text-[11px] leading-[1.3] text-black">
              {doctor.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {doctor.boldLines.map((line) => (
                <p key={line} className="font-bold">
                  {line}
                </p>
              ))}
              {doctor.afterBold.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <p className="mt-1 text-[13px] font-bold" style={{ color: GREEN }}>
              {doctor.honour}
            </p>
          </div>
        ) : (
          <img
            key={`caduceus-${index}`}
            src={CADUCEUS_SRC}
            alt="Caduceus emblem"
            className="mx-auto mt-3 h-[38mm] w-auto object-contain"
          />
        ),
      )}
    </div>
  )
}

/** One strip cell: italic label followed by a dotted value line (blank when no value). */
function StripField({ label, value, className = '' }: { label: string; value?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end gap-1.5 ${className}`}>
      <span className="font-serif text-[13px] italic text-slate-600">{label}</span>
      <span className="min-h-[16px] flex-1 truncate border-b border-dotted border-slate-600 px-1 font-sans text-[13px] font-semibold text-slate-900">
        {value}
      </span>
    </div>
  )
}

export interface PatientStripValues {
  name?: string
  ageSex?: string
  date?: string
  address?: string
  reference?: string
}

export function PatientStrip({ values }: { values: PatientStripValues }) {
  return (
    <div className="mt-2 space-y-1.5 border-y border-black py-1.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-4">
        <StripField label="Name" value={values.name} />
        <StripField label="Age / Sex" value={values.ageSex} className="w-[48mm]" />
        <StripField label="Date" value={values.date} className="w-[40mm]" />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <StripField label="Add." value={values.address} />
        <StripField label="Ref." value={values.reference} className="w-[88mm]" />
      </div>
    </div>
  )
}

export function LetterheadFooter({ addresses }: { addresses?: string[] }) {
  const lines = addresses && addresses.length > 0 ? addresses : DEFAULT_CLINIC_ADDRESSES
  return (
    <div
      data-testid="letterhead-footer"
      className="px-2 py-1 text-center text-[11px] font-bold leading-snug text-white"
      style={{ backgroundColor: PRINT_CRIMSON }}
    >
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}
