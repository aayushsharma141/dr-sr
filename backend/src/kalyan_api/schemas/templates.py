"""Schemas and seed definitions for specialty clinical templates (DWS-05, D-19-10..13)."""

import warnings
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

warnings.filterwarnings(
    "ignore",
    message=(
        'Field name "schema_json" in "ClinicalTemplateVersionRead" shadows an attribute in parent '
        '"BaseModel"'
    ),
    category=UserWarning,
)

PHYSIOTHERAPY_V1_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Physiotherapy Clinical Template",
    "code": "PHYSIOTHERAPY_V1",
    "department_code": "PHYSIOTHERAPY",
    "sections": [
        {
            "id": "pain_assessment",
            "title": "Pain Assessment",
            "title_hi": "दर्द का मूल्यांकन",
            "fields": [
                {
                    "key": "starting_vas",
                    "label": "Starting VAS (0-10)",
                    "label_hi": "वीएएस स्कोर",
                    "type": "number",
                    "min": 0,
                    "max": 10,
                    "required": True,
                },
                {
                    "key": "pain_site",
                    "label": "Site of Pain",
                    "label_hi": "दर्द का स्थान",
                    "type": "text",
                    "required": True,
                },
                {
                    "key": "onset_duration",
                    "label": "Onset / Duration",
                    "label_hi": "शुरुआत / अवधि",
                    "type": "text",
                },
                {
                    "key": "characteristics",
                    "label": "Characteristics",
                    "label_hi": "दर्द की प्रकृति",
                    "type": "text",
                },
                {
                    "key": "aggravating_factors",
                    "label": "Aggravating Factors",
                    "label_hi": "बढ़ाने वाले कारक",
                    "type": "text",
                },
                {
                    "key": "relieving_factors",
                    "label": "Relieving Factors",
                    "label_hi": "राहत देने वाले कारक",
                    "type": "text",
                },
            ],
        },
        {
            "id": "range_of_motion",
            "title": "Range of Motion (ROM)",
            "title_hi": "गति की सीमा",
            "fields": [
                {"key": "rom_joint", "label": "Joint", "type": "text"},
                {"key": "rom_flexion", "label": "Flexion (degrees)", "type": "text"},
                {"key": "rom_extension", "label": "Extension (degrees)", "type": "text"},
                {"key": "rom_rotation", "label": "Rotation (degrees)", "type": "text"},
            ],
        },
        {
            "id": "strength_and_function",
            "title": "Strength & Function",
            "title_hi": "शक्ति और कार्यप्रणाली",
            "fields": [
                {
                    "key": "mmt_grade",
                    "label": "Manual Muscle Testing (MMT) Grade",
                    "type": "select",
                    "options": ["0/5", "1/5", "2/5", "3/5", "4/5", "5/5"],
                },
                {
                    "key": "functional_limitations",
                    "label": "Functional Limitations",
                    "type": "text",
                },
                {
                    "key": "ambulation_status",
                    "label": "Ambulation Status",
                    "type": "select",
                    "options": ["Independent", "Assisted", "Wheelchair", "Bedbound"],
                },
            ],
        },
        {
            "id": "posture_and_gait",
            "title": "Posture & Gait",
            "title_hi": "मुद्रा और चाल",
            "fields": [
                {"key": "posture_alignment", "label": "Postural Alignment", "type": "text"},
                {"key": "gait_pattern", "label": "Gait Pattern", "type": "text"},
                {"key": "assistive_device", "label": "Assistive Device", "type": "text"},
            ],
        },
    ],
    "required": ["pain_site", "starting_vas"],
}

OPHTHALMOLOGY_V1_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Ophthalmology Clinical Template",
    "code": "OPHTHALMOLOGY_V1",
    "department_code": "OPHTHALMOLOGY",
    "layout": "od_os_side_by_side",
    "sections": [
        {
            "id": "visual_acuity",
            "title": "Visual Acuity",
            "title_hi": "दृष्टि तीक्ष्णता",
            "fields": [
                {
                    "key": "va_distance_uncorrected_od",
                    "label": "Distance Uncorrected (OD)",
                    "type": "text",
                    "required": True,
                },
                {
                    "key": "va_distance_uncorrected_os",
                    "label": "Distance Uncorrected (OS)",
                    "type": "text",
                    "required": True,
                },
                {"key": "va_pinhole_od", "label": "Pinhole (OD)", "type": "text"},
                {"key": "va_pinhole_os", "label": "Pinhole (OS)", "type": "text"},
                {"key": "va_best_corrected_od", "label": "Best Corrected (OD)", "type": "text"},
                {"key": "va_best_corrected_os", "label": "Best Corrected (OS)", "type": "text"},
                {"key": "va_near_vision_od", "label": "Near Vision (OD)", "type": "text"},
                {"key": "va_near_vision_os", "label": "Near Vision (OS)", "type": "text"},
            ],
        },
        {
            "id": "intraocular_pressure",
            "title": "Intraocular Pressure (IOP)",
            "title_hi": "आंतरिक नेत्र दबाव (IOP)",
            "fields": [
                {"key": "iop_od_mmhg", "label": "IOP OD (mmHg)", "type": "number"},
                {"key": "iop_os_mmhg", "label": "IOP OS (mmHg)", "type": "number"},
                {
                    "key": "iop_method",
                    "label": "Measurement Method",
                    "type": "select",
                    "options": [
                        "Goldmann Applanation",
                        "Non-Contact Tonometry",
                        "Schiotz",
                        "Tonopen",
                    ],
                },
            ],
        },
        {
            "id": "anterior_segment",
            "title": "Anterior Segment Examination",
            "title_hi": "पूर्ववर्ती खंड परीक्षण",
            "fields": [
                {"key": "lids_od", "label": "Lids / Adnexa (OD)", "type": "text"},
                {"key": "lids_os", "label": "Lids / Adnexa (OS)", "type": "text"},
                {"key": "conjunctiva_od", "label": "Conjunctiva / Sclera (OD)", "type": "text"},
                {"key": "conjunctiva_os", "label": "Conjunctiva / Sclera (OS)", "type": "text"},
                {"key": "cornea_od", "label": "Cornea (OD)", "type": "text"},
                {"key": "cornea_os", "label": "Cornea (OS)", "type": "text"},
                {"key": "ac_od", "label": "Anterior Chamber (OD)", "type": "text"},
                {"key": "ac_os", "label": "Anterior Chamber (OS)", "type": "text"},
                {"key": "iris_pupil_od", "label": "Iris & Pupil (OD)", "type": "text"},
                {"key": "iris_pupil_os", "label": "Iris & Pupil (OS)", "type": "text"},
                {"key": "lens_od", "label": "Lens (OD)", "type": "text"},
                {"key": "lens_os", "label": "Lens (OS)", "type": "text"},
            ],
        },
        {
            "id": "fundus_and_refraction",
            "title": "Fundus & Refraction",
            "title_hi": "फंडस एवं अपवर्तन",
            "fields": [
                {"key": "optic_disc_cd_od", "label": "Optic Disc C:D (OD)", "type": "text"},
                {"key": "optic_disc_cd_os", "label": "Optic Disc C:D (OS)", "type": "text"},
                {"key": "macula_od", "label": "Macula (OD)", "type": "text"},
                {"key": "macula_os", "label": "Macula (OS)", "type": "text"},
                {"key": "retinal_vessels_od", "label": "Retinal Vessels (OD)", "type": "text"},
                {"key": "retinal_vessels_os", "label": "Retinal Vessels (OS)", "type": "text"},
                {"key": "periphery_od", "label": "Periphery (OD)", "type": "text"},
                {"key": "periphery_os", "label": "Periphery (OS)", "type": "text"},
                {"key": "refraction_sphere_od", "label": "Sphere (OD)", "type": "text"},
                {"key": "refraction_sphere_os", "label": "Sphere (OS)", "type": "text"},
                {"key": "refraction_cylinder_od", "label": "Cylinder (OD)", "type": "text"},
                {"key": "refraction_cylinder_os", "label": "Cylinder (OS)", "type": "text"},
                {"key": "refraction_axis_od", "label": "Axis (OD)", "type": "text"},
                {"key": "refraction_axis_os", "label": "Axis (OS)", "type": "text"},
                {"key": "refraction_add_od", "label": "Add (OD)", "type": "text"},
                {"key": "refraction_add_os", "label": "Add (OS)", "type": "text"},
            ],
        },
    ],
    "required": ["va_distance_uncorrected_od", "va_distance_uncorrected_os"],
}


class ClinicalTemplateVersionRead(BaseModel):
    """Schema version details."""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    template_id: int
    version_number: int
    schema_json: dict[str, Any]
    is_active: bool
    approved_by: str
    approved_at: datetime
    created_at: datetime


class ClinicalTemplateRead(BaseModel):
    """Specialty clinical template with optional active version."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    department_id: int
    code: str
    name_en: str
    name_hi: str | None = None
    is_active: bool
    created_at: datetime
    active_version: ClinicalTemplateVersionRead | None = None


class TemplateResponseInput(BaseModel):
    """Payload to save specialty template responses for an encounter."""

    template_version_id: int = Field(..., gt=0, description="Approved template version ID")
    response_data: dict[str, Any] = Field(
        default_factory=dict, description="Captured specialty form responses"
    )


class TemplateResponseRead(BaseModel):
    """Encounter template response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    encounter_id: int
    template_version_id: int
    response_data: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class PrintTemplateRead(BaseModel):
    """Bilingual print template configuration schema (SET-01, BIL-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    document_type: str
    header_en: str | None = None
    header_hi: str | None = None
    footer_en: str | None = None
    footer_hi: str | None = None
    version: int
    updated_at: datetime


class PrintTemplateUpdate(BaseModel):
    """Payload to update bilingual print template header/footer."""

    header_en: str | None = None
    header_hi: str | None = None
    footer_en: str | None = None
    footer_hi: str | None = None
    version: int = Field(..., description="Current template version for optimistic locking")
