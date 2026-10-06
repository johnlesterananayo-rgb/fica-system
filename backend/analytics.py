"""
FICA - Predictive Analytics (Objective 2, HIPO Task 5.2)

Lightweight statistical progression model, CPU only, no ML libraries:
  * Grade 2-6 headcount = (last year's previous-grade headcount x observed
    promotion/retention rate) + average new entrants (transferees in).
  * Grade 1 headcount   = simple linear regression over past Grade 1 intakes.

Input rows come from the `enrollments` table, one dict per student per
school year:
    {"student_id": "...", "school_year": "2025-2026",
     "grade_level": "Grade 3", "status": "Enrolled"}

Every row counts as "attended that year" regardless of status, so students
later marked Promoted / Transferred Out / Dropped still count for that year.
"""
import re
from collections import defaultdict
from statistics import mean

GRADES = range(1, 7)  # Fidelis is Grades 1-6

def grade_num(label):
    m = re.search(r"\d+", str(label))
    return int(m.group()) if m else None

def start_year(school_year):
    return int(str(school_year).split("-")[0])

def linear_fit(xs, ys):
    """Ordinary least squares. Returns (slope, intercept)."""
    n = len(xs)
    if n == 0:
        return 0.0, 0.0
    if n == 1:
        return 0.0, float(ys[0])
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return 0.0, my
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return slope, my - slope * mx

def _index(rows):
    """{year: {student_id: grade_number}}"""
    by_year = defaultdict(dict)
    for r in rows:
        g = grade_num(r["grade_level"])
        if g in GRADES:
            by_year[start_year(r["school_year"])][r["student_id"]] = g
    return by_year

def progression_rates(rows):
    """
    Observed transitions between consecutive school years.
    Returns retention[g] (g -> g+1), new_entrants[g] (avg per year), pairs_used.
    """
    by_year = _index(rows)
    years = sorted(by_year)
    carried = defaultdict(int)   # g -> students who moved g -> g+1
    base = defaultdict(int)      # g -> students in g that year
    entrants = defaultdict(list)  # g -> new-entrant counts per year pair
    pairs = 0
    for y in years:
        if y + 1 not in by_year:
            continue
        pairs += 1
        cur, nxt = by_year[y], by_year[y + 1]
        for g in GRADES:
            base[g] += sum(1 for v in cur.values() if v == g)
        for sid, g in cur.items():
            if nxt.get(sid) == g + 1:
                carried[g] += 1
        for g in range(2, 7):
            entrants[g].append(
                sum(1 for sid, v in nxt.items() if v == g and cur.get(sid) != g - 1)
            )
    retention = {g: (carried[g] / base[g]) for g in range(1, 6) if base[g]}
    new_entrants = {g: mean(v) for g, v in entrants.items() if v}
    return retention, new_entrants, pairs

def forecast_enrollment(rows, years_ahead=1):
    """
    Project headcount per grade for the next `years_ahead` school years.
    Returns {"forecast": [...], "meta": {...}}.
    """
    by_year = _index(rows)
    if not by_year:
        return {"forecast": [], "meta": {"warnings": ["No enrollment data."]}}

    years = sorted(by_year)
    last = years[-1]
    retention, entrants, pairs = progression_rates(rows)
    warnings = []
    if pairs < 2:
        warnings.append(
            "Fewer than 2 year-to-year transitions in the data: "
            "treat this forecast as a rough estimate only."
        )

    g1_years = years
    g1_counts = [sum(1 for v in by_year[y].values() if v == 1) for y in g1_years]
    slope, intercept = linear_fit(g1_years, g1_counts)

    state = {g: sum(1 for v in by_year[last].values() if v == g) for g in GRADES}
    out = []
    for step in range(1, years_ahead + 1):
        target = last + step
        nxt = {1: max(round(slope * target + intercept), 0)}
        for g in range(2, 7):
            carried = state[g - 1] * retention.get(g - 1, 1.0)
            nxt[g] = max(round(carried + entrants.get(g, 0.0)), 0)
        state = nxt
        for g in GRADES:
            out.append(
                {
                    "grade_level": f"Grade {g}",
                    "target_school_year": f"{target}-{target + 1}",
                    "predicted_total": state[g],
                }
            )

    return {
        "forecast": out,
        "meta": {
            "method": "cohort progression + linear regression (Grade 1 intake)",
            "years_of_data": len(years),
            "year_pairs_used": pairs,
            "retention_rates": {f"G{g}->G{g+1}": round(r, 3) for g, r in retention.items()},
            "avg_new_entrants": {f"Grade {g}": round(v, 1) for g, v in entrants.items()},
            "grade1_trend_per_year": round(slope, 2),
            "warnings": warnings,
            "disclaimer": "Forecast supports registrar decisions; not an exact or guaranteed outcome.",
        },
    }

def risk_flags(rows, threshold=0.85):
    """
    Deterministic retention guidance: grades whose historical retention
    (share of students who continue to the next grade) is below `threshold`.
    """
    retention, _, pairs = progression_rates(rows)
    flags = []
    for g, r in sorted(retention.items()):
        if r < threshold:
            flags.append(
                {
                    "grade_level": f"Grade {g}",
                    "retention_rate": round(r, 3),
                    "attrition_rate": round(1 - r, 3),
                    "recommendation": (
                        f"Only {r:.0%} of Grade {g} students continued to Grade {g+1}. "
                        "Review transfer/dropout reasons for this grade and follow up with guardians "
                        "before the next enrollment period."
                    ),
                }
            )
    return {"flags": flags, "year_pairs_used": pairs, "threshold": threshold}