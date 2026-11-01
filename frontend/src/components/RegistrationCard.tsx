import type { PatientOut, ClinicSettingsOut } from '../api/types'

interface RegistrationCardProps {
  patient: PatientOut
  settings?: ClinicSettingsOut | null
  onClose?: () => void
}

export function RegistrationCard({
  patient,
  settings,
  onClose,
}: RegistrationCardProps) {
  const clinicNameEn = settings?.name_en || 'Kalyan Hospital'
  const clinicNameHi = settings?.name_hi || 'कल्याण अस्पताल'
  const clinicAddress1 = settings?.address_1 || 'Station Road, Ara, Bhojpur'
  const clinicAddress2 = settings?.address_2
  const clinicPhone = settings?.phone || '06182-234567'
  const printFooterEn = settings?.print_footer_en || 'Wishing you a speedy recovery.'
  const printFooterHi = settings?.print_footer_hi || 'शीघ्र स्वास्थ्य लाभ की कामना।'

  return (
    <div className="bg-white p-6 max-w-4xl mx-auto border border-neutral-300 rounded-lg shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none">
      {/* On-screen action controls - hidden when printing */}
      <div className="flex items-center justify-between pb-4 mb-6 border-b border-neutral-200 print:hidden">
        <div>
          <h3 className="text-lg font-bold text-neutral-900">Patient Registration Card Preview</h3>
          <p className="text-xs text-neutral-500">Standard A4 Patient Registration Slip</p>
        </div>
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-neutral-300 rounded text-sm font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
            >
              Close
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="px-5 py-2 bg-red-900 text-white rounded text-sm font-medium hover:bg-red-800 cursor-pointer shadow-xs"
          >
            Print Card (A4)
          </button>
        </div>
      </div>

      {/* Printable Sheet Container */}
      <div className="registration-card-sheet print:w-full font-sans text-neutral-900 space-y-6">
        {/* Header */}
        <header className="text-center border-b-2 border-neutral-800 pb-4">
          <h1 className="text-2xl font-black tracking-tight text-neutral-950 uppercase">
            {clinicNameEn}
          </h1>
          {clinicNameHi && (
            <h2 className="text-lg font-bold text-neutral-800 mt-0.5">
              {clinicNameHi}
            </h2>
          )}
          <p className="text-xs text-neutral-700 mt-1">
            {clinicAddress1}{clinicAddress2 ? `, ${clinicAddress2}` : ''} | Phone: {clinicPhone}
          </p>
          {settings?.email && (
            <p className="text-xs text-neutral-600">Email: {settings.email}</p>
          )}
          <div className="mt-3 inline-block px-4 py-1 bg-neutral-100 border border-neutral-300 text-xs font-bold uppercase tracking-wider text-neutral-900">
            Patient Registration Card / रोगी पंजीकरण पत्र
          </div>
        </header>

        {/* URN and Barcode Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-neutral-50 border border-neutral-300 rounded-md print:bg-transparent">
          <div>
            <span className="block text-xs uppercase font-bold text-neutral-500 tracking-wider">
              Universal Record Number (URN)
            </span>
            <span className="text-2xl font-mono font-black text-neutral-950 tracking-wider">
              {patient.urn}
            </span>
            <span className="block text-xs text-neutral-600 mt-0.5">
              Registration Date: {new Date(patient.created_at).toLocaleDateString()}
            </span>
          </div>

          {/* Barcode representation */}
          <div className="mt-3 sm:mt-0 text-center">
            <svg
              className="w-48 h-12"
              viewBox="0 0 200 40"
              xmlns="http://www.w3.org/2000/svg"
              aria-label={`Barcode for ${patient.urn}`}
            >
              {/* Simulated Code 128 barcode pattern */}
              <rect x="5" y="0" width="3" height="40" fill="#000" />
              <rect x="11" y="0" width="2" height="40" fill="#000" />
              <rect x="16" y="0" width="4" height="40" fill="#000" />
              <rect x="23" y="0" width="2" height="40" fill="#000" />
              <rect x="28" y="0" width="5" height="40" fill="#000" />
              <rect x="36" y="0" width="2" height="40" fill="#000" />
              <rect x="42" y="0" width="4" height="40" fill="#000" />
              <rect x="49" y="0" width="2" height="40" fill="#000" />
              <rect x="54" y="0" width="3" height="40" fill="#000" />
              <rect x="60" y="0" width="5" height="40" fill="#000" />
              <rect x="68" y="0" width="2" height="40" fill="#000" />
              <rect x="73" y="0" width="4" height="40" fill="#000" />
              <rect x="80" y="0" width="2" height="40" fill="#000" />
              <rect x="85" y="0" width="5" height="40" fill="#000" />
              <rect x="93" y="0" width="3" height="40" fill="#000" />
              <rect x="99" y="0" width="2" height="40" fill="#000" />
              <rect x="104" y="0" width="4" height="40" fill="#000" />
              <rect x="111" y="0" width="2" height="40" fill="#000" />
              <rect x="116" y="0" width="5" height="40" fill="#000" />
              <rect x="124" y="0" width="2" height="40" fill="#000" />
              <rect x="129" y="0" width="4" height="40" fill="#000" />
              <rect x="136" y="0" width="3" height="40" fill="#000" />
              <rect x="142" y="0" width="2" height="40" fill="#000" />
              <rect x="147" y="0" width="4" height="40" fill="#000" />
              <rect x="154" y="0" width="2" height="40" fill="#000" />
              <rect x="159" y="0" width="5" height="40" fill="#000" />
              <rect x="167" y="0" width="3" height="40" fill="#000" />
              <rect x="173" y="0" width="2" height="40" fill="#000" />
              <rect x="178" y="0" width="4" height="40" fill="#000" />
              <rect x="185" y="0" width="2" height="40" fill="#000" />
              <rect x="190" y="0" width="5" height="40" fill="#000" />
            </svg>
            <span className="block text-[10px] font-mono tracking-widest text-neutral-600 mt-0.5">
              *{patient.urn}*
            </span>
          </div>
        </div>

        {/* Demographics Grid */}
        <div className="border border-neutral-300 rounded-md overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <tbody>
              <tr className="border-b border-neutral-300">
                <th className="w-1/4 p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Patient Full Name
                </th>
                <td className="w-1/4 p-2.5 font-bold text-sm text-neutral-900 border-r border-neutral-300">
                  {patient.full_name}
                </td>
                <th className="w-1/4 p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Guardian / Spouse
                </th>
                <td className="w-1/4 p-2.5 text-neutral-900">
                  {patient.guardian_name}
                </td>
              </tr>
              <tr className="border-b border-neutral-300">
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Age / Gender
                </th>
                <td className="p-2.5 text-neutral-900 border-r border-neutral-300">
                  {patient.age_years} Years / {patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}
                </td>
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Date of Birth
                </th>
                <td className="p-2.5 font-mono text-neutral-900">
                  {patient.dob || '—'}
                </td>
              </tr>
              <tr className="border-b border-neutral-300">
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Mobile Number
                </th>
                <td className="p-2.5 font-mono font-medium text-neutral-900 border-r border-neutral-300">
                  {patient.mobile}
                </td>
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Emergency Contact
                </th>
                <td className="p-2.5 font-mono text-neutral-900">
                  {patient.emergency_contact || '—'}
                </td>
              </tr>
              <tr className="border-b border-neutral-300">
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Residential Address
                </th>
                <td colSpan={3} className="p-2.5 text-neutral-900">
                  {patient.address}, {patient.district}, {patient.state}
                </td>
              </tr>
              <tr>
                <th className="p-2.5 bg-neutral-100 font-bold text-neutral-800 border-r border-neutral-300">
                  Allergies / Alert
                </th>
                <td colSpan={3} className="p-2.5 font-semibold text-red-900">
                  {patient.allergies}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {patient.notes && (
          <div className="p-3 bg-neutral-50 border border-neutral-300 rounded text-xs">
            <span className="font-bold text-neutral-800 block mb-1">Clinical Remarks / Notes:</span>
            <p className="text-neutral-700">{patient.notes}</p>
          </div>
        )}

        {/* Dual Signature Section */}
        <div className="pt-16 pb-4 grid grid-cols-2 gap-12 text-center text-xs">
          <div className="border-t border-neutral-400 pt-2">
            <p className="font-bold text-neutral-900">Patient / Attendant Signature</p>
            <p className="text-[10px] text-neutral-500 mt-0.5">मरीज / परिचारक के हस्ताक्षर</p>
          </div>
          <div className="border-t border-neutral-400 pt-2">
            <p className="font-bold text-neutral-900">Authorized Signatory / Receptionist</p>
            <p className="text-[10px] text-neutral-500 mt-0.5">अधिकृत हस्ताक्षरकर्ता (कल्याण अस्पताल)</p>
          </div>
        </div>

        {/* Footer Notes */}
        <footer className="text-center pt-3 border-t border-neutral-200 text-[10px] text-neutral-500 space-y-0.5">
          <p>{printFooterEn}</p>
          {printFooterHi && <p>{printFooterHi}</p>}
          <p className="text-[9px] text-neutral-400">
            Please bring this card on every hospital visit. Valid for {settings?.consultation_validity_days || 15} days from date of issue.
          </p>
        </footer>
      </div>
    </div>
  )
}
