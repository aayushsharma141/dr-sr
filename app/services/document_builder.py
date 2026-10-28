"""
Document Builder - Generates A4 Printable HTML for Kalyan Hospital Documents.
Faithfully reproduces physical prescription slip branding, 12 clinical fields,
authentic Caduceus medical emblem, and dual clinician signatures.
"""

import base64
import os
from html import escape as _html_escape
from pathlib import Path
from typing import Any, Dict, Optional

from app.services.billing_service import BillingService

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"


def _esc(value: Any) -> str:
    """Escape user-entered text so characters like < > & can never break the printed layout."""
    return _html_escape(str(value if value is not None else ""), quote=True)


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
    def _get_hospital_logo_b64(cls) -> str:
        """Returns base64 data URI of the official Kalyan Hospital circular business logo."""
        logo_path = ASSET_DIR / "kalyan_hospital_logo.png"
        if not logo_path.exists():
            logo_path = ASSET_DIR / "kalyan_hospital_logo.jpg"
        if logo_path.exists():
            try:
                b64 = base64.b64encode(logo_path.read_bytes()).decode("utf-8")
                return f"data:image/png;base64,{b64}"
            except Exception:
                pass
        return ""

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
        Renders the authentic letterhead matching the physical Kalyan Hospital letter pad:
        1. Deep Burgundy Banner with centered Hindi and English Hospital Titles, Sl No. box, and Clinic Branches.
        2. Doctors & Official Business Logo (Dr. Madan Mohan Dwivedi, Official Seal, Dr. Chandan Kr. Dwivedi).
        3. Pale Yellow Patient Info Strip with prefilled data on clean dotted leaders.
        4. Solid Burgundy Divider matching the physical pad.
        """
        urn, name, age_sex, date_str, address, referred_by = (
            _esc(v) for v in (urn, name, age_sex, date_str, address, referred_by)
        )
        logo_b64 = cls._get_hospital_logo_b64()
        if logo_b64:
            logo_img_tag = f'<img src="{logo_b64}" width="108" height="108" alt="Kalyan Hospital Business Logo Caduceus Emblem" style="display:block;margin:0 auto;" />'
        else:
            caduceus_src = cls._get_caduceus_b64()
            if caduceus_src:
                logo_img_tag = f'<img src="{caduceus_src}" width="88" height="82" alt="Caduceus" style="display:block;margin:0 auto;" />'
            else:
                logo_img_tag = '<span style="font-size:38px;color:#2563EB;">&#9764;</span>'

        return f"""
  <!-- 1. TOP BURGUNDY BANNER (MATCHES PHYSICAL PAD COLOR & ALIGNMENT) -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#54152F" style="background-color: #54152F; color: #FFFFFF; border-collapse: collapse;">
    <tr bgcolor="#54152F">
      <td bgcolor="#54152F" align="center" style="padding-top: 8px; padding-bottom: 2px;">
        <span style="font-family: 'Nirmala UI', 'Mangal', 'Segoe UI', Arial, sans-serif; font-size: 33px; font-weight: 800; color: #FFFFFF; letter-spacing: 2px;">कल्याण हॉस्पीटल</span>
      </td>
    </tr>
    <tr bgcolor="#54152F">
      <td bgcolor="#54152F" align="center" style="padding-bottom: 6px;">
        <span style="font-family: Arial, Helvetica, sans-serif; font-size: 14.5px; font-weight: 800; color: #FFFFFF; letter-spacing: 3.5px;">PHYSIOTHERAPY DEPARTMENT</span>
      </td>
    </tr>
    <tr bgcolor="#54152F">
      <td bgcolor="#54152F" style="padding: 0 14px 8px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#54152F">
          <tr bgcolor="#54152F">
            <!-- Sl No. Badge on Left -->
            <td width="165" valign="middle" bgcolor="#54152F">
              <table cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background-color: #FFFFFF; border: 1.5px solid #1E293B; border-radius: 3px;">
                <tr>
                  <td style="padding: 3px 7px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: bold; color: #1E293B; white-space: nowrap;">Sl No.</td>
                  <td style="padding: 3px 10px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: bold; color: #54152F; border-left: 1.5px solid #1E293B; white-space: nowrap;">{urn}</td>
                </tr>
              </table>
            </td>
            <!-- Clinic Addresses on Right -->
            <td align="right" valign="middle" bgcolor="#54152F" style="font-family: 'Nirmala UI', 'Segoe UI', Arial, sans-serif; font-size: 9.5px; color: #FFFFFF; line-height: 1.45;">
              क्लिनिक :- 1. नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301<br/>
              क्लिनिक :- 2. श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर, जिला - भोजपुर (बिहार) - 802206
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- 2. DOCTORS & OFFICIAL BUSINESS LOGO (3 BALANCED COLUMNS) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; padding: 8px 14px 6px 14px; border-collapse: collapse;">
    <tr>
      <!-- Left: Dr. Madan Mohan Dwivedi -->
      <td width="38%" valign="top" style="text-align: left; padding: 0;">
        <div style="font-family: 'Nirmala UI', 'Segoe UI', Arial, sans-serif; font-size: 14.5px; font-weight: bold; color: #8B1D24; line-height: 1.2;">डॉ० मदन मोहन द्विवेदी</div>
        <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 13.5px; font-weight: bold; font-style: italic; color: #8B1D24; margin-bottom: 4px;">Dr. Madan Mohan Dwivedi</div>
        <div style="font-size: 9.5px; color: #000000; line-height: 1.25; font-family: 'Segoe UI', Arial, sans-serif;">
          D.P.T (Pat.), O.C.T.M. (Delhi)<br/>
          O.C.S.P. (Gwaliar), M.B.S.A.P.O. (Bihar)<br/>
          Sr. Diploma Music (Allahabad)<br/>
          <b>SENIOR PHYSIOTHERAPIST</b><br/>
          <b>SPORTS PHYSIOTHERAPIST</b><br/>
          Ex Sadar Hospital, Arrah (Bhojpur)
        </div>
        <div style="font-family: 'Nirmala UI', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: bold; color: #0F8A43; margin-top: 4px;">
          फिजियोरत्न से सम्मानित
        </div>
      </td>

      <!-- Center: Official Business Logo -->
      <td width="24%" align="center" valign="middle" style="text-align: center; padding: 0 4px;">
        {logo_img_tag}
      </td>

      <!-- Right: Dr. Chandan Kr. Dwivedi -->
      <td width="38%" valign="top" style="text-align: left; padding-left: 8px;">
        <div style="font-family: 'Nirmala UI', 'Segoe UI', Arial, sans-serif; font-size: 14.5px; font-weight: bold; color: #8B1D24; line-height: 1.2;">डॉ० चंदन कुमार द्विवेदी</div>
        <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 13.5px; font-weight: bold; font-style: italic; color: #8B1D24; margin-bottom: 4px;">Dr. Chandan Kr. Dwivedi</div>
        <div style="font-size: 9.5px; color: #000000; line-height: 1.25; font-family: 'Segoe UI', Arial, sans-serif;">
          B.P.T. (RGUHS) Bangalore, M.I.A.P.<br/>
          CDNT - Bangalore, CCT - Bangalore<br/>
          Ex. INT. NIMHANS - Bangalore<br/>
          Ex. INT. APOLLO - Bangalore<br/>
          Ex. INT. RMH - Bangalore<br/>
          FMATS - Varanasi, UP
        </div>
        <div style="font-family: 'Nirmala UI', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: bold; color: #0F8A43; margin-top: 4px;">
          फिजियोथेरेपिस्ट
        </div>
      </td>
    </tr>
  </table>

  <!-- 3. PALE YELLOW PATIENT DETAILS STRIP WITH LEADERS -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFDE6" style="background-color: #FFFDE6; border-top: 1px solid #F3EBB2; padding: 5px 14px 5px 14px; font-family: 'Georgia', 'Times New Roman', serif;">
    <tr bgcolor="#FFFDE6">
      <td width="55%" style="font-size: 12.5px; color: #1E293B;">
        <i style="color: #475569;">Name</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; border-bottom: 1px dotted #64748B; padding: 0 8px;">{name}</span>
      </td>
      <td width="23%" style="font-size: 12.5px; color: #1E293B;">
        <i style="color: #475569;">Age / Sex</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; border-bottom: 1px dotted #64748B; padding: 0 6px;">{age_sex}</span>
      </td>
      <td width="22%" align="right" style="font-size: 12.5px; color: #1E293B;">
        <i style="color: #475569;">Date</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: bold; color: #0F172A; border-bottom: 1px dotted #64748B; padding: 0 6px;">{date_str}</span>
      </td>
    </tr>
    <tr bgcolor="#FFFDE6">
      <td style="font-size: 12.5px; color: #1E293B; padding-top: 6px;">
        <i style="color: #475569;">Add.</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: 500; color: #0F172A; border-bottom: 1px dotted #64748B; padding: 0 8px;">{address}</span>
      </td>
      <td colspan="2" style="font-size: 12.5px; color: #1E293B; padding-top: 6px; padding-left: 12px;">
        <i style="color: #475569;">Ref.</i> <span style="font-family: 'Segoe UI', Arial, sans-serif; font-weight: 500; color: #0F172A; border-bottom: 1px dotted #64748B; padding: 0 8px;">{referred_by}</span>
      </td>
    </tr>
  </table>

  <!-- 4. SOLID BURGUNDY DIVIDER -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#54152F" style="background-color: #54152F; border-collapse: collapse;">
    <tr bgcolor="#54152F">
      <td height="3" bgcolor="#54152F" style="background-color: #54152F; font-size: 1px; line-height: 3px;">&nbsp;</td>
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
        doctor_name = patient_data.get("doctor_name") or ""
        doctor_name = doctor_name or "___________________________________"

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

        # Photo handling: 35mm x 45mm at 96 dpi = 132 x 170 px. Stored photos are already cropped
        # to this ratio, so a fixed-size <img> is never stretched.
        resolved_photo = photo_path or patient_data.get("photo_full_path") or patient_data.get("photo_path")
        photo_src = cls._image_to_base64_src(resolved_photo)
        if photo_src:
            photo_html = f'<img src="{photo_src}" width="128" height="166" alt="Patient Photo" />'
        else:
            photo_html = (
                '<table width="128" height="166" cellpadding="0" cellspacing="0"><tr>'
                '<td align="center" valign="middle" bgcolor="#F8FAFC" '
                'style="color: #64748B; font-size: 11px;">Patient Photo<br/>'
                '<span style="font-size: 9px; color: #94A3B8;">35mm x 45mm</span></td></tr></table>'
            )

        # Escape every user-entered value used below (after the photo, which is trusted markup).
        urn, name, age, sex, address, mobile, patient_in, patient_out, referred_by, condition, date_str, doctor_name = (
            _esc(v) for v in (
                urn, name, age, sex, address, mobile, patient_in, patient_out,
                referred_by, condition, date_str, doctor_name,
            )
        )
        age_sex = f"{age} Yrs / {sex}"
        sessions_display = _esc(sessions_display)
        total_amt_str, paid_amt_str, balance_str = (_esc(v) for v in (total_amt_str, paid_amt_str, balance_str))

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
    border: 1.5px solid #54152F;
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
  <div style="padding: 10px 16px; background-color: #FFFFFF;">
    <!-- Title Bar -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 4px; border-bottom: 1px solid #E2E8F0; padding-bottom: 2px;">
      <tr>
        <td>
          <span style="font-size: 13.5px; font-weight: 800; color: #54152F; ">PATIENT REGISTRATION & TREATMENT RECORD</span>
        </td>
        <td align="right">
          <span style="background-color: #54152F; color: #FFFFFF; font-weight: bold; font-size: 11.5px; padding: 2px 8px; border-radius: 3px;">RECORD #{urn}</span>
        </td>
      </tr>
    </table>

    <!-- Top Row: Fields 1-5 recap + Photo frame -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
      <tr>
        <td valign="top" style="padding-right: 14px;">
          <table width="100%" cellpadding="2" cellspacing="0">
            <tr>
              <td width="28%" class="field-label">1. Serial / URN No.:</td>
              <td width="72%" class="field-value" style="color: #54152F; font-weight: 700;">{urn}</td>
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
            <tr>
              <td class="field-label">6. Mobile No.:</td>
              <td class="field-value">{mobile}</td>
            </tr>
            <tr>
              <td class="field-label">Doctor:</td>
              <td class="field-value">{doctor_name}</td>
            </tr>
          </table>
        </td>
        <td width="140" align="right" valign="top">{photo_html}</td>
      </tr>
    </table>

    <!-- Fields 6-10 Grid -->
    <table width="100%" cellpadding="2" cellspacing="0" style="margin-bottom: 4px;">
      <tr>
        <td width="26%" class="field-label">7. Patient In:</td>
        <td width="26%" class="field-value" style="font-size: 11.5px;">{patient_in}</td>
        <td width="16%" class="field-label" style="padding-left: 12px;">8. Patient Out:</td>
        <td width="32%" class="field-value" style="font-size: 11.5px;">{patient_out}</td>
      </tr>
      <tr>
        <td class="field-label">9. Reference / Referred By:</td>
        <td colspan="3" class="field-value">{referred_by}</td>
      </tr>
      <tr>
        <td class="field-label">10. Patient Condition:</td>
        <td colspan="3" class="field-value" style="color: #0F172A;">{condition}</td>
      </tr>
      <tr>
        <td class="field-label">11. No. of Sessions:</td>
        <td colspan="3" class="field-value" style="color: #0D9488;">{sessions_display}</td>
      </tr>
    </table>

    <!-- Field 12: Payment Box -->
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 12px; margin: 4px 0 4px 0;">
      <div style="font-size: 12px; font-weight: bold; color: #54152F; margin-bottom: 6px;">12. Payment Details:</div>
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
            <div style="font-size: 14.5px; font-weight: bold; color: #54152F; margin-top: 2px;">{balance_str}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Dual Signatures & Date -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
      <tr>
        <td width="8%">&nbsp;</td>
        <td width="34%" align="center" valign="top" style="border-top: 1px solid #0F172A; padding-top: 4px; font-size: 12px; font-weight: bold; color: #334155;">Patient / Attendant Signature<br/>&nbsp;</td>
        <td width="16%">&nbsp;</td>
        <td width="34%" align="center" valign="top" style="border-top: 1px solid #0F172A; padding-top: 4px; font-size: 12px; font-weight: bold; color: #334155;">Authorized Signature<br/><span style="font-size: 10px; font-weight: normal; color: #64748B;">Kalyan Hospital, Ara (Bihar)  ·  Date: <b>{date_str}</b></span></td>
        <td width="8%">&nbsp;</td>
      </tr></table>
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
        doctor_name = patient_data.get("doctor_name") or ""

        letterhead = cls._build_letterhead_html(
            urn=urn,
            name=name,
            age_sex=age_sex,
            date_str=date_str,
            address=address,
            referred_by=referred_by,
        )

        condition = _esc(condition)
        urn_safe, date_safe = _esc(urn), _esc(date_str)
        doctor_line = (
            f'<div style="font-size: 11.5px; color: #475569; margin-bottom: 8px;">Consulting doctor: '
            f'<b>{_esc(doctor_name)}</b></div>' if doctor_name else ""
        )
        protocol_box = ""
        if case_data:
            target_sessions = str(case_data.get("no_of_sessions", ""))
            case_title = case_data.get("title", "")
            notes = _esc(case_data.get("notes", "") or clinical_notes)
            case_title = _esc(case_title)
            target_sessions = _esc(target_sessions)
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
<title>Physiotherapy Prescription - {urn_safe}</title>
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
    border: 1.5px solid #54152F;
    background-color: #FFFFFF;
  }}
</style>
</head>
<body>

<div class="a4-container">
  {letterhead}

  <!-- PRESCRIPTION BODY -->
  <div style="padding: 10px 18px; background-color: #FFFFFF;">
    <!-- Rx Symbol & Diagnosis Banner -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 10px;">
      <tr>
        <td width="55" valign="top">
          <span style="font-family: 'Georgia', serif; font-size: 34px; font-weight: bold; color: #54152F; line-height: 1;">℞</span>
        </td>
        <td valign="top" style="padding-top: 4px;">
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 6px 12px;">
            <span style="font-size: 10.5px; font-weight: bold; color: #64748B; text-transform: uppercase;">Clinical Diagnosis / Condition:</span>
            <div style="font-size: 13.5px; font-weight: bold; color: #0F172A; margin-top: 2px;">{condition or 'General Physiotherapy Consultation'}</div>
          </div>
        </td>
      </tr>
    </table>

    {doctor_line}
    {protocol_box}

    <!-- Clinical Lined Writing Space -->
    <div style="border-bottom: 1px dotted #CBD5E1; height: 32px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 32px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 32px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 32px;"></div>
    <div style="border-bottom: 1px dotted #CBD5E1; height: 32px;"></div>

    <!-- Signatures -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
      <tr>
        <td width="8%">&nbsp;</td>
        <td width="34%" align="center" valign="top" style="border-top: 1px solid #0F172A; padding-top: 4px; font-size: 11.5px; font-weight: bold; color: #334155;">Patient / Attendant Signature<br/>&nbsp;</td>
        <td width="16%">&nbsp;</td>
        <td width="34%" align="center" valign="top" style="border-top: 1px solid #0F172A; padding-top: 4px; font-size: 11.5px; font-weight: bold; color: #334155;">Authorized Physiotherapist Signature<br/><span style="font-size: 10px; font-weight: normal; color: #64748B;">Kalyan Hospital, Ara</span></td>
        <td width="8%">&nbsp;</td>
      </tr></table>
        </td>
      </tr>
      <tr>
        <td colspan="5" style="padding-top: 10px; font-size: 11px; color: #64748B;">
          Date: <b>{date_safe}</b> · Kalyan Hospital Physiotherapy Management System
        </td>
      </tr>
    </table>
  </div>
</div>

</body>
</html>"""


    @classmethod
    def build_thermal_receipt_html(
        cls,
        patient_data: Dict[str, Any],
        case_data: Dict[str, Any],
        payment_data: Dict[str, Any],
        financial_summary: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Build a self-contained 80mm thermal installment receipt.

        The summary balance is labelled as the current balance at print time;
        the schema does not store a per-payment historical balance snapshot.
        """
        from html import escape as html_escape
        from app.config import HOSPITAL_NAME, HOSPITAL_NAME_HINDI, HOSPITAL_DEPT, TRUST_NAME

        def safe(value: Any) -> str:
            return html_escape(str(value if value is not None else ""), quote=True)

        payment_id = payment_data.get("id") or payment_data.get("payment_id") or 0
        try:
            receipt_number = f"RCPT-{int(payment_id):04d}"
        except (TypeError, ValueError):
            receipt_number = "RCPT-PENDING"

        amount_paise = int(payment_data.get("amount_paid_paise") or 0)
        amount_formatted = payment_data.get("amount_formatted")
        if not amount_formatted:
            amount_formatted = payment_data.get("amount_paid_formatted")
        if not amount_formatted:
            amount_formatted = BillingService.format_inr(amount_paise)

        financial_summary = financial_summary or {}
        total_fee = financial_summary.get("total_fee_formatted")
        total_paid = financial_summary.get("total_paid_formatted")
        current_balance = financial_summary.get("balance_formatted")
        if current_balance is None:
            current_balance = payment_data.get("balance_formatted", "Not available")

        payment_timestamp = str(
            payment_data.get("payment_timestamp")
            or payment_data.get("created_at")
            or payment_data.get("session_timestamp")
            or ""
        )
        if payment_timestamp:
            payment_timestamp = payment_timestamp[:16]
        else:
            payment_timestamp = "Date not recorded"

        patient_name = safe(patient_data.get("patient_name") or "Patient")
        urn = safe(patient_data.get("serial_urn_no") or "")
        mobile = safe(patient_data.get("mobile_no") or "")
        condition = safe(patient_data.get("patient_condition") or "")
        case_title = safe(case_data.get("title") or "Physiotherapy")
        target_sessions = safe(case_data.get("no_of_sessions") or "")
        payment_mode = safe(payment_data.get("payment_mode") or "CASH")
        reference_note = safe(payment_data.get("reference_note") or "")
        recorded_by = safe(payment_data.get("recorded_by") or "Staff")
        doctor_name = safe(patient_data.get("doctor_name") or "")

        fee_row = (
            f'<table class="summary-table" width="100%"><tr><td>Total fee</td>'
            f'<td align="right"><strong>{safe(total_fee)}</strong></td></tr></table>'
            if total_fee is not None else ""
        )
        paid_row = (
            f'<table class="summary-table" width="100%"><tr><td>Total paid</td>'
            f'<td align="right"><strong>{safe(total_paid)}</strong></td></tr></table>'
            if total_paid is not None else ""
        )
        balance_row = (
            f'<table class="summary-table current-balance" width="100%"><tr>'
            f'<td>Current balance*</td><td align="right"><strong>{safe(current_balance)}</strong></td>'
            f'</tr></table>'
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Thermal Receipt {safe(receipt_number)}</title>
<style>
  @page {{ size: 80mm 240mm; margin: 3mm; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    width: 74mm;
    color: #111827;
    background: #FFFFFF;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 10px;
    line-height: 1.35;
  }}
  .receipt {{ width: 74mm; padding: 0 1mm; }}
  .center {{ text-align: center; }}
  .hospital-en {{ font: 800 15px "Arial", sans-serif; letter-spacing: .2px; }}
  .hospital-hi {{ font: 700 14px "Nirmala UI", "Arial", sans-serif; margin-top: 2px; }}
  .trust {{ font: 10px "Nirmala UI", "Arial", sans-serif; margin-top: 2px; }}
  .dept {{ font: 800 9px "Arial", sans-serif; margin-top: 3px; }}
  .muted {{ color: #4B5563; font-size: 9px; }}
  .rule {{ border-top: 1px dashed #111827; margin: 7px 0; }}
  .strong {{ font-weight: 800; }}
  .receipt-number {{ border: 1px solid #111827; padding: 4px; font-size: 11px; font-weight: 800; }}
  .patient-name {{ font: 800 12px "Arial", sans-serif; overflow-wrap: anywhere; }}
  .row {{ margin: 3px 0; overflow-wrap: anywhere; }}
  .summary-table {{ width:100%; border-collapse:collapse; }}
  .summary-table td {{ padding:3px 0; vertical-align:top; }}
  .summary-table td:last-child {{ text-align:right; }}
  .payment-amount {{
    border: 1px solid #111827; margin: 7px 0; padding: 7px 5px;
    text-align: center; font-size: 12px; font-weight: 800;
  }}
  .payment-amount .amount {{ font: 800 17px "Arial", sans-serif; margin-top: 2px; }}
  .current-balance td {{ border-top:1px dashed #111827; padding-top:6px; font-weight:800; }}
  .footnote {{ font-size: 8px; color: #374151; margin-top: 8px; }}
  .footer {{ text-align:center; margin-top: 12px; font-weight: 800; }}
</style>
</head>
<body>
<div class="receipt">
  <div class="center">
    <div class="hospital-en">{safe(HOSPITAL_NAME)}</div>
    <div class="hospital-hi">{safe(HOSPITAL_NAME_HINDI)}</div>
    <div class="trust">{safe(TRUST_NAME)}</div>
    <div class="dept">{safe(HOSPITAL_DEPT)}</div>
    <div class="muted">Ara · Gadhani · Bhojpur, Bihar</div>
  </div>

  <div class="rule"></div>
  <div class="center receipt-number">{safe(receipt_number)}</div>
  <div class="center muted row">{safe(payment_timestamp)}</div>
  <div class="rule"></div>

  <div class="row patient-name">{patient_name}</div>
  <div class="row"><span class="strong">URN:</span> {urn}</div>
  <div class="row"><span class="strong">Mobile:</span> {mobile or "—"}</div>
  <div class="row"><span class="strong">Condition:</span> {condition or "—"}</div>
  <div class="row"><span class="strong">Case:</span> {case_title}</div>
  {f'<div class="row"><span class="strong">Doctor:</span> {doctor_name}</div>' if doctor_name else ""}
  <div class="row"><span class="strong">Sessions planned:</span> {target_sessions or "—"}</div>

  <div class="rule"></div>
  <div class="payment-amount">
    PAYMENT RECEIVED
    <div class="amount">{safe(amount_formatted)}</div>
  </div>
  <table class="summary-table" width="100%">
    <tr><td>Payment mode</td><td align="right"><strong>{payment_mode}</strong></td></tr>
    <tr><td>Recorded by</td><td align="right"><strong>{recorded_by}</strong></td></tr>
  </table>
  {f'<div class="row"><span class="strong">Reference:</span> {reference_note}</div>' if reference_note else ""}
  <div class="rule"></div>
  {fee_row}
  {paid_row}
  {balance_row}
  <div class="footnote">* Current balance as of this receipt's print time. It may differ from the balance immediately after an older installment.</div>
  <div class="rule"></div>
  <div class="footer">Thank you</div>
  <div class="center muted">Please retain this receipt for your records.</div>
</div>
</body>
</html>"""
