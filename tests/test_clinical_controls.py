"""Tests for physiotherapy VAS, modality chips and pain trend components."""

from app.ui.clinical_controls import (
    MODALITY_OPTIONS,
    ModalityChipGroup,
    PainScaleWidget,
    PainTrendWidget,
    pain_level,
)
from app.ui.views.treatment_view import LogSessionDialog


def test_vas_scale_has_bounded_numeric_value_and_severity(qapp):
    widget = PainScaleWidget(initial_value=5)

    assert widget.value() == 5
    assert widget.value_label.text() == "5 / 10"
    assert widget.level_label.text() == "MODERATE PAIN"

    widget.setValue(8)
    assert widget.value() == 8
    assert widget.value_label.text() == "8 / 10"
    assert widget.level_label.text() == "SEVERE PAIN"

    widget.setValue(0)
    assert widget.value() == 0
    assert widget.level_label.text() == "NO PAIN"

    widget.setValue(14)
    assert widget.value() == 10
    assert widget.level_label.text() == "SEVERE PAIN"


def test_vas_severity_thresholds():
    assert pain_level(0)[0] == "No pain"
    assert pain_level(3)[0] == "Mild pain"
    assert pain_level(4)[0] == "Moderate pain"
    assert pain_level(6)[0] == "Moderate pain"
    assert pain_level(7)[0] == "Severe pain"
    assert pain_level(10)[0] == "Severe pain"


def test_modality_chips_toggle_and_preserve_selected_values(qapp):
    group = ModalityChipGroup()
    assert len(group.buttons) == 8
    assert set(group.buttons) == set(MODALITY_OPTIONS)
    assert group.selected_values() == []

    group.buttons["TENS"].click()
    group.buttons["Manual Mobilization"].setChecked(True)
    assert group.selected_values() == ["TENS", "Manual Mobilization"]

    group.set_selected_values(["Ultrasound Therapy (UST)"])
    assert group.selected_values() == ["Ultrasound Therapy (UST)"]


def test_pain_trend_summarizes_actual_session_scores(qapp):
    trend = PainTrendWidget()
    assert "No scored sessions" in trend.summary_label.text()

    trend.set_scores([(1, 8), (2, 6), (3, 4)])
    assert "Latest 4/10" in trend.summary_label.text()
    assert "−4" in trend.summary_label.text()

    trend.set_scores([(2, 4), (4, 7)])
    assert "Latest 7/10" in trend.summary_label.text()
    assert "+3" in trend.summary_label.text()

    trend.set_scores([])
    assert "No scored sessions" in trend.summary_label.text()


def test_log_session_dialog_returns_vas_and_selected_modalities(qapp):
    dialog = LogSessionDialog(session_number=2)
    dialog.pain_scale.setValue(8)
    dialog.mod_cbs["TENS"].setChecked(True)
    dialog.mod_cbs["Interferential Therapy (IFT)"].setChecked(True)
    dialog.notes_input.setPlainText("Improved tolerance to exercises; advised home routine.")

    data = dialog.get_data()

    assert data["pain_score"] == 8
    assert data["modalities_used"] == "TENS, Interferential Therapy (IFT)"
    assert data["therapist_name"] == "Dr. Madan Mohan Dwivedi"
    assert data["treatment_notes"].startswith("Improved tolerance")
