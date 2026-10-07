"""
FICA - Section Generator (Objective 3, HIPO Task 5.1)

Deterministic constraint-satisfaction heuristic (greedy balanced assignment):
  Hard constraint : section size never exceeds `capacity`.
  Soft goals      : (1) even gender split per section,
                    (2) even class sizes,
                    (3) even academic mix (average grade per section).
Same input always gives the same output. The result is a PROPOSAL; the
registrar reviews and confirms it before anything is saved.

students: [{"id": "...", "gender": "Male"|"Female", "avg_grade": 88.5 or None}]
"""
import math
import string
from statistics import mean


def _names(n, names=None):
    if names and len(names) >= n:
        return list(names[:n])
    return [f"Section {string.ascii_uppercase[i]}" for i in range(n)]

def validate_students(students):
    """Data hygiene guard: raise ValueError if the roster would break section distribution."""
    problems = []

    # 1) Gender must be exactly "Male" or "Female" (null, missing, blank, or odd values all fail)
    bad_gender = [s for s in students if s.get("gender") not in ("Male", "Female")]
    if bad_gender:
        who = ", ".join(str(s.get("lrn") or s.get("id")) for s in bad_gender[:5])
        more = f" (+{len(bad_gender) - 5} more)" if len(bad_gender) > 5 else ""
        problems.append(f"{len(bad_gender)} student(s) have missing/invalid gender: {who}{more}")

    # 2) Duplicate LRNs (only checked when the rows carry an 'lrn' key)
    seen, dupes = {}, set()
    for s in students:
        lrn = str(s.get("lrn") or "").strip()
        if not lrn:
            continue
        if lrn in seen:
            dupes.add(lrn)
        seen[lrn] = True
    if dupes:
        shown = ", ".join(sorted(dupes)[:5])
        more = f" (+{len(dupes) - 5} more)" if len(dupes) > 5 else ""
        problems.append(f"{len(dupes)} duplicate LRN(s): {shown}{more}")

    if problems:
        raise ValueError("Fix these records before generating sections: " + "; ".join(problems))

def generate_sections(students, capacity, num_sections=None, section_names=None):
    if capacity < 1:
        raise ValueError("capacity must be at least 1")
    validate_students(students)  # hygiene guard: runs before any distribution
    n = len(students)
    if n == 0:
        return {"sections": [], "unassigned": [], "notes": ["No students to assign."]}

    needed = math.ceil(n / capacity)
    k = num_sections or needed
    notes = []
    if k < needed:
        raise ValueError(
            f"{n} students cannot fit in {k} sections of max {capacity}; need at least {needed}."
        )

    known = [s["avg_grade"] for s in students if s.get("avg_grade") is not None]
    fallback = mean(known) if known else 0.0
    if len(known) < n:
        notes.append(
            f"{n - len(known)} student(s) have no grades; the class average was used for balancing."
        )

    def grade_of(s):
        return s["avg_grade"] if s.get("avg_grade") is not None else fallback

    secs = [
        {"name": nm, "students": [], "gender": {"Male": 0, "Female": 0}, "grade_sum": 0.0}
        for nm in _names(k, section_names)
    ]

    # Males first, then females, each strongest -> weakest. Tie-break on id for determinism.
    order = sorted(
        students,
        key=lambda s: (s.get("gender") != "Male", -grade_of(s), str(s["id"])),
    )
    unassigned = []
    for s in order:
        g = s.get("gender") if s.get("gender") in ("Male", "Female") else None
        open_secs = [x for x in secs if len(x["students"]) < capacity]
        if not open_secs:
            unassigned.append(s["id"])
            continue
        best = min(
            open_secs,
            key=lambda x: (
                x["gender"].get(g, 0) if g else 0,  # fewest of same gender
                len(x["students"]),                 # then smallest class
                x["grade_sum"],                     # then lowest grade total
            ),
        )
        best["students"].append(s["id"])
        best["grade_sum"] += grade_of(s)
        if g:
            best["gender"][g] += 1

    result = []
    for x in secs:
        size = len(x["students"])
        result.append(
            {
                "name": x["name"],
                "size": size,
                "male": x["gender"]["Male"],
                "female": x["gender"]["Female"],
                "avg_grade": round(x["grade_sum"] / size, 2) if size else None,
                "student_ids": x["students"],
            }
        )

    sizes = [r["size"] for r in result]
    notes.append(
        f"{n} students -> {k} sections (cap {capacity}). "
        f"Size range {min(sizes)}-{max(sizes)}."
    )
    return {"sections": result, "unassigned": unassigned, "notes": notes}
