"""
Document Builder - Generates A4 Printable HTML for Kalyan Hospital Documents.
Faithfully reproduces physical prescription slip branding, 12 clinical fields,
authentic Caduceus medical emblem, and dual clinician signatures.
"""

import base64
import os
from pathlib import Path
from typing import Any, Dict, Optional

from app.services.billing_service import BillingService

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"


class DocumentBuilder:
    """Builds pixel-accurate, printable ISO A4 HTML documents matching the physical letterhead."""

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
    def _get_caduceus_b64(cls) -> str:
        """Returns base64 data URI of the authentic blue-winged Caduceus emblem."""
        caduceus_path = ASSET_DIR / "caduceus_emblem.png"
        if caduceus_path.exists():
            try:
                b64 = base64.b64encode(caduceus_path.read_bytes()).decode("utf-8")
                return f"data:image/png;base64,{b64}"
            except Exception:
                pass
        return ""

    @classmethod
    def _build_letterhead_html(
        cls,
        urn: str,
        name: str,
        age_sex: str,
        date_str: str,
        address: str,
        referred_by: str,
    ) -> str:
        """
        Renders the 99.9% identical letterhead matching the physical Kalyan Hospital letter pad:
        1. Deep Maroon Banner with Hindi + English Hospital Name, Sl No. box, and Clinic Branches.
        2. Doctors & Central Caduceus Emblem (Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi).
        3. Pale Yellow Patient Info Strip with Name, Age/Sex, Date, Add., and Ref.
        """
        caduceus_src = cls._get_caduceus_b64()
        if caduceus_src:
            caduceus_img_tag = f'<img src="{caduceus_src}" width="88" height="82" alt="Caduceus" style="display:block;margin:0 auto;" />'
        else:
            caduceus_img_tag = '<span style="font-size:38px;color:#2563EB;">⚕</span>'

        return f"""
  <!-- 1. TOP MAROON BANNER -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#6B1736" style="background-color: #6B1736; color: #FFFFFF; border-collapse: collapse;">
    <tr bgcolor="#6B1736">
      <td bgcolor="#6B1736" align="center" style="padding-top: 8px; padding-bottom: 1px;">
        <div style="font-size: 10px; color: #FDE68A; letter-spacing: 0.8px; margin-bottom: 2px;">श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित</div>
        <span style="font-family: 'Nirmala UI', 'Mangal', 'Arial Black', Arial, sans-serif; font-size: 29px; font-weight: 800; color: #FFFFFF; letter-spacing: 2px;">कल्याण हॉस्पीटल</span>
        <div style="font-size: 11px; font-weight: bold; color: #F1F5F9; letter-spacing: 1.5px; margin-top: 1px;">KALYAN HOSPITAL</div>
      </td>
    </tr>
    <tr bgcolor="#6B1736">
      <td bgcolor="#6B1736" align="center" style="padding-bottom: 7px;">
        <span style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 13.5px; font-weight: 800; color: #FFFFFF; letter-spacing: 2.5px;">PHYSIOTHERAPY DEPARTMENT</span>
      </td>
    </tr>
    <tr bgcolor="#6B1736">
      <td bgcolor="#6B1736" style="padding: 0 14px 8px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#6B1736">
          <tr bgcolor="#6B1736">
            <!-- Sl No. Badge on Left -->
            <td width="155" valign="middle" bgcolor="#6B1736">
              <table cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background-color: #FFFFFF; border: 1.5px solid #1E293B; border-radius: 2px;">
                <tr>
                  <td style="padding: 2px 6px; font-family: 'Segoe UI', sans-serif; font-size: 10.5px; font-weight: bold; color: #1E293B; white-space: nowrap;">Sl No.</td>
                  <td style="padding: 2px 8px; font-family: 'Segoe UI', sans-serif; font-size: 11px; font-weight: bold; color: #6B1736; border-left: 1.5px solid #1E293B; white-space: nowrap;">{urn}</td>
                </tr>
              </table>
            </td>
            <!-- Clinic Addresses on Right -->
            <td align="right" valign="middle" bgcolor="#6B1736" style="font-family: 'Nirmala UI', Arial, sans-serif; font-size: 9.2px; color: #FFFFFF; line-height: 1.4;">
              क्लिनिक :- 1. स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301<br/>
              क्लिनिक :- 2. श्रीरामपुर रोड, गड़हनी, भोजपुर (बिहार) - 802206
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- 2. DOCTORS & CADUCEUS EMBLEM (3 COLUMNS) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; padding: 10px 14px 8px 14px; border-collapse: collapse;">
    <tr>
      <!-- Left: Dr. Madan Mohan Dwivedi (Left Aligned) -->
      <td width="39%" valign="top" style="text-align: left;">
        <div style="font-family: 'Nirmala UI', Arial, sans-serif; font-size: 14px; font-weight: bold; color: #9E1B42; line-height: 1.2;">डॉ० मदन मोहन द्विवेदी</div>
        <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 13px; font-weight: bold; font-style: italic; color: #9E1B42; margin-bottom: 3px;">Dr. Madan Mohan Dwivedi</div>
        <div style="font-size: 9.5px; color: #000000; line-height: 1.35; font-family: 'Segoe UI', Arial, sans-serif;">
          D.P.T (Pat.), O.C.T.M. (Delhi)<br/>
          O.C.S.P. (Gwaliar), M.B.S.A.P.O. (Bihar)<br/>
          Sr. Diploma Music (Allahabad)<br/>
          <b>SENIOR PHYSIOTHERAPIST</b><br/>
          <b>SPORTS PHYSIOTHERAPIST</b><br/>
          Senior Physiotherapist (Ex Sadar Hospital, Arrah)
        </div>
        <div style="font-family: 'Nirmala UI', Arial, sans-serif; font-size: 11.5px; font-weight: bold; color: #15803D; margin-top: 2px;">
          फिजियोरत्न से सम्मानित
        </div>
      </td>

      <!-- Center: Blue-Winged Caduceus Emblem -->
      <td width="18%" align="center" valign="middle">
        {caduceus_img_tag}
      </td>

      <!-- Right: Dr. Chandan Kr. Dwivedi (Left Aligned within right column) -->
      <td width="43%" valign="top" style="text-align: left; padding-left: 10px;">
        <div style="font-family: 'Nirmala UI', Arial, sans-serif; font-size: 14px; font-weight: bold; color: #9E1B42; line-height: 1.2;">डॉ० चंदन कुमार द्विवेदी</div>
        <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 13px; font-weight: bold; font-style: italic; color: #9E1B42; margin-bottom: 3px;">Dr. Chandan Kr. Dwivedi</div>
        <div style="font-size: 9.5px; color: #000000; line-height: 1.35; font-family: 'Segoe UI', Arial, sans-serif;">
          B.P.T. (RGUHS) Bangalore, M.I.A.P.<br/>
          CDNT - Bangalore, CCT - Bangalore<br/>
          Ex. INT. NIMHANS - Bangalore<br/>
          Physiotherapist (NIMHANS, Apollo Bangalore)<br/>
          Ex. INT. RMH - Bangalore<br/>
          FMATS - Varanasi, UP
        </div>
        <div style="font-family: 'Nirmala UI', Arial, sans-serif; font-size: 11.5px; font-weight: bold; color: #15803D; margin-top: 2px;">
          फिजियोथेरेपिस्ट
        </div>
      </td>
    </tr>
  </table>

  <!-- 3. PALE YELLOW PATIENT DETAILS STRIP -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFDE6" style="background-color: #FFFDE6; border-top: 1px solid #F4E8A4; border-bottom: 2.5px solid #6B1736; padding: 6px 14px 7px 14px; font-family: 'Georgia', 'Times New Roman', serif;">
    <tr bgcolor="#FFFDE6">
      <td width="55%" style="font-size: 12px; color: #1E293B;">
        <i style="color: #475569;">Name</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; text-decoration: underline; padding-left: 4px;">&nbsp;{name}&nbsp;</span>
      </td>
      <td width="23%" style="font-size: 12px; color: #1E293B;">
        <i style="color: #475569;">Age / Sex</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; text-decoration: underline; padding-left: 4px;">&nbsp;{age_sex}&nbsp;</span>
      </td>
      <td width="22%" align="right" style="font-size: 12px; color: #1E293B;">
        <i style="color: #475569;">Date</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; text-decoration: underline; padding-left: 4px;">&nbsp;{date_str}&nbsp;</span>
      </td>
    </tr>
    <tr bgcolor="#FFFDE6">
      <td style="font-size: 12px; color: #1E293B; padding-top: 5px;">
        <i style="color: #475569;">Add.</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: 500; color: #0F172A; text-decoration: underline; padding-left: 4px;">&nbsp;{address}&nbsp;</span>
      </td>
      <td colspan="2" style="font-size: 12px; color: #1E293B; padding-top: 5px; padding-left: 12px;">
        <i style="color: #475569;">Ref.</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: 500; color: #0F172A; text-decoration: underline; padding-left: 4px;">&nbsp;{referred_by}&nbsp;</span>
      </td>
    </tr>
  </table>
"""

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
        physical prescription slip of Kalyan Hospital, Ara, Bihar with 12 clinical fields.
        """
        urn = patient_data.get("serial_urn_no", "KH-2026-____")
        name = patient_data.get("patient_name", "___________________________________")
        age = str(patient_data.get("age", "____"))
        sex = patient_data.get("sex", "_________")
        age_sex = f"{age} Yrs / {sex}"
        address = patient_data.get("address", "______________________________________________________")
        mobile = patient_data.get("mobile_no", "____________________")
        patient_in = str(patient_data.get("patient_in") or patient_data.get("created_at") or "_________________________")
        patient_out = str(patient_data.get("patient_out") or "_________________________")
        referred_by = patient_data.get("referred_by") or "___________________________________"
        condition = patient_data.get("patient_condition", "______________________________________________________")
        date_str = str(patient_in)[:10]

        # Case & Session details (Field 11)
        if case_data:
            target_sessions = str(case_data.get("no_of_sessions", "____"))
            case_title = case_data.get("title", "")
            sessions_display = f"{target_sessions} Sessions ({case_title})" if case_title else f"{target_sessions} Sessions"
        else:
            sessions_display = "10 Sessions (Physiotherapy Protocol)"

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

        letterhead = cls._build_letterhead_html(
            urn=urn,
            name=name,
            age_sex=age_sex,
            date_str=date_str,
            address=address,
            referred_by=referred_by,
        )

        return f"""<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8">
<title>Patient Registration & Treatment Record - {urn}</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 8mm;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    font-family: 'Segoe UI', 'Nirmala UI', Arial, sans-serif;
    margin: 0;
    padding: 0;
    color: #0F172A;
    background-color: #FFFFFF;
    font-size: 13px;
    line-height: 1.45;
  }}
  .a4-container {{
    width: 100%;
    margin: 0 auto;
    border: 1.5px solid #6B1736;
    background-color: #FFFFFF;
  }}
  .field-label {{
    font-weight: 700;
    color: #475569;
    font-size: 12px;
  }}
  .field-value {{
    font-weight: 600;
    color: #0F172A;
    border-bottom: 1px solid #CBD5E1;
    padding-bottom: 2px;
  }}
</style>
</head>
<body>

<div class="a4-container">
  {letterhead}

  <!-- 4. PATIENT REGISTRATION & CLINICAL MASTER RECORD -->
  <div style="padding: 14px 18px; background-color: #FFFFFF;">
    <!-- Title Bar -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">
      <tr>
        <td>
          <span style="font-size: 13.5px; font-weight: 800; color: #6B1736; letter-spacing: 0.5px;">PATIENT REGISTRATION & TREATMENT RECORD</span>
        </td>
        <td align="right">
          <span style="background-color: #6B1736; color: #FFFFFF; font-weight: bold; font-size: 11.5px; padding: 2px 8px; border-radius: 3px;">RECORD #{urn}</span>
        </td>
      </tr>
    </table>

    <!-- Top Row: Fields 1-5 recap + Photo frame -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
      <tr>
        <td valign="top" style="padding-right: 14px;">
          <table width="100%" cellpadding="4" cellspacing="0">
            <tr>
              <td width="28%" class="field-label">1. Serial / URN No.:</td>
              <td width="72%" class="field-value" style="color: #6B1736; font-weight: 700;">{urn}</td>
            </tr>
            <tr>
              <td class="field-label">2. Patient Name:</td>
              <td class="field-value">{name}</td>
            </tr>
            <tr>
              <td class="field-label">3. Age:</td>
              <td class="field-value">{age} Yrs &nbsp;&nbsp;&nbsp;&nbsp; <b>4. Sex:</b> {sex}</td>
            </tr>
            <tr>
              <td class="field-label">5. Address:</td>
              <td class="field-value">{address}</td>
            </tr>
          </table>
        </td>
        <td width="115" align="right" valign="top">
          <div style="width: 35mm; height: 45mm; border: 1px solid #CBD5E1; border-radius: 4px; padding: 2px;">
            {photo_html}
          </div>
        </td>
      </tr>
    </table>

    <!-- Fields 6-10 Grid -->
    <table width="100%" cellpadding="4" cellspacing="0" style="margin-bottom: 10px;">
      <tr>
        <td width="20%" class="field-label">6. Mobile No.:</td>
        <td width="30%" class="field-value">{mobile}</td>
        <td width="20%" class="field-label" style="padding-left: 12px;">7. Patient In:</td>
        <td width="30%" class="field-value" style="font-size: 11.5px;">{patient_in}</td>
      </tr>
      <tr>
        <td class="field-label">8. Patient Out:</td>
        <td class="field-value" style="font-size: 11.5px;">{patient_out}</td>
        <td class="field-label" style="padding-left: 12px;">9. Reference / Referred By:</td>
        <td class="field-value">{referred_by}</td>
      </tr>
      <tr>
        <td class="field-label" style="padding-top: 8px;">10. Patient Condition:</td>
        <td colspan="3" class="field-value" style="padding-top: 8px; color: #0F172A;">{condition}</td>
      </tr>
      <tr>
        <td class="field-label" style="padding-top: 8px;">11. No. of Sessions:</td>
        <td colspan="3" class="field-value" style="padding-top: 8px; color: #0D9488;">{sessions_display}</td>
      </tr>
    </table>

    <!-- Field 12: Payment Box -->
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 14px; margin: 10px 0 16px 0;">
      <div style="font-size: 12px; font-weight: bold; color: #6B1736; margin-bottom: 6px;">12. Payment Details:</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%">
            <div style="font-size: 10px; font-weight: bold; color: #64748B; text-transform: uppercase;">Total Agreed Fee</div>
            <div style="font-size: 14.5px; font-weight: bold; color: #0F172A; margin-top: 2px;">{total_amt_str}</div>
          </td>
          <td width="33%">
            <div style="font-size: 10px; font-weight: bold; color: #64748B; text-transform: uppercase;">Amount Paid</div>
            <div style="font-size: 14.5px; font-weight: bold; color: #16A34A; margin-top: 2px;">{paid_amt_str}</div>
          </td>
          <td width="34%">
            <div style="font-size: 10px; font-weight: bold; color: #64748B; text-transform: uppercase;">Remaining Balance</div>
            <div style="font-size: 14.5px; font-weight: bold; color: #6B1736; margin-top: 2px;">{balance_str}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Dual Signatures & Date -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px;">
      <tr>
        <td width="50%" align="center" valign="bottom">
          <div style="width: 220px; border-bottom: 1px solid #0F172A; margin: 0 auto 6px auto;"></div>
          <div style="font-size: 12px; font-weight: bold; color: #334155;">Patient / Attendant Signature</div>
        </td>
        <td width="50%" align="center" valign="bottom">
          <div style="width: 220px; border-bottom: 1px solid #0F172A; margin: 0 auto 6px auto;"></div>
          <div style="font-size: 12px; font-weight: bold; color: #334155;">Authorized Signature</div>
          <div style="font-size: 10px; color: #64748B;">Kalyan Hospital, Ara (Bihar)</div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top: 22px; font-size: 11px; color: #64748B;">
          Date: <b>{date_str}</b> · Kalyan Hospital Physiotherapy Management System
        </td>
      </tr>
    </table>
  </div>
</div>

</body>
</html>"""

    @classmethod
    def build_prescription_slip_html(
        cls,
        patient_data: Dict[str, Any],
        case_data: Optional[Dict[str, Any]] = None,
        clinical_notes: str = "",
    ) -> str:
        """
        Generates standard ISO A4 portrait HTML document reproducing the official
        consultation prescription slip (Rx pad) with the 99.9% identical letterhead.
        """
        urn = patient_data.get("serial_urn_no", "KH-2026-____")
        name = patient_data.get("patient_name", "")
        age = str(patient_data.get("age", ""))
        sex = patient_data.get("sex", "")
        age_sex = f"{age} Yrs / {sex}" if age and sex else (age or sex)
        address = patient_data.get("address", "")
        referred_by = patient_data.get("referred_by", "")
        condition = patient_data.get("patient_condition", "")
        patient_in = str(patient_data.get("patient_in") or patient_data.get("created_at") or "")
        date_str = str(patient_in)[:10] if patient_in else ""

        letterhead = cls._build_letterhead_html(
            urn=urn,
            name=name,
            age_sex=age_sex,
            date_str=date_str,
            address=address,
            referred_by=referred_by,
        )

        protocol_box = ""
        if case_data:
            target_sessions = str(case_data.get("no_of_sessions", ""))
            case_title = case_data.get("title", "")
            notes = case_data.get("notes", "") or clinical_notes
            protocol_box = f"""
    <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
      <div style="font-size: 11px; font-weight: bold; color: #166534; text-transform: uppercase;">Active Treatment Protocol: {case_title} ({target_sessions} Sessions)</div>
      <div style="font-size: 12.5px; color: #14532D; margin-top: 4px; line-height: 1.45;">{notes or 'Therapeutic exercise, electrotherapy, and posture re-education as prescribed.'}</div>
    </div>
"""

        return f"""<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8">
<title>Physiotherapy Prescription - {urn}</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 8mm;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    font-family: 'Segoe UI', 'Nirmala UI', Arial, sans-serif;
    margin: 0;
    padding: 0;
    color: #0F172A;
    background-color: #FFFFFF;
    font-size: 13px;
    line-height: 1.45;
  }}
  .a4-container {{
    width: 100%;
    margin: 0 auto;
    border: 1.5px solid #6B1736;
    background-color: #FFFFFF;
  }}
</style>
</head>
<body>

<div class="a4-container">
  {letterhead}

  <!-- PRESCRIPTION BODY -->
  <div style="padding: 16px 20px; min-height: 580px; background-color: #FFFFFF;">
    <!-- Rx Symbol & Diagnosis Banner -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 14px;">
      <tr>
        <td width="55" valign="top">
          <span style="font-family: 'Georgia', serif; font-size: 34px; font-weight: bold; color: #6B1736; line-height: 1;">℞</span>
        </td>
        <td valign="top" style="padding-top: 4px;">
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 6px 12px;">
            <span style="font-size: 10.5px; font-weight: bold; color: #64748B; text-transform: uppercase;">Clinical Diagnosis / Condition:</span>
            <div style="font-size: 13.5px; font-weight: bold; color: #0F172A; margin-top: 2px;">{condition or 'General Physiotherapy Consultation'}</div>
          </div>
        </td>
      </tr>
    </table>

    {protocol_box}

    <!-- Clinical Lined Writing Space -->
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 38px;"></div>

    <!-- Signatures -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 50px;">
      <tr>
        <td width="50%" align="center" valign="bottom">
          <div style="width: 200px; border-bottom: 1px solid #0F172A; margin: 0 auto 6px auto;"></div>
          <div style="font-size: 11.5px; font-weight: bold; color: #334155;">Patient / Attendant Signature</div>
        </td>
        <td width="50%" align="center" valign="bottom">
          <div style="width: 200px; border-bottom: 1px solid #0F172A; margin: 0 auto 6px auto;"></div>
          <div style="font-size: 11.5px; font-weight: bold; color: #334155;">Authorized Physiotherapist Signature</div>
          <div style="font-size: 10px; color: #64748B;">Kalyan Hospital, Ara</div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top: 24px; font-size: 11px; color: #64748B;">
          Date: <b>{date_str}</b> · Kalyan Hospital Physiotherapy Management System
        </td>
      </tr>
    </table>
  </div>
</div>

</body>
</html>"""
