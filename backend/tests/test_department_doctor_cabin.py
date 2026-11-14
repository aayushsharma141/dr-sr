"""The doctors of a department carry their cabin code, so the Token Desk can print A-05 (RF-21)."""


def test_reception_sees_each_doctors_cabin_code_in_the_department_list(
    login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    department = doctor_a_user.doctor.departments[0]
    doctor_a_user.doctor.cabin_code = "C"
    # Same department, no cabin code assigned yet.
    doctor_b_user.doctor.departments = [department]
    doctor_b_user.doctor.cabin_code = None
    db_session.flush()

    response = login_client(reception_user).get(f"/api/departments/{department.id}/doctors")

    assert response.status_code == 200, response.text
    by_id = {row["id"]: row for row in response.json()}
    assert by_id[doctor_a_user.doctor_id]["cabin_code"] == "C"
    assert by_id[doctor_b_user.doctor_id]["cabin_code"] is None
