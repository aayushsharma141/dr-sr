"""
Renders a professional 1080p MP4 promotional product video for Kalyan Hospital Management System.
Features:
- Title card with hospital branding & logo
- Module cards: Dashboard, Patient Registry, Treatments, Billing & Payments, Backup & Safety
- Smooth cross-fade transitions and animated progress bar
- Lower-third feature badges and callouts
"""
import imageio.v2 as iio
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

BASE_DIR = Path("d:/dr-sr")
PROMO_DIR = BASE_DIR / "promo_assets"
OUTPUT_MP4 = BASE_DIR / "kalyan_hospital_product_video.mp4"

FPS = 30
WIDTH = 1920
HEIGHT = 1080

MODULES = [
    {
        "title": "Kalyan Hospital Management System",
        "subtitle": "Sri Vashishtha Kalyan Trust · Physiotherapy Department",
        "badge": "OFFLINE DESKTOP WORKSPACE",
        "img": None,  # Intro title screen
        "duration_sec": 4.0,
    },
    {
        "title": "Operational Command Center",
        "subtitle": "Live SQLite Metrics · Clinician Caseloads · Daily Activity Queue",
        "badge": "MODULE 01 · DASHBOARD",
        "img": PROMO_DIR / "01_dashboard.png",
        "duration_sec": 5.0,
    },
    {
        "title": "Intelligent Patient Registry",
        "subtitle": "High-Density Directory · Integrated Webcam · Quick Search (Ctrl+K)",
        "badge": "MODULE 02 · PATIENTS",
        "img": PROMO_DIR / "02_patients.png",
        "duration_sec": 5.0,
    },
    {
        "title": "Clinical Treatment & Rehabilitation",
        "subtitle": "VAS 0-10 Pain Slider · Physiotherapy Modalities · Structured Session Notes",
        "badge": "MODULE 03 · THERAPY SESSIONS",
        "img": PROMO_DIR / "03_treatments.png",
        "duration_sec": 5.0,
    },
    {
        "title": "Financial Ledger & Thermal Receipts",
        "subtitle": "Paise-Accurate Accounting · Overpayment Safeguard · 80mm ESC/POS Printing",
        "badge": "MODULE 04 · BILLING & PAYMENTS",
        "img": PROMO_DIR / "04_billing.png",
        "duration_sec": 5.0,
    },
    {
        "title": "Offline-First Data Resilience",
        "subtitle": "Air-Gapped Privacy · WAL-Mode SQLite · Automated Backups & One-Click Restore",
        "badge": "MODULE 05 · BACKUP & SAFETY",
        "img": PROMO_DIR / "05_backup.png",
        "duration_sec": 5.0,
    },
    {
        "title": "Ready for Clinical Deployment",
        "subtitle": "Fast, Offline, Reliable · Serving Patients Across Ara & Garhani Clinics",
        "badge": "SRI VASHISHTHA KALYAN TRUST",
        "img": None,  # Outro title screen
        "duration_sec": 4.0,
    },
]

def get_font(size: int, bold: bool = False):
    try:
        font_name = "segoeuib.ttf" if bold else "segoeui.ttf"
        return ImageFont.truetype(f"C:/Windows/Fonts/{font_name}", size)
    except Exception:
        try:
            font_name = "arialbd.ttf" if bold else "arial.ttf"
            return ImageFont.truetype(f"C:/Windows/Fonts/{font_name}", size)
        except Exception:
            return ImageFont.load_default()

font_title = get_font(42, bold=True)
font_subtitle = get_font(24, bold=False)
font_badge = get_font(18, bold=True)
font_intro_title = get_font(56, bold=True)
font_intro_sub = get_font(28, bold=False)

def create_module_frame(mod: dict, progress: float) -> Image.Image:
    """Renders a single video frame with crisp 1080p layout and lower-third overlay."""
    frame = Image.new("RGBA", (WIDTH, HEIGHT), (11, 17, 32, 255))
    
    if mod["img"] and mod["img"].exists():
        # Load screenshot and place centered with rounded aspect ratio
        ss = Image.open(mod["img"]).convert("RGBA")
        
        # Max dimensions for screenshot inside frame
        target_w = 1760
        target_h = 860
        ss.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
        
        pos_x = (WIDTH - ss.width) // 2
        pos_y = 50 + (target_h - ss.height) // 2
        
        # Shadow underneath
        shadow = Image.new("RGBA", (ss.width + 40, ss.height + 40), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.rounded_rectangle([10, 10, ss.width + 30, ss.height + 30], radius=16, fill=(0, 0, 0, 140))
        frame.alpha_composite(shadow, (pos_x - 15, pos_y - 15))
        frame.paste(ss, (pos_x, pos_y), ss)
        
        # Lower-third banner
        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        
        bar_x = 80
        bar_y = HEIGHT - 150
        bar_w = WIDTH - 160
        bar_h = 100
        
        # Card background with border
        draw.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], radius=14, fill=(15, 23, 42, 235), outline=(13, 148, 136, 180), width=2)
        # Left accent stripe
        draw.rounded_rectangle([bar_x, bar_y, bar_x + 8, bar_y + bar_h], radius=4, fill=(21, 91, 67, 255))
        
        # Badge
        draw.text((bar_x + 30, bar_y + 14), mod["badge"], font=font_badge, fill=(13, 148, 136, 255))
        # Title
        draw.text((bar_x + 30, bar_y + 36), mod["title"], font=font_title, fill=(255, 255, 255, 255))
        # Subtitle
        draw.text((bar_x + 30, bar_y + 88), mod["subtitle"], font=font_subtitle, fill=(203, 213, 225, 255))
        
        # Frame progress indicator
        prog_w = int(bar_w * progress)
        draw.rectangle([bar_x, bar_y + bar_h - 4, bar_x + prog_w, bar_y + bar_h], fill=(16, 185, 129, 255))
        
        frame = Image.alpha_composite(frame, overlay)
    else:
        # Title Card (Intro / Outro)
        draw = ImageDraw.Draw(frame)
        
        # Background gradient circle or glow
        draw.ellipse([WIDTH//2 - 500, HEIGHT//2 - 500, WIDTH//2 + 500, HEIGHT//2 + 500], fill=(16, 71, 53, 90))
        
        # Logo badge
        logo_path = BASE_DIR / "app" / "assets" / "kalyan_hospital_logo.png"
        if logo_path.exists():
            logo = Image.open(logo_path).convert("RGBA")
            logo.thumbnail((160, 160), Image.Resampling.LANCZOS)
            frame.paste(logo, (WIDTH//2 - logo.width//2, HEIGHT//2 - 240), logo)
        
        # Text
        draw.text((WIDTH//2, HEIGHT//2 - 20), mod["badge"], font=font_badge, fill=(13, 148, 136, 255), anchor="mm")
        draw.text((WIDTH//2, HEIGHT//2 + 50), mod["title"], font=font_intro_title, fill=(255, 255, 255, 255), anchor="mm")
        draw.text((WIDTH//2, HEIGHT//2 + 120), mod["subtitle"], font=font_intro_sub, fill=(203, 213, 225, 255), anchor="mm")
        
        # Bottom feature pill
        draw.rounded_rectangle([WIDTH//2 - 260, HEIGHT//2 + 180, WIDTH//2 + 260, HEIGHT//2 + 230], radius=10, fill=(21, 91, 67, 180), outline=(13, 148, 136, 200), width=1)
        draw.text((WIDTH//2, HEIGHT//2 + 205), "100% Offline-First · Local Database · No Internet Required", font=font_subtitle, fill=(240, 253, 244, 255), anchor="mm")

    return frame.convert("RGB")

print("Rendering video frames and encoding MP4 video...")
writer = iio.get_writer(str(OUTPUT_MP4), fps=FPS, codec="libx264", quality=8)

for mod_idx, mod in enumerate(MODULES):
    num_frames = int(mod["duration_sec"] * FPS)
    print(f"  Rendering [{mod_idx + 1}/{len(MODULES)}] {mod['title']} ({num_frames} frames)...")
    
    for f in range(num_frames):
        pct = f / max(1, num_frames - 1)
        frame_img = create_module_frame(mod, pct)
        frame_np = np.array(frame_img)
        
        # Simple cross-fade on first 10 frames of each scene
        if f < 10 and mod_idx > 0:
            alpha = f / 10.0
            frame_np = (frame_np * alpha).astype(np.uint8)
        
        writer.append_data(frame_np)

writer.close()
print(f"Product video successfully generated at: {OUTPUT_MP4.resolve()} (Size: {OUTPUT_MP4.stat().st_size / (1024*1024):.2f} MB)")
