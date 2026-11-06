import React from 'react'

export interface PhysiotherapyFormData {
  starting_vas?: number
  pain_site?: string
  onset_duration?: string
  characteristics?: string
  aggravating_factors?: string
  relieving_factors?: string
  rom_joint?: string
  rom_flexion?: string
  rom_extension?: string
  rom_rotation?: string
  mmt_grade?: string
  functional_limitations?: string
  ambulation_status?: string
  posture_alignment?: string
  gait_pattern?: string
  assistive_device?: string
  [key: string]: any
}

export interface SpecialtyPhysiotherapyFormProps {
  data: PhysiotherapyFormData
  onChange: (data: PhysiotherapyFormData) => void
  onBlur?: () => void
  readOnly?: boolean
}

export function SpecialtyPhysiotherapyForm({
  data,
  onChange,
  onBlur,
  readOnly = false,
}: SpecialtyPhysiotherapyFormProps) {
  const vas = data.starting_vas ?? 0

  const updateField = (key: keyof PhysiotherapyFormData, value: any) => {
    if (readOnly) return
    onChange({
      ...data,
      [key]: value,
    })
  }

  const getVasLabel = (score: number) => {
    if (score === 0) return { label: 'No Pain', color: 'bg-emerald-100 text-emerald-800' }
    if (score <= 3) return { label: 'Mild Pain', color: 'bg-green-100 text-green-800' }
    if (score <= 6) return { label: 'Moderate Pain', color: 'bg-amber-100 text-amber-800' }
    if (score <= 9) return { label: 'Severe Pain', color: 'bg-orange-100 text-orange-800' }
    return { label: 'Worst Imaginable Pain', color: 'bg-red-100 text-red-800' }
  }

  const vasInfo = getVasLabel(vas)
  const characteristicsOptions = ['Sharp', 'Dull Ache', 'Throbbing', 'Burning', 'Stabbing', 'Tingling']

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 pb-2">
        <h3 className="text-base font-semibold text-neutral-900">
          Physiotherapy Specialty Assessment
        </h3>
        <p className="text-xs text-neutral-500">
          Capture VAS pain scale, joint range of motion, muscle strength, and postural gait analysis.
        </p>
      </div>

      {/* Pain Assessment */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
            1. Pain Assessment
          </h4>
          <span
            data-testid="vas-score-badge"
            className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${vasInfo.color}`}
          >
            VAS {vas}/10 &bull; {vasInfo.label}
          </span>
        </div>

        {/* VAS Slider */}
        <div className="space-y-1">
          <label htmlFor="physio-vas-slider" className="block text-xs font-medium text-neutral-700">
            Pain Intensity Scale (VAS 0–10)
          </label>
          <input
            id="physio-vas-slider"
            type="range"
            min={0}
            max={10}
            step={1}
            value={vas}
            disabled={readOnly}
            onChange={(e) => updateField('starting_vas', Number(e.target.value))}
            onBlur={onBlur}
            className="w-full accent-[#8E1C3D] cursor-pointer"
          />
          <div className="flex justify-between text-[11px] text-neutral-500 font-medium px-1">
            <span>0 (None)</span>
            <span>2 (Mild)</span>
            <span>5 (Moderate)</span>
            <span>8 (Severe)</span>
            <span>10 (Worst)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="physio-pain-site" className="block text-xs font-medium text-neutral-700 mb-1">
              Pain Site / Joint <span className="text-red-600">*</span>
            </label>
            <input
              id="physio-pain-site"
              type="text"
              value={data.pain_site ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('pain_site', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Lumbar spine, Right shoulder"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-onset" className="block text-xs font-medium text-neutral-700 mb-1">
              Onset / Duration
            </label>
            <input
              id="physio-onset"
              type="text"
              value={data.onset_duration ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('onset_duration', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. 3 weeks, insidious onset"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>
        </div>

        {/* Characteristics pills */}
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            Pain Characteristics
          </label>
          <div className="flex flex-wrap gap-2">
            {characteristicsOptions.map((opt) => {
              const selected = (data.characteristics || '').includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const current = (data.characteristics || '').split(',').map((s) => s.trim()).filter(Boolean)
                    const next = selected ? current.filter((c) => c !== opt) : [...current, opt]
                    updateField('characteristics', next.join(', '))
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    selected
                      ? 'bg-[#8E1C3D] text-white border-[#8E1C3D]'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  {opt}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="physio-aggravating" className="block text-xs font-medium text-neutral-700 mb-1">
              Aggravating Factors
            </label>
            <textarea
              id="physio-aggravating"
              rows={2}
              value={data.aggravating_factors ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('aggravating_factors', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Prolonged sitting, forward bending"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-relieving" className="block text-xs font-medium text-neutral-700 mb-1">
              Relieving Factors
            </label>
            <textarea
              id="physio-relieving"
              rows={2}
              value={data.relieving_factors ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('relieving_factors', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Rest, hot fomentation"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>
        </div>
      </div>

      {/* Range of Motion (ROM) */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          2. Range of Motion (ROM)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="physio-rom-joint" className="block text-xs font-medium text-neutral-700 mb-1">
              Joint Inspected
            </label>
            <select
              id="physio-rom-joint"
              value={data.rom_joint ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('rom_joint', e.target.value)}
              onBlur={onBlur}
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            >
              <option value="">Select joint...</option>
              <option value="Cervical Spine">Cervical Spine</option>
              <option value="Lumbar Spine">Lumbar Spine</option>
              <option value="Shoulder (Right)">Shoulder (Right)</option>
              <option value="Shoulder (Left)">Shoulder (Left)</option>
              <option value="Knee (Right)">Knee (Right)</option>
              <option value="Knee (Left)">Knee (Left)</option>
              <option value="Hip">Hip</option>
              <option value="Ankle">Ankle</option>
            </select>
          </div>

          <div>
            <label htmlFor="physio-rom-flexion" className="block text-xs font-medium text-neutral-700 mb-1">
              Flexion
            </label>
            <input
              id="physio-rom-flexion"
              type="text"
              value={data.rom_flexion ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('rom_flexion', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Full / 80°"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-rom-extension" className="block text-xs font-medium text-neutral-700 mb-1">
              Extension
            </label>
            <input
              id="physio-rom-extension"
              type="text"
              value={data.rom_extension ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('rom_extension', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Mildly restricted / 15°"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-rom-rotation" className="block text-xs font-medium text-neutral-700 mb-1">
              Rotation
            </label>
            <input
              id="physio-rom-rotation"
              type="text"
              value={data.rom_rotation ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('rom_rotation', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Full"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>
        </div>
      </div>

      {/* Strength & Function */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          3. Strength & Function
        </h4>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            Manual Muscle Testing (MMT) Grade
          </label>
          <div className="flex flex-wrap gap-2">
            {['0/5', '1/5', '2/5', '3/5', '4/5', '5/5'].map((grade) => (
              <button
                key={grade}
                type="button"
                disabled={readOnly}
                onClick={() => updateField('mmt_grade', grade)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  data.mmt_grade === grade
                    ? 'bg-[#8E1C3D] text-white border-[#8E1C3D]'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                }`}
              >
                {grade}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="physio-ambulation" className="block text-xs font-medium text-neutral-700 mb-1">
              Ambulation Status
            </label>
            <select
              id="physio-ambulation"
              value={data.ambulation_status ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('ambulation_status', e.target.value)}
              onBlur={onBlur}
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            >
              <option value="">Select status...</option>
              <option value="Independent">Independent</option>
              <option value="Assisted">Assisted</option>
              <option value="Wheelchair">Wheelchair</option>
              <option value="Bedbound">Bedbound</option>
            </select>
          </div>

          <div>
            <label htmlFor="physio-functional" className="block text-xs font-medium text-neutral-700 mb-1">
              Functional Limitations
            </label>
            <input
              id="physio-functional"
              type="text"
              value={data.functional_limitations ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('functional_limitations', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Difficulty climbing stairs"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>
        </div>
      </div>

      {/* Posture & Gait */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          4. Posture & Gait
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="physio-posture" className="block text-xs font-medium text-neutral-700 mb-1">
              Postural Alignment
            </label>
            <input
              id="physio-posture"
              type="text"
              value={data.posture_alignment ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('posture_alignment', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Normal, Forward head"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-gait" className="block text-xs font-medium text-neutral-700 mb-1">
              Gait Pattern
            </label>
            <input
              id="physio-gait"
              type="text"
              value={data.gait_pattern ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('gait_pattern', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. Normal, Antalgic"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="physio-device" className="block text-xs font-medium text-neutral-700 mb-1">
              Assistive Device
            </label>
            <input
              id="physio-device"
              type="text"
              value={data.assistive_device ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('assistive_device', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. None, Cane, Walker"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
