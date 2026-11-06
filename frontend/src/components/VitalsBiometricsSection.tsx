import React, { useId } from 'react'
import type { VitalObservationInput } from '../api/types'

export interface VitalsBiometricsProps {
  vitals: VitalObservationInput
  onChange: (vitals: VitalObservationInput) => void
  onBlur?: () => void
  readOnly?: boolean
  serverBmi?: number | null
}

export function computeBmi(heightCm?: number | null, weightKg?: number | null): {
  value: number | null
  category: 'Underweight' | 'Normal' | 'Overweight' | 'Obese' | null
  colorClass: string
} {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) {
    return { value: null, category: null, colorClass: '' }
  }
  const heightM = heightCm / 100
  const rawBmi = weightKg / (heightM * heightM)
  const value = Math.round(rawBmi * 10) / 10

  if (value < 18.5) {
    return { value, category: 'Underweight', colorClass: 'bg-blue-100 text-blue-800 border-blue-300' }
  } else if (value < 25.0) {
    return { value, category: 'Normal', colorClass: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
  } else if (value < 30.0) {
    return { value, category: 'Overweight', colorClass: 'bg-amber-100 text-amber-800 border-amber-300' }
  } else {
    return { value, category: 'Obese', colorClass: 'bg-red-100 text-red-800 border-red-300' }
  }
}

export function VitalsBiometricsSection({
  vitals,
  onChange,
  onBlur,
  readOnly = false,
  serverBmi,
}: VitalsBiometricsProps) {
  const uid = useId()
  const bmiInfo = computeBmi(vitals.height_cm, vitals.weight_kg)
  const displayBmi = serverBmi ?? bmiInfo.value

  const handleNumChange = (field: keyof VitalObservationInput, valStr: string) => {
    if (readOnly) return
    const num = valStr.trim() === '' ? null : Number(valStr)
    onChange({
      ...vitals,
      [field]: Number.isNaN(num) ? null : num,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
        <h3 className="text-base font-semibold text-neutral-900">
          Vital Signs & Biometrics
        </h3>
        {displayBmi !== null && displayBmi !== undefined && (
          <div
            data-testid="live-bmi-indicator"
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${
              bmiInfo.colorClass || 'bg-neutral-100 text-neutral-800 border-neutral-300'
            }`}
          >
            <span>BMI: {displayBmi} kg/m²</span>
            {bmiInfo.category && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-white/60">
                {bmiInfo.category}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Height */}
        <div>
          <label
            htmlFor={`${uid}-height`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Height (cm)
          </label>
          <input
            id={`${uid}-height`}
            type="number"
            min={20}
            max={280}
            step="0.1"
            value={vitals.height_cm ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('height_cm', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 170"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Weight */}
        <div>
          <label
            htmlFor={`${uid}-weight`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Weight (kg)
          </label>
          <input
            id={`${uid}-weight`}
            type="number"
            min={1}
            max={400}
            step="0.1"
            value={vitals.weight_kg ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('weight_kg', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 68.5"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Systolic BP */}
        <div>
          <label
            htmlFor={`${uid}-sys-bp`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Systolic BP (mmHg)
          </label>
          <input
            id={`${uid}-sys-bp`}
            type="number"
            min={40}
            max={300}
            value={vitals.systolic_bp ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('systolic_bp', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 120"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Diastolic BP */}
        <div>
          <label
            htmlFor={`${uid}-dia-bp`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Diastolic BP (mmHg)
          </label>
          <input
            id={`${uid}-dia-bp`}
            type="number"
            min={20}
            max={200}
            value={vitals.diastolic_bp ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('diastolic_bp', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 80"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Pulse */}
        <div>
          <label
            htmlFor={`${uid}-pulse`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Pulse (bpm)
          </label>
          <input
            id={`${uid}-pulse`}
            type="number"
            min={30}
            max={260}
            value={vitals.pulse_bpm ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('pulse_bpm', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 72"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Temperature */}
        <div>
          <label
            htmlFor={`${uid}-temp`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Temperature (°F)
          </label>
          <input
            id={`${uid}-temp`}
            type="number"
            min={85}
            max={110}
            step="0.1"
            value={vitals.temperature_f ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('temperature_f', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 98.6"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* Respiratory Rate */}
        <div>
          <label
            htmlFor={`${uid}-rr`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            Resp Rate (/min)
          </label>
          <input
            id={`${uid}-rr`}
            type="number"
            min={5}
            max={80}
            value={vitals.respiratory_rate ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('respiratory_rate', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 16"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        {/* SpO2 */}
        <div>
          <label
            htmlFor={`${uid}-spo2`}
            className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
          >
            SpO2 (%)
          </label>
          <input
            id={`${uid}-spo2`}
            type="number"
            min={40}
            max={100}
            value={vitals.spo2_percent ?? ''}
            disabled={readOnly}
            onChange={(e) => handleNumChange('spo2_percent', e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. 98"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>
      </div>
    </div>
  )
}
