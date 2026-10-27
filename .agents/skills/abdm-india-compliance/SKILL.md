---
name: abdm-india-compliance
description: "Guidelines and architecture specifications for integrating Indian healthcare software with Ayushman Bharat Digital Mission (ABDM). Use when implementing ABHA ID creation, hospital UHID linking (M1), NRCeS FHIR R4 document generation (M2: Prescription, OP Consultation, Discharge Summary, Diagnostic Report), or consent and data exchange (M3)."
---

# Ayushman Bharat Digital Mission (ABDM) Integration Guide

This skill guides engineering teams on making clinic and hospital management software fully compliant with India's **National Digital Health Mission (ABDM)** ecosystem.

## 1. System Roles in ABDM Network
* **Health Information Provider (HIP):** Hospitals, clinics, and diagnostic labs that create and store electronic medical records.
* **Health Information User (HIU):** Applications or doctors requesting to view external patient records with patient consent.
* **Consent Manager (CM):** Intermediary managing patient consent permissions and cryptographic authorization.

## 2. ABDM Milestone Architecture

### Milestone 1 (M1): ABHA Verification & Patient Linking
1. **ABHA Creation:**
   * Generate 14-digit ABHA Number and ABHA Address (`name@abdm`) via Aadhaar OTP or Mobile Number.
2. **Patient Discovery & Linking:**
   * Match incoming patient discovery requests from ABHA app against internal `serial_urn_no` and verified mobile number.
   * Return matching context (`careContexts`: e.g., Visit IDs, OPD cases).
   * Emit OTP to patient's registered mobile number to confirm link authorization.

### Milestone 2 (M2): HL7 FHIR R4 Document Generation
All medical data published by the hospital must be converted into **HL7 FHIR R4 Bundles** compliant with National Resource Centre for EHR Standards (NRCeS) profiles:

1. **Mandatory HI Types (Health Information Types):**
   * **Prescription:** Medication details, dosage instructions, duration, doctor registration council ID.
   * **OP Consultation:** Outpatient consultation notes, chief complaints, physical findings, vitals, provisional diagnosis.
   * **Discharge Summary:** Admission date, discharge date, treatment summary, post-discharge advice.
   * **Diagnostic Report:** Lab test observations, reference ranges, specimen metadata.

2. **Standard Terminologies & Coding Systems:**
   * **Diagnosis:** ICD-10 or ICD-11.
   * **Clinical Findings / Procedures:** SNOMED CT.
   * **Laboratory Investigations:** LOINC.
   * **Medicines:** National Digital Health Formulary or branded/generic formulation names.

3. **FHIR Bundle Skeleton (JSON):**
```json
{
  "resourceType": "Bundle",
  "id": "urn:uuid:KH-BUNDLE-2026-0001",
  "meta": {
    "profile": ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle"]
  },
  "type": "document",
  "timestamp": "2026-10-28T09:30:00+05:30",
  "entry": [
    {
      "resource": {
        "resourceType": "Composition",
        "status": "final",
        "type": { "coding": [{ "system": "http://snomed.info/sct", "code": "440545006", "display": "Prescription record" }] },
        "subject": { "reference": "Patient/KH-2026-0001" },
        "author": [{ "reference": "Practitioner/DR-001" }]
      }
    }
  ]
}
```

### Milestone 3 (M3): Consent & Data Flow
1. **Consent Request & Verification:**
   * Intercept consent approval notification webhooks from ABDM Gateway.
   * Validate digital signature of consent artifact before dispatching any health payload.
2. **Encrypted Data Transfer:**
   * Use Diffie-Hellman Key Exchange (ECDH) + AES-GCM-256 to encrypt the FHIR bundle before transmission over the public network.
