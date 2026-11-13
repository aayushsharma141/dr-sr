
export interface OphthalmologyFormData {
  va_distance_uncorrected_od?: string
  va_distance_uncorrected_os?: string
  va_pinhole_od?: string
  va_pinhole_os?: string
  va_best_corrected_od?: string
  va_best_corrected_os?: string
  va_near_vision_od?: string
  va_near_vision_os?: string
  iop_od_mmhg?: number | string
  iop_os_mmhg?: number | string
  iop_method?: string
  lids_od?: string
  lids_os?: string
  conjunctiva_od?: string
  conjunctiva_os?: string
  cornea_od?: string
  cornea_os?: string
  ac_od?: string
  ac_os?: string
  iris_pupil_od?: string
  iris_pupil_os?: string
  lens_od?: string
  lens_os?: string
  optic_disc_cd_od?: string
  optic_disc_cd_os?: string
  macula_od?: string
  macula_os?: string
  retinal_vessels_od?: string
  retinal_vessels_os?: string
  periphery_od?: string
  periphery_os?: string
  refraction_sphere_od?: string
  refraction_sphere_os?: string
  refraction_cylinder_od?: string
  refraction_cylinder_os?: string
  refraction_axis_od?: string
  refraction_axis_os?: string
  refraction_add_od?: string
  refraction_add_os?: string
  [key: string]: any
}

export interface SpecialtyOphthalmologyFormProps {
  data: OphthalmologyFormData
  onChange: (data: OphthalmologyFormData) => void
  onBlur?: () => void
  readOnly?: boolean
}

export function SpecialtyOphthalmologyForm({
  data,
  onChange,
  onBlur,
  readOnly = false,
}: SpecialtyOphthalmologyFormProps) {
  const updateField = (key: keyof OphthalmologyFormData, value: any) => {
    if (readOnly) return
    onChange({
      ...data,
      [key]: value,
    })
  }

  const vaOptions = ['6/60', '6/36', '6/24', '6/18', '6/12', '6/9', '6/6', 'CF', 'HM', 'PL', 'No PL']
  const nearOptions = ['N6', 'N8', 'N10', 'N12', 'N18', 'N24', 'N36', '<N36']

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 pb-2">
        <h3 className="text-base font-semibold text-neutral-900">
          Ophthalmology Specialty Assessment
        </h3>
        <p className="text-xs text-neutral-500">
          Side-by-side Right Eye (OD) and Left Eye (OS) ocular examination, IOP, slit lamp biometrics, and refraction.
        </p>
      </div>

      {/* Visual Acuity */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          1. Visual Acuity
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Right Eye OD */}
          <div className="p-3 bg-blue-50/40 rounded-lg border border-blue-200 space-y-3">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
              Right Eye (OD)
            </span>

            <div>
              <label htmlFor="va-dist-od" className="block text-xs font-medium text-neutral-700 mb-1">
                Distance Uncorrected <span className="text-red-600">*</span>
              </label>
              <input
                id="va-dist-od"
                type="text"
                list="va-options-list"
                value={data.va_distance_uncorrected_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('va_distance_uncorrected_od', e.target.value)}
                onBlur={onBlur}
                placeholder="e.g. 6/18"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="va-pinhole-od" className="block text-xs font-medium text-neutral-700 mb-1">
                  Pinhole
                </label>
                <input
                  id="va-pinhole-od"
                  type="text"
                  value={data.va_pinhole_od ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('va_pinhole_od', e.target.value)}
                  onBlur={onBlur}
                  placeholder="e.g. 6/9"
                  className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                />
              </div>
              <div>
                <label htmlFor="va-bcva-od" className="block text-xs font-medium text-neutral-700 mb-1">
                  BCVA
                </label>
                <input
                  id="va-bcva-od"
                  type="text"
                  value={data.va_best_corrected_od ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('va_best_corrected_od', e.target.value)}
                  onBlur={onBlur}
                  placeholder="e.g. 6/6"
                  className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="va-near-od" className="block text-xs font-medium text-neutral-700 mb-1">
                Near Vision
              </label>
              <input
                id="va-near-od"
                type="text"
                list="near-options-list"
                value={data.va_near_vision_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('va_near_vision_od', e.target.value)}
                onBlur={onBlur}
                placeholder="e.g. N6"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
              />
            </div>
          </div>

          {/* Left Eye OS */}
          <div className="p-3 bg-emerald-50/40 rounded-lg border border-emerald-200 space-y-3">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
              Left Eye (OS)
            </span>

            <div>
              <label htmlFor="va-dist-os" className="block text-xs font-medium text-neutral-700 mb-1">
                Distance Uncorrected <span className="text-red-600">*</span>
              </label>
              <input
                id="va-dist-os"
                type="text"
                list="va-options-list"
                value={data.va_distance_uncorrected_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('va_distance_uncorrected_os', e.target.value)}
                onBlur={onBlur}
                placeholder="e.g. 6/24"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="va-pinhole-os" className="block text-xs font-medium text-neutral-700 mb-1">
                  Pinhole
                </label>
                <input
                  id="va-pinhole-os"
                  type="text"
                  value={data.va_pinhole_os ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('va_pinhole_os', e.target.value)}
                  onBlur={onBlur}
                  placeholder="e.g. 6/12"
                  className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                />
              </div>
              <div>
                <label htmlFor="va-bcva-os" className="block text-xs font-medium text-neutral-700 mb-1">
                  BCVA
                </label>
                <input
                  id="va-bcva-os"
                  type="text"
                  value={data.va_best_corrected_os ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('va_best_corrected_os', e.target.value)}
                  onBlur={onBlur}
                  placeholder="e.g. 6/6"
                  className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="va-near-os" className="block text-xs font-medium text-neutral-700 mb-1">
                Near Vision
              </label>
              <input
                id="va-near-os"
                type="text"
                list="near-options-list"
                value={data.va_near_vision_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('va_near_vision_os', e.target.value)}
                onBlur={onBlur}
                placeholder="e.g. N6"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
              />
            </div>
          </div>
        </div>

        <datalist id="va-options-list">
          {vaOptions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <datalist id="near-options-list">
          {nearOptions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </div>

      {/* Intraocular Pressure (IOP) */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          2. Intraocular Pressure (IOP)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="iop-od" className="block text-xs font-medium text-neutral-700 mb-1">
              IOP OD (mmHg)
            </label>
            <input
              id="iop-od"
              type="number"
              min={0}
              max={80}
              step="0.5"
              value={data.iop_od_mmhg ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('iop_od_mmhg', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. 14"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="iop-os" className="block text-xs font-medium text-neutral-700 mb-1">
              IOP OS (mmHg)
            </label>
            <input
              id="iop-os"
              type="number"
              min={0}
              max={80}
              step="0.5"
              value={data.iop_os_mmhg ?? ''}
              disabled={readOnly}
              onChange={(e) => updateField('iop_os_mmhg', e.target.value)}
              onBlur={onBlur}
              placeholder="e.g. 15"
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            />
          </div>

          <div>
            <label htmlFor="iop-method" className="block text-xs font-medium text-neutral-700 mb-1">
              Method
            </label>
            <select
              id="iop-method"
              value={data.iop_method ?? 'Goldmann Applanation'}
              disabled={readOnly}
              onChange={(e) => updateField('iop_method', e.target.value)}
              onBlur={onBlur}
              className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
            >
              <option value="Goldmann Applanation">Goldmann Applanation</option>
              <option value="Non-Contact Tonometry">Non-Contact Tonometry</option>
              <option value="Schiotz">Schiotz</option>
              <option value="Tonopen">Tonopen</option>
            </select>
          </div>
        </div>
      </div>

      {/* Anterior Segment Examination */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          3. Slit Lamp Biomicroscopy (Anterior Segment)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* OD fields */}
          <div className="p-3 bg-blue-50/40 rounded-lg border border-blue-200 space-y-3">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">OD (Right Eye)</span>
            <div>
              <label htmlFor="lids-od" className="block text-xs font-medium text-neutral-700 mb-1">Lids / Adnexa</label>
              <input
                id="lids-od"
                type="text"
                value={data.lids_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('lids_od', e.target.value)}
                onBlur={onBlur}
                placeholder="Normal"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="conjunctiva-od" className="block text-xs font-medium text-neutral-700 mb-1">Conjunctiva / Sclera</label>
              <input
                id="conjunctiva-od"
                type="text"
                value={data.conjunctiva_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('conjunctiva_od', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear, quiet"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="cornea-od" className="block text-xs font-medium text-neutral-700 mb-1">Cornea</label>
              <input
                id="cornea-od"
                type="text"
                value={data.cornea_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('cornea_od', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="ac-od" className="block text-xs font-medium text-neutral-700 mb-1">Anterior Chamber</label>
              <input
                id="ac-od"
                type="text"
                value={data.ac_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('ac_od', e.target.value)}
                onBlur={onBlur}
                placeholder="Deep & quiet"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="iris-od" className="block text-xs font-medium text-neutral-700 mb-1">Iris & Pupil</label>
              <input
                id="iris-od"
                type="text"
                value={data.iris_pupil_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('iris_pupil_od', e.target.value)}
                onBlur={onBlur}
                placeholder="RRR"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="lens-od" className="block text-xs font-medium text-neutral-700 mb-1">Lens</label>
              <input
                id="lens-od"
                type="text"
                value={data.lens_od ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('lens_od', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear / NS Grade 1"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
          </div>

          {/* OS fields */}
          <div className="p-3 bg-emerald-50/40 rounded-lg border border-emerald-200 space-y-3">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">OS (Left Eye)</span>
            <div>
              <label htmlFor="lids-os" className="block text-xs font-medium text-neutral-700 mb-1">Lids / Adnexa</label>
              <input
                id="lids-os"
                type="text"
                value={data.lids_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('lids_os', e.target.value)}
                onBlur={onBlur}
                placeholder="Normal"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="conjunctiva-os" className="block text-xs font-medium text-neutral-700 mb-1">Conjunctiva / Sclera</label>
              <input
                id="conjunctiva-os"
                type="text"
                value={data.conjunctiva_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('conjunctiva_os', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear, quiet"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="cornea-os" className="block text-xs font-medium text-neutral-700 mb-1">Cornea</label>
              <input
                id="cornea-os"
                type="text"
                value={data.cornea_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('cornea_os', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="ac-os" className="block text-xs font-medium text-neutral-700 mb-1">Anterior Chamber</label>
              <input
                id="ac-os"
                type="text"
                value={data.ac_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('ac_os', e.target.value)}
                onBlur={onBlur}
                placeholder="Deep & quiet"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="iris-os" className="block text-xs font-medium text-neutral-700 mb-1">Iris & Pupil</label>
              <input
                id="iris-os"
                type="text"
                value={data.iris_pupil_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('iris_pupil_os', e.target.value)}
                onBlur={onBlur}
                placeholder="RRR"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
            <div>
              <label htmlFor="lens-os" className="block text-xs font-medium text-neutral-700 mb-1">Lens</label>
              <input
                id="lens-os"
                type="text"
                value={data.lens_os ?? ''}
                disabled={readOnly}
                onChange={(e) => updateField('lens_os', e.target.value)}
                onBlur={onBlur}
                placeholder="Clear / NS Grade 1"
                className="w-full px-2.5 py-1.5 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Fundus & Refraction */}
      <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
        <h4 className="text-sm font-semibold text-neutral-800 uppercase tracking-wider">
          4. Funduscopy & Refraction
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-blue-50/40 rounded-lg border border-blue-200 space-y-3">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">OD Posterior & Refraction</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="optic-od" className="block text-xs font-medium text-neutral-700 mb-1">Optic Disc (C:D)</label>
                <input
                  id="optic-od"
                  type="text"
                  value={data.optic_disc_cd_od ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('optic_disc_cd_od', e.target.value)}
                  onBlur={onBlur}
                  placeholder="0.3"
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
              <div>
                <label htmlFor="macula-od" className="block text-xs font-medium text-neutral-700 mb-1">Macula</label>
                <input
                  id="macula-od"
                  type="text"
                  value={data.macula_od ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('macula_od', e.target.value)}
                  onBlur={onBlur}
                  placeholder="Normal reflex"
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
            </div>

            {/* Refraction grid OD */}
            <div className="pt-2 border-t border-blue-200">
              <span className="text-xs font-semibold text-neutral-600 uppercase">Refraction (OD)</span>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                <div>
                  <label htmlFor="od-sph" className="block text-xs text-neutral-500">Sph</label>
                  <input
                    id="od-sph"
                    type="text"
                    value={data.refraction_sphere_od ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_sphere_od', e.target.value)}
                    onBlur={onBlur}
                    placeholder="-1.00"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="od-cyl" className="block text-xs text-neutral-500">Cyl</label>
                  <input
                    id="od-cyl"
                    type="text"
                    value={data.refraction_cylinder_od ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_cylinder_od', e.target.value)}
                    onBlur={onBlur}
                    placeholder="-0.50"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="od-axis" className="block text-xs text-neutral-500">Axis</label>
                  <input
                    id="od-axis"
                    type="text"
                    value={data.refraction_axis_od ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_axis_od', e.target.value)}
                    onBlur={onBlur}
                    placeholder="90"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="od-add" className="block text-xs text-neutral-500">Add</label>
                  <input
                    id="od-add"
                    type="text"
                    value={data.refraction_add_od ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_add_od', e.target.value)}
                    onBlur={onBlur}
                    placeholder="+2.00"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-emerald-50/40 rounded-lg border border-emerald-200 space-y-3">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">OS Posterior & Refraction</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="optic-os" className="block text-xs font-medium text-neutral-700 mb-1">Optic Disc (C:D)</label>
                <input
                  id="optic-os"
                  type="text"
                  value={data.optic_disc_cd_os ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('optic_disc_cd_os', e.target.value)}
                  onBlur={onBlur}
                  placeholder="0.3"
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
              <div>
                <label htmlFor="macula-os" className="block text-xs font-medium text-neutral-700 mb-1">Macula</label>
                <input
                  id="macula-os"
                  type="text"
                  value={data.macula_os ?? ''}
                  disabled={readOnly}
                  onChange={(e) => updateField('macula_os', e.target.value)}
                  onBlur={onBlur}
                  placeholder="Normal reflex"
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
            </div>

            {/* Refraction grid OS */}
            <div className="pt-2 border-t border-emerald-200">
              <span className="text-xs font-semibold text-neutral-600 uppercase">Refraction (OS)</span>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                <div>
                  <label htmlFor="os-sph" className="block text-xs text-neutral-500">Sph</label>
                  <input
                    id="os-sph"
                    type="text"
                    value={data.refraction_sphere_os ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_sphere_os', e.target.value)}
                    onBlur={onBlur}
                    placeholder="-1.25"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="os-cyl" className="block text-xs text-neutral-500">Cyl</label>
                  <input
                    id="os-cyl"
                    type="text"
                    value={data.refraction_cylinder_os ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_cylinder_os', e.target.value)}
                    onBlur={onBlur}
                    placeholder="-0.50"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="os-axis" className="block text-xs text-neutral-500">Axis</label>
                  <input
                    id="os-axis"
                    type="text"
                    value={data.refraction_axis_os ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_axis_os', e.target.value)}
                    onBlur={onBlur}
                    placeholder="85"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="os-add" className="block text-xs text-neutral-500">Add</label>
                  <input
                    id="os-add"
                    type="text"
                    value={data.refraction_add_os ?? ''}
                    disabled={readOnly}
                    onChange={(e) => updateField('refraction_add_os', e.target.value)}
                    onBlur={onBlur}
                    placeholder="+2.00"
                    className="w-full px-1.5 py-1 border rounded text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
