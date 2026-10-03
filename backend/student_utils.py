"""Pure helpers for the students endpoints (no framework needed, unit-tested)."""
import re
from datetime import date

STATUSES = ("Enrolled", "Promoted", "Transferred Out", "Dropped", "Graduated")


def sanitize_search(q: str | None) -> str:
    """Keep letters/digits/space . - ' only, so the text is safe inside a PostgREST or-filter."""
    if not q:
        return ""
    q = re.sub(r"[^\w\s.\-']", "", q).replace("_", "")
    return re.sub(r"\s+", " ", q).strip()[:50]


def compute_age(birthdate, today: date | None = None):
    if not birthdate:
        return None
    if isinstance(birthdate, str):
        birthdate = date.fromisoformat(birthdate[:10])
    today = today or date.today()
    return today.year - birthdate.year - ((today.month, today.day) < (birthdate.month, birthdate.day))


def with_age(row: dict, today: date | None = None) -> dict:
    """Prefer age computed from birthdate; fall back to the stored age column."""
    age = compute_age(row.get("birthdate"), today)
    return {**row, "age": age if age is not None else row.get("age")}


def is_duplicate_error(e: Exception) -> bool:
    return getattr(e, "code", None) == "23505" or "duplicate key" in str(e).lower()
