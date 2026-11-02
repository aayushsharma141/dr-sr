import type { PrescriptionOut } from '../api/types'
import { useClinicSettings } from '../api/queries'

interface PrescriptionPrintProps {
  prescription: PrescriptionOut
  onClose?: () => void
}

export function PrescriptionPrint({ prescription, onClose }: PrescriptionPrintProps) {
  const { data: settings } = useClinicSettings()

  const clinicNameEn = settings?.name_en || 'Kalyan Hospital & Rehabilitation Centre'
  const clinicNameHi = settings?.name_hi || 'कल्याण अस्पताल एवं पुनर्वास केंद्र'
  const clinicAddress = settings?.address_1 || 'Ara, Bhojpur, Bihar - 802301'
  const clinicPhone = settings?.phone || '+91 98765 43210'

  return (
    <div className="prescription-print-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      {/* Screen action controls - hidden during printing */}
      <div className="fixed top-4 right-4 flex gap-3 no-print z-50">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-teal-700 transition"
        >
          Print Prescription Slip (प्रिंट करें)
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-gray-800 transition"
          >
            Close (बंद करें)
          </button>
        )}
      </div>

      {/* Printable Sheet */}
      <div className="printable-sheet w-full max-w-3xl rounded-xl bg-white p-8 text-gray-900 shadow-2xl print:m-0 print:w-full print:max-w-none print:p-6 print:shadow-none">
        {/* Hospital Header */}
        <div className="border-b-2 border-teal-800 pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-teal-900 font-serif">
            {clinicNameEn}
          </h1>
          <p className="text-lg font-medium text-teal-800">{clinicNameHi}</p>
          <p className="text-xs text-gray-600 mt-1">
            {clinicAddress} | फोन: {clinicPhone}
          </p>
        </div>

        {/* Patient Demographic Strip */}
        <div className="my-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-gray-50 p-3 text-sm border border-gray-200">
          <div>
            <span className="font-semibold text-gray-700">Patient URN (मरीज क्र.):</span>{' '}
            <span className="font-mono font-bold text-teal-900">{prescription.patient_urn}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Date (दिनांक):</span>{' '}
            <span>{new Date(prescription.created_at).toLocaleDateString('en-IN')}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Name (मरीज का नाम):</span>{' '}
            <span className="font-bold text-gray-900">{prescription.patient_name}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Doctor (चिकित्सक):</span>{' '}
            <span className="font-semibold text-teal-900">{prescription.doctor_name}</span>
          </div>
          {prescription.diagnosis && (
            <div className="col-span-2 pt-1 border-t border-gray-200">
              <span className="font-semibold text-gray-700">Diagnosis (रोग निदान):</span>{' '}
              <span className="font-medium text-gray-900">{prescription.diagnosis}</span>
            </div>
          )}
        </div>

        {/* Rx Symbol & Medication Table */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl font-serif font-black text-teal-950">℞</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Prescribed Medications (दवा का विवरण)
            </span>
          </div>

          <table className="w-full text-left text-sm border border-gray-300 border-collapse">
            <thead>
              <tr className="bg-teal-50/80 text-teal-950 border-b border-gray-300">
                <th className="py-2 px-3 w-10 border-r border-gray-300 text-center">#</th>
                <th className="py-2 px-3 border-r border-gray-300">Medicine Name (दवा का नाम)</th>
                <th className="py-2 px-3 w-28 border-r border-gray-300">Dosage (मात्रा)</th>
                <th className="py-2 px-3 w-28 border-r border-gray-300">Frequency (आवृत्ति)</th>
                <th className="py-2 px-3 w-24 border-r border-gray-300">Days (दिन)</th>
                <th className="py-2 px-3">Instructions (निर्देश)</th>
              </tr>
            </thead>
            <tbody>
              {prescription.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50/50">
                  <td className="py-2.5 px-3 border-r border-gray-200 text-center font-mono text-gray-500">
                    {item.item_order}
                  </td>
                  <td className="py-2.5 px-3 border-r border-gray-200 font-semibold text-gray-900">
                    {item.medicine_name}
                  </td>
                  <td className="py-2.5 px-3 border-r border-gray-200 text-gray-800">
                    {item.dosage}
                  </td>
                  <td className="py-2.5 px-3 border-r border-gray-200 font-medium text-teal-900">
                    {item.frequency}
                  </td>
                  <td className="py-2.5 px-3 border-r border-gray-200 text-gray-800">
                    {item.duration_days} d
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-600">
                    {item.instructions || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Advice and Follow-up */}
        <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
          {prescription.general_advice && (
            <div className="rounded border border-gray-200 p-2.5 bg-gray-50/50">
              <span className="font-semibold text-gray-700 block mb-0.5">
                General Advice (सामान्य सलाह):
              </span>
              <p className="text-gray-800 whitespace-pre-wrap">{prescription.general_advice}</p>
            </div>
          )}

          {prescription.dietary_advice && (
            <div className="rounded border border-gray-200 p-2.5 bg-gray-50/50">
              <span className="font-semibold text-gray-700 block mb-0.5">
                Dietary Guidance (आहार संबंधी सलाह):
              </span>
              <p className="text-gray-800 whitespace-pre-wrap">{prescription.dietary_advice}</p>
            </div>
          )}
        </div>

        {/* Follow up date */}
        {prescription.follow_up_date && (
          <div className="mt-4 text-xs font-medium text-teal-900 bg-teal-50 border border-teal-200 p-2 rounded">
            Next Consultation / Follow-up (पुनः परामर्श दिनांक):{' '}
            <span className="font-bold">
              {new Date(prescription.follow_up_date).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}

        {/* Doctor Signature */}
        <div className="mt-16 flex justify-between items-end pt-4 border-t border-gray-300 text-xs">
          <div className="text-gray-500">
            Computer generated prescription slip · Valid with clinician seal
          </div>
          <div className="text-center w-52">
            <div className="border-b border-gray-400 mb-1 h-10"></div>
            <p className="font-bold text-gray-900">{prescription.doctor_name}</p>
            <p className="text-gray-600">Authorised Signatory (चिकित्सक हस्ताक्षर)</p>
          </div>
        </div>
      </div>
    </div>
  )
}
