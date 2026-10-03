"""Run: python test_logic.py   (no network, no database, synthetic data only)"""
import random

from analytics import forecast_enrollment, risk_flags
from sections import generate_sections

def make_enrollments(seed=1):
    """4 school years, ~30 pupils per grade, 92% promotion, a few transferees in."""
    rnd = random.Random(seed)
    rows, nxt_id = [], 0
    roster = {}
    for y in range(2022, 2026):
        cur = {}
        if y == 2022:
            for g in range(1, 7):
                for _ in range(30):
                    cur[nxt_id] = g
                    nxt_id += 1
        else:
            for sid, g in roster.items():
                if g < 6 and rnd.random() < 0.92:
                    cur[sid] = g + 1
            for g in range(1, 7):  # new entrants (Grade 1 grows by ~2/yr)
                extra = 30 + 2 * (y - 2022) if g == 1 else 2
                for _ in range(extra):
                    cur[nxt_id] = g
                    nxt_id += 1
        roster = cur
        for sid, g in cur.items():
            rows.append(
                {"student_id": sid, "school_year": f"{y}-{y+1}",
                 "grade_level": f"Grade {g}", "status": "Promoted"}
            )
    return rows

def test_forecast():
    res = forecast_enrollment(make_enrollments(), years_ahead=2)
    f = res["forecast"]
    assert len(f) == 12, len(f)
    assert all(x["predicted_total"] >= 0 for x in f)
    g1 = [x for x in f if x["grade_level"] == "Grade 1"]
    assert g1[0]["target_school_year"] == "2026-2027"
    assert g1[0]["predicted_total"] > 33, g1  # upward Grade 1 trend continues
    assert res["meta"]["year_pairs_used"] == 3
    assert not res["meta"]["warnings"]
    print("forecast OK:", [(x["grade_level"], x["predicted_total"]) for x in f[:6]])

def test_forecast_thin_data():
    rows = [r for r in make_enrollments() if r["school_year"] == "2025-2026"]
    res = forecast_enrollment(rows)
    assert res["meta"]["warnings"], "should warn on a single year of data"
    assert forecast_enrollment([])["forecast"] == []
    print("thin data OK")

def test_risk_flags():
    rows = make_enrollments()
    print("risk flags:", [(x["grade_level"], x["retention_rate"]) for x in risk_flags(rows, 0.95)["flags"]])
    assert risk_flags(rows, 0.5)["flags"] == []

def test_sections():
    rnd = random.Random(7)
    studs = [
        {"id": i, "gender": "Male" if i % 2 else "Female",
         "avg_grade": None if i % 17 == 0 else round(rnd.uniform(75, 98), 1)}
        for i in range(70)
    ]
    res = generate_sections(studs, capacity=25)
    secs = res["sections"]
    assert len(secs) == 3  # ceil(70/25)
    assert not res["unassigned"]
    assert all(s["size"] <= 25 for s in secs)
    assert max(s["size"] for s in secs) - min(s["size"] for s in secs) <= 1
    assert max(s["male"] for s in secs) - min(s["male"] for s in secs) <= 1
    assigned = [i for s in secs for i in s["student_ids"]]
    assert sorted(assigned) == list(range(70))  # everyone placed exactly once
    assert generate_sections(studs, 25) == res  # deterministic
    print("sections OK:", [(s["name"], s["size"], s["male"], s["female"], s["avg_grade"]) for s in secs])

def test_sections_errors():
    studs = [{"id": i, "gender": "Male", "avg_grade": 90} for i in range(10)]
    try:
        generate_sections(studs, capacity=3, num_sections=2)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")
    print("capacity guard OK")

if __name__ == "__main__":
    test_forecast()
    test_forecast_thin_data()
    test_risk_flags()
    test_sections()
    test_sections_errors()
    print("\nALL TESTS PASSED")