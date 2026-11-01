import base64
import json
from pathlib import Path

promo_dir = Path("d:/dr-sr/promo_assets")
html_path = Path("d:/dr-sr/kalyan_hospital_product_tour.html")

slides = [
    {
        "id": "dashboard",
        "title": "Operational Command Center",
        "badge": "OVERVIEW & CASELOAD",
        "desc": "Real-time SQLite analytics, clinician caseload monitoring, live daily patient activity, and one-click quick triage.",
        "features": [
            "Instant operational KPIs: Total Patients, Today's Admissions, Active Cases, Unpaid Fees",
            "Clinician workload tiles for Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi",
            "Smart dual-tab: Live daily transaction queue & quick access to recent patient files"
        ],
        "b64_file": "01_dashboard.b64"
    },
    {
        "id": "patients",
        "title": "Intelligent Patient Registry",
        "badge": "REGISTRY & DEMOGRAPHICS",
        "desc": "High-density patient master index with instant search, clinician filters, integrated webcam capture, and thermal UHID card generator.",
        "features": [
            "Instant filter by clinician, gender, status, or search by URN / Mobile (Ctrl+K)",
            "Integrated webcam photo capture with aspect-ratio lock & live preview",
            "Bilingual patient records compliant with clinical physiotherapy guidelines"
        ],
        "b64_file": "02_patients.b64"
    },
    {
        "id": "treatments",
        "title": "Clinical Treatment & Sessions",
        "badge": "THERAPY & REHABILITATION",
        "desc": "Visual VAS 0-10 pain progression tracking, physiotherapy modality chips, structured clinical notes, and session logs.",
        "features": [
            "Interactive VAS Pain Score slider with auto-colored clinical pain severity bands",
            "Quick-toggle modality chips: TENS, Ultrasound, Traction, IFT, Hot Packs, Laser, Cupping",
            "Multi-session case progress tracking against agreed rehab protocol packages"
        ],
        "b64_file": "03_treatments.b64"
    },
    {
        "id": "billing",
        "title": "Billing & Thermal Receipts",
        "badge": "PAYMENTS & LEDGERS",
        "desc": "Rupee-accurate integer-paise financial ledger, overpayment protection, and pixel-perfect 80mm ESC/POS thermal receipt printing.",
        "features": [
            "Audited financial ledger preventing floating-point rounding errors (Paise storage)",
            "Multiple payment channels: Cash, UPI, Card, Net Banking with split payment support",
            "Dual-format reporting: 80mm ESC/POS thermal receipts & A4 detailed clinical invoices"
        ],
        "b64_file": "04_billing.b64"
    },
    {
        "id": "backup",
        "title": "Air-Gapped Offline Resilience",
        "badge": "BACKUP & DATA INTEGRITY",
        "desc": "100% offline-first architecture with WAL-mode SQLite database, automated hourly backups, SHA-256 verification, and quick restore.",
        "features": [
            "Zero external internet dependency — clinical privacy stays 100% on the local clinic PC",
            "Automated timestamped snapshots & zip archive bundling photos and database",
            "Single-click integrity check and safe rollback in disaster scenarios"
        ],
        "b64_file": "05_backup.b64"
    }
]

images_js = {}
for s in slides:
    b64 = (promo_dir / s["b64_file"]).read_text().strip()
    images_js[s["id"]] = f"data:image/png;base64,{b64}"

images_json = json.dumps(images_js)
slides_json = json.dumps(slides)

template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kalyan Hospital Management System — Product Showcase Video Tour</title>
    <style>
        :root {
            --primary: #155B43;
            --primary-dark: #104735;
            --primary-light: #24785B;
            --accent: #0D9488;
            --secondary: #234B86;
            --gold: #C39A35;
            --bg: #0B1120;
            --card-bg: rgba(30, 41, 59, 0.85);
            --text-main: #F8FAFC;
            --text-muted: #94A3B8;
            --border: rgba(148, 163, 184, 0.15);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body {
            background: linear-gradient(135deg, #071018 0%, #0F1D2F 50%, #071714 100%);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 36px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(14px);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .brand-badge {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            box-shadow: 0 4px 14px rgba(21, 91, 67, 0.4);
        }
        .brand-title {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.5px;
        }
        .brand-subtitle {
            font-size: 12px;
            color: var(--text-muted);
        }
        .controls-top {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .btn {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 8px 18px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        }
        .btn:hover {
            background: rgba(255, 255, 255, 0.16);
            border-color: var(--accent);
            transform: translateY(-1px);
        }
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-light));
            border-color: var(--primary);
            box-shadow: 0 4px 14px rgba(21, 91, 67, 0.35);
        }
        .btn-primary:hover {
            background: linear-gradient(135deg, var(--primary-light), var(--accent));
        }

        main {
            flex: 1;
            max-width: 1440px;
            margin: 0 auto;
            width: 100%;
            padding: 24px 32px 40px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        .theater-stage {
            position: relative;
            background: #000;
            border-radius: 16px;
            border: 1px solid var(--border);
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
            aspect-ratio: 16 / 10;
            max-height: 720px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .screen-img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            transition: opacity 0.4s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
            opacity: 1;
        }
        .screen-img.switching {
            opacity: 0.15;
            transform: scale(0.985);
        }

        .timeline-bar {
            height: 5px;
            background: rgba(255, 255, 255, 0.1);
            width: 100%;
            position: absolute;
            bottom: 0;
            left: 0;
            z-index: 10;
        }
        .timeline-progress {
            height: 100%;
            background: linear-gradient(90deg, var(--accent), #10B981);
            width: 0%;
            transition: width 0.08s linear;
        }

        .overlay-card {
            position: absolute;
            bottom: 24px;
            left: 24px;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-left: 4px solid var(--accent);
            border-radius: 12px;
            padding: 16px 22px;
            max-width: 580px;
            z-index: 20;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
            transition: all 0.3s ease;
        }
        .overlay-badge {
            font-size: 10px;
            font-weight: 800;
            color: var(--accent);
            letter-spacing: 0.8px;
            margin-bottom: 4px;
        }
        .overlay-title {
            font-size: 19px;
            font-weight: 700;
            margin-bottom: 6px;
            color: #FFFFFF;
        }
        .overlay-desc {
            font-size: 13px;
            color: #CBD5E1;
            line-height: 1.45;
        }

        .chapters-nav {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 12px;
        }
        .chapter-tab {
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 12px 14px;
            cursor: pointer;
            transition: all 0.25s ease;
            position: relative;
            overflow: hidden;
        }
        .chapter-tab:hover {
            background: rgba(30, 41, 59, 0.9);
            border-color: rgba(255, 255, 255, 0.25);
        }
        .chapter-tab.active {
            background: rgba(21, 91, 67, 0.28);
            border-color: var(--accent);
            box-shadow: 0 0 20px rgba(13, 148, 136, 0.2);
        }
        .chapter-tab.active::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: var(--accent);
        }
        .ch-num {
            font-size: 10.5px;
            font-weight: 700;
            color: var(--accent);
            margin-bottom: 3px;
        }
        .ch-name {
            font-size: 13px;
            font-weight: 600;
            color: #F8FAFC;
        }

        .features-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-top: 4px;
        }
        .feature-card {
            background: rgba(30, 41, 59, 0.45);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px 18px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }
        .feature-icon {
            font-size: 18px;
            background: rgba(255, 255, 255, 0.06);
            padding: 8px;
            border-radius: 8px;
        }
        .feature-text {
            font-size: 12.5px;
            color: #CBD5E1;
            line-height: 1.45;
        }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <div class="brand-badge">🏥</div>
            <div>
                <div class="brand-title">Kalyan Hospital Management System</div>
                <div class="brand-subtitle">Sri Vashishtha Kalyan Trust · Physiotherapy Department (Ara & Garhani)</div>
            </div>
        </div>
        <div class="controls-top">
            <button class="btn" id="playBtn" onclick="togglePlay()">⏸ Pause Tour</button>
            <button class="btn" onclick="prevSlide()">◀ Previous</button>
            <button class="btn" onclick="nextSlide()">Next ▶</button>
            <button class="btn btn-primary" onclick="toggleFullscreen()">⛶ Fullscreen</button>
        </div>
    </header>

    <main>
        <div class="theater-stage" id="stage">
            <img id="screenImg" class="screen-img" src="" alt="Kalyan Hospital Module">
            
            <div class="overlay-card" id="overlayCard">
                <div class="overlay-badge" id="overlayBadge">CHAPTER 1</div>
                <div class="overlay-title" id="overlayTitle">Operational Command Center</div>
                <div class="overlay-desc" id="overlayDesc">Real-time operational dashboard with clinician caseloads.</div>
            </div>

            <div class="timeline-bar">
                <div class="timeline-progress" id="timelineProgress"></div>
            </div>
        </div>

        <div class="chapters-nav" id="chaptersNav"></div>
        <div class="features-grid" id="featuresGrid"></div>
    </main>

    <script>
        const slides = %SLIDES_DATA%;
        const images = %IMAGES_DATA%;
        
        let currentIndex = 0;
        let isPlaying = true;
        let slideDuration = 6000;
        let elapsed = 0;

        const screenImg = document.getElementById('screenImg');
        const overlayBadge = document.getElementById('overlayBadge');
        const overlayTitle = document.getElementById('overlayTitle');
        const overlayDesc = document.getElementById('overlayDesc');
        const chaptersNav = document.getElementById('chaptersNav');
        const featuresGrid = document.getElementById('featuresGrid');
        const timelineProgress = document.getElementById('timelineProgress');
        const playBtn = document.getElementById('playBtn');

        function initNav() {
            chaptersNav.innerHTML = '';
            slides.forEach((s, idx) => {
                const tab = document.createElement('div');
                tab.className = 'chapter-tab' + (idx === 0 ? ' active' : '');
                tab.onclick = () => jumpToSlide(idx);
                tab.innerHTML = '<div class="ch-num">0' + (idx + 1) + ' · ' + s.badge + '</div><div class="ch-name">' + s.title + '</div>';
                chaptersNav.appendChild(tab);
            });
        }

        function loadSlide(index) {
            currentIndex = index;
            const slide = slides[index];

            screenImg.classList.add('switching');
            setTimeout(() => {
                screenImg.src = images[slide.id];
                screenImg.classList.remove('switching');
            }, 180);

            overlayBadge.textContent = 'MODULE 0' + (index + 1) + ' · ' + slide.badge;
            overlayTitle.textContent = slide.title;
            overlayDesc.textContent = slide.desc;

            document.querySelectorAll('.chapter-tab').forEach((tab, i) => {
                tab.classList.toggle('active', i === index);
            });

            featuresGrid.innerHTML = '';
            slide.features.forEach(f => {
                const card = document.createElement('div');
                card.className = 'feature-card';
                card.innerHTML = '<div class="feature-icon">✨</div><div class="feature-text">' + f + '</div>';
                featuresGrid.appendChild(card);
            });

            elapsed = 0;
            timelineProgress.style.width = '0%';
        }

        function nextSlide() {
            currentIndex = (currentIndex + 1) % slides.length;
            loadSlide(currentIndex);
        }

        function prevSlide() {
            currentIndex = (currentIndex - 1 + slides.length) % slides.length;
            loadSlide(currentIndex);
        }

        function jumpToSlide(idx) {
            loadSlide(idx);
        }

        function togglePlay() {
            isPlaying = !isPlaying;
            playBtn.textContent = isPlaying ? '⏸ Pause Tour' : '▶ Play Tour';
        }

        function toggleFullscreen() {
            const stage = document.getElementById('stage');
            if (!document.fullscreenElement) {
                stage.requestFullscreen().catch(err => alert(err.message));
            } else {
                document.exitFullscreen();
            }
        }

        initNav();
        loadSlide(0);

        setInterval(() => {
            if (!isPlaying) return;
            elapsed += 50;
            const pct = Math.min(100, (elapsed / slideDuration) * 100);
            timelineProgress.style.width = pct + '%';
            if (elapsed >= slideDuration) {
                nextSlide();
            }
        }, 50);

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
            if (e.key === 'ArrowLeft') prevSlide();
            if (e.key === 'p') togglePlay();
            if (e.key === 'f') toggleFullscreen();
        });
    </script>
</body>
</html>
"""

final_html = template.replace("%SLIDES_DATA%", slides_json).replace("%IMAGES_DATA%", images_json)
html_path.write_text(final_html, encoding="utf-8")
print(f"Product Tour generated successfully: {html_path.resolve()}")

