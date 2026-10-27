"""
Document Builder - Generates A4 Printable HTML for Kalyan Hospital Registration Cards.
Faithfully reproduces physical prescription slip branding, 12 fields, and dual signatures.
"""

import base64
import os
from typing import Any, Dict, Optional
from app.services.billing_service import BillingService


class DocumentBuilder:
    """Builds pixel-accurate, printable ISO A4 HTML documents."""

    @staticmethod
    def _image_to_base64_src(image_path: Optional[str]) -> Optional[str]:
        """Converts local image file to base64 data URI for embedded printing."""
        if not image_path or not os.path.exists(image_path):
            return None
        try:
            ext = os.path.splitext(image_path)[1].lower().replace(".", "")
            if ext == "jpg":
                ext = "jpeg"
            with open(image_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
                return f"data:image/{ext};base64,{encoded}"
        except Exception:
            return None

    @classmethod
    def build_patient_registration_html(
        cls,
        patient_data: Dict[str, Any],
        case_data: Optional[Dict[str, Any]] = None,
        financial_summary: Optional[Dict[str, Any]] = None,
        photo_path: Optional[str] = None,
    ) -> str:
        """
        Generates standard ISO A4 portrait HTML document reproducing the official
        physical prescription slip of Kalyan Hospital, Ara, Bihar.
        """
        # Resolve values or placeholders
        urn = patient_data.get("serial_urn_no", "KH-2026-____")
        name = patient_data.get("patient_name", "___________________________________")
        age = str(patient_data.get("age", "____"))
        sex = patient_data.get("sex", "_________")
        address = patient_data.get("address", "______________________________________________________")
        mobile = patient_data.get("mobile_no", "____________________")
        patient_in = patient_data.get("patient_in", "_________________________")
        patient_out = patient_data.get("patient_out", "_________________________")
        referred_by = patient_data.get("referred_by", "___________________________________")
        condition = patient_data.get("patient_condition", "______________________________________________________")

        # Case & Session details (Field 11)
        if case_data:
            target_sessions = str(case_data.get("no_of_sessions", "____"))
            case_title = case_data.get("title", "")
            sessions_display = f"{target_sessions} Sessions ({case_title})" if case_title else f"{target_sessions} Sessions"
        else:
            sessions_display = "____________________ Sessions"

        # Financial details (Field 12)
        if financial_summary:
            total_amt_str = financial_summary.get("total_fee_formatted", "₹ ______________")
            paid_amt_str = financial_summary.get("total_paid_formatted", "₹ ______________")
            balance_str = financial_summary.get("balance_formatted", "₹ ______________")
        elif case_data and "total_amount_paise" in case_data:
            paise = case_data["total_amount_paise"]
            total_amt_str = BillingService.format_inr(paise)
            paid_amt_str = "₹ 0.00"
            balance_str = total_amt_str
        else:
            total_amt_str = "₹ ______________"
            paid_amt_str = "₹ ______________"
            balance_str = "₹ ______________"

        # Photo handling
        resolved_photo = photo_path or patient_data.get("photo_path")
        photo_src = cls._image_to_base64_src(resolved_photo)
        if photo_src:
            photo_html = f'<img src="{photo_src}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;" alt="Patient Photo" />'
        else:
            photo_html = (
                '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; '
                'align-items: center; justify-content: center; background-color: #F8FAFC; color: #64748B; '
                'font-size: 11px; text-align: center; border: 1px dashed #CBD5E1; border-radius: 4px; padding: 4px;">'
                '<span>👤</span><span style="margin-top: 4px;">Patient Picture</span>'
                '<span style="font-size: 9px; color: #94A3B8;">(35mm × 45mm)</span></div>'
            )

        html = f"""<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8">
<title>Patient Registration & Treatment Record - {urn}</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 10mm;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
    padding: 0;
    color: #1E293B;
    background-color: #FFFFFF;
    font-size: 13px;
    line-height: 1.5;
  }}
  .a4-container {{
    width: 100%;
    max-width: 190mm;
    margin: 0 auto;
    border: 2px solid #6B1736;
    border-radius: 8px;
    overflow: hidden;
    background-color: #FFFFFF;
  }}
  /* Header Section */
  .header-banner {{
    background-color: #6B1736;
    color: #FFFFFF;
    padding: 14px 18px 12px 18px;
    text-align: center;
    border-bottom: 3px solid #D4AF37; /* Royal Gold accent */
  }}
  .trust-subtitle {{
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin: 0 0 4px 0;
    color: #FDE68A; /* Soft Gold */
  }}
  .hospital-name {{
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 1.5px;
    margin: 0 0 6px 0;
    text-transform: uppercase;
  }}
  .caduceus-emblem {{
    font-size: 24px;
    line-height: 1;
    margin-bottom: 6px;
  }}
  .clinicians-row {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(255, 255, 255, 0.25);
    border-bottom: 1px solid rgba(255, 255, 255, 0.25);
    padding: 6px 4px;
    margin: 6px 0;
    font-size: 11.5px;
  }}
  .clinician-box {{
    flex: 1;
    text-align: center;
  }}
  .clinician-name {{
    font-weight: 700;
    color: #FFFFFF;
  }}
  .clinician-qual {{
    color: #E2E8F0;
    font-size: 10.5px;
  }}
  .addresses-row {{
    font-size: 10px;
    color: #F1F5F9;
    margin-top: 4px;
    line-height: 1.35;
  }}
  /* Title Banner */
  .document-title-bar {{
    background-color: #F1F5F9;
    border-bottom: 1px solid #CBD5E1;
    padding: 8px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .doc-title {{
    font-size: 14px;
    font-weight: 800;
    color: #6B1736;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }}
  .urn-badge {{
    background-color: #6B1736;
    color: #FFFFFF;
    font-weight: 700;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 4px;
  }}
  /* Form Content */
  .content-body {{
    padding: 16px 20px 20px 20px;
  }}
  .top-grid {{
    display: flex;
    gap: 16px;
    margin-bottom: 14px;
  }}
  .fields-left {{
    flex: 1;
  }}
  .photo-frame {{
    width: 35mm;
    height: 45mm;
    border: 1.5px solid #6B1736;
    border-radius: 6px;
    padding: 2px;
    flex-shrink: 0;
  }}
  .form-row {{
    display: flex;
    align-items: baseline;
    margin-bottom: 10px;
  }}
  .field-label {{
    font-weight: 700;
    color: #334155;
    font-size: 12.5px;
    min-width: 140px;
    flex-shrink: 0;
  }}
  .field-value {{
    flex: 1;
    border-bottom: 1px solid #94A3B8;
    padding-bottom: 2px;
    font-size: 13px;
    color: #0F172A;
    font-weight: 500;
  }}
  .divider {{
    border-top: 1px dashed #CBD5E1;
    margin: 14px 0;
  }}
  /* Payment Section Table */
  .payment-box {{
    background-color: #F8FAFC;
    border: 1px solid #E2E8F0;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 8px 0 16px 0;
  }}
  .payment-title {{
    font-weight: 700;
    color: #6B1736;
    font-size: 12.5px;
    margin-bottom: 8px;
  }}
  .payment-cols {{
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }}
  .payment-item {{
    flex: 1;
  }}
  .payment-lbl {{
    font-size: 11px;
    color: #64748B;
    font-weight: 600;
    text-transform: uppercase;
  }}
  .payment-val {{
    font-size: 14px;
    font-weight: 700;
    color: #1E293B;
    margin-top: 2px;
  }}
  /* Signatures Footer */
  .signatures-footer {{
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid #E2E8F0;
  }}
  .sig-row {{
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 24px;
  }}
  .sig-col {{
    width: 44%;
    text-align: center;
  }}
  .sig-line {{
    border-bottom: 1px solid #1E293B;
    height: 36px;
    margin-bottom: 6px;
  }}
  .sig-label {{
    font-size: 12px;
    font-weight: 700;
    color: #334155;
  }}
  .date-row {{
    display: flex;
    justify-content: flex-start;
    align-items: baseline;
    font-size: 12.5px;
    font-weight: 600;
    color: #334155;
  }}
  .date-val {{
    border-bottom: 1px solid #94A3B8;
    min-width: 160px;
    margin-left: 8px;
    padding-bottom: 2px;
  }}
</style>
</head>
<body>

<div class="a4-container">
  <!-- 1. Header Banner -->
  <div class="header-banner">
    <div class="trust-subtitle">श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित</div>
    <div class="caduceus-emblem">⚕️</div>
    <div class="hospital-name">KALYAN HOSPITAL</div>

    <div class="clinicians-row">
      <div class="clinician-box" style="border-right: 1px solid rgba(255,255,255,0.25);">
        <div class="clinician-name">Dr. Madan Mohan Dwivedi</div>
        <div class="clinician-qual">Senior Physiotherapist (Ex Sadar Hospital, Arrah)</div>
      </div>
      <div class="clinician-box">
        <div class="clinician-name">Dr. Chandan Kr. Dwivedi</div>
        <div class="clinician-qual">Physiotherapist (NIMHANS, Apollo Bangalore)</div>
      </div>
    </div>

    <div class="addresses-row">
      <div><strong>Clinic 1:</strong> स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, भोजपुर, बिहार - 802301</div>
      <div><strong>Clinic 2:</strong> श्रीरामपुर रोड, गड़हनी, भोजपुर, बिहार - 802206</div>
    </div>
  </div>

  <!-- 2. Sub-Header -->
  <div class="document-title-bar">
    <span class="doc-title">PATIENT REGISTRATION & TREATMENT RECORD</span>
    <span class="urn-badge">{urn}</span>
  </div>

  <!-- 3. Form Body -->
  <div class="content-body">
    <!-- Top Grid: Fields 1-5 + Photo Frame -->
    <div class="top-grid">
      <div class="fields-left">
        <div class="form-row">
          <span class="field-label">1. Serial / URN No.:</span>
          <span class="field-value" style="font-weight: 700; color: #6B1736;">{urn}</span>
        </div>
        <div class="form-row">
          <span class="field-label">2. Patient Name:</span>
          <span class="field-value" style="font-weight: 600;">{name}</span>
        </div>
        <div class="form-row">
          <span class="field-label">3. Age:</span>
          <span class="field-value" style="flex: 0.6;">{age} Yrs</span>
          <span class="field-label" style="min-width: 60px; text-align: right; margin-right: 8px;">4. Sex:</span>
          <span class="field-value" style="flex: 0.6;">{sex}</span>
        </div>
        <div class="form-row">
          <span class="field-label">5. Address:</span>
          <span class="field-value">{address}</span>
        </div>
      </div>

      <!-- Patient Picture Box -->
      <div class="photo-frame">
        {photo_html}
      </div>
    </div>

    <div class="divider"></div>

    <!-- Fields 6-10 -->
    <div class="form-row">
      <span class="field-label">6. Mobile No.:</span>
      <span class="field-value">{mobile}</span>
    </div>
    <div class="form-row">
      <span class="field-label">7. Patient In (Date & Time):</span>
      <span class="field-value" style="flex: 1;">{patient_in}</span>
      <span class="field-label" style="min-width: 140px; text-align: right; margin-right: 8px;">8. Patient Out:</span>
      <span class="field-value" style="flex: 1;">{patient_out}</span>
    </div>
    <div class="form-row">
      <span class="field-label">9. Reference / Referred By:</span>
      <span class="field-value">{referred_by}</span>
    </div>
    <div class="form-row">
      <span class="field-label">10. Patient Condition:</span>
      <span class="field-value">{condition}</span>
    </div>

    <div class="divider"></div>

    <!-- Field 11: No. of Sessions -->
    <div class="form-row">
      <span class="field-label">11. No. of Sessions:</span>
      <span class="field-value">{sessions_display}</span>
    </div>

    <!-- Field 12: Payment Details -->
    <div class="payment-box">
      <div class="payment-title">12. Payment Details:</div>
      <div class="payment-cols">
        <div class="payment-item">
          <div class="payment-lbl">Total Agreed Fee</div>
          <div class="payment-val">{total_amt_str}</div>
        </div>
        <div class="payment-item">
          <div class="payment-lbl">Amount Paid</div>
          <div class="payment-val" style="color: #059669;">{paid_amt_str}</div>
        </div>
        <div class="payment-item">
          <div class="payment-lbl">Remaining Balance</div>
          <div class="payment-val" style="color: #6B1736;">{balance_str}</div>
        </div>
      </div>
    </div>

    <!-- 4. Signatures & Date Footer (Dual Signatures per authentic pad) -->
    <div class="signatures-footer">
      <div class="sig-row">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-label">Patient / Attendant Signature</div>
        </div>
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-label">Authorized Signature</div>
        </div>
      </div>

      <div class="date-row">
        <span>Date:</span>
        <span class="date-val"></span>
      </div>
    </div>
  </div>
</div>

</body>
</html>"""
        return html
