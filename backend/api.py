"""
FICA backend service.  Run:  uvicorn api:app --reload --port 8001
Env (.env, never commit): SUPABASE_URL, SUPABASE_SERVICE_KEY, FRONTEND_ORIGIN
"""
import os
import re
from collections import defaultdict
from datetime import date, datetime, timezone

from typing import Literal
from uuid import UUID
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analytics import forecast_enrollment, risk_flags
from deps import log_action, require_login, sb
from sections import generate_sections
from students import router as students_router

app = FastAPI(title="FICA Backend")
_configured_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGIN", "").split(",")
    if origin.strip()
]
# Both Localhost and 127.0.0.1 are commonly used by VS Code Live Server.
_dev_origins = ["http://localhost:5500", "http://127.0.0.1:5500"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(set(_dev_origins + _configured_origins)),
    # Live Server often increments the port (e.g. 5501 if 5500 is occupied).
    # This regex permits only localhost/127.0.0.1 origins in development;
    # deployed frontend origins should be listed explicitly in FRONTEND_ORIGIN.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(students_router)

def all_enrollments():
    rows, start = [], 0
    while True:  # page past Supabase's 1000-row default limit
        page = (
            sb.table("enrollments")
            .select("student_id,school_year,grade_level,status")
            .range(start, start + 999)
            .execute()
            .data
        )
        rows += page
        if len(page) < 1000:
            return rows
        start += 1000

@app.get("/analytics/forecast")
def forecast(years_ahead: int = 1, authorization: str | None = Header(None)):
    require_login(authorization)
    return forecast_enrollment(all_enrollments(), min(max(years_ahead, 1), 3))

@app.get("/analytics/risk")
def risk(threshold: float = 0.85, authorization: str | None = Header(None)):
    require_login(authorization)
    return risk_flags(all_enrollments(), threshold)

class SectionRequest(BaseModel):
    grade: str
    capacity: int
    num_sections: int | None = None

@app.post("/sections/generate")
def sections(req: SectionRequest, authorization: str | None = Header(None)):
    """Returns a PROPOSAL only. Nothing is saved until the registrar confirms."""
    require_login(authorization)
    studs = (
        sb.table("students").select("id,lrn,gender")
        .eq("grade", req.grade).eq("is_archived", False).eq("status", "Enrolled")
        .execute().data
    )
    ids = [s["id"] for s in studs]
    scores = defaultdict(list)
    if ids:
        for g in sb.table("grades").select("student_id,grade").in_("student_id", ids).execute().data:
            if g["grade"] is not None:
                scores[g["student_id"]].append(float(g["grade"]))
    for s in studs:
        v = scores.get(s["id"])
        s["avg_grade"] = sum(v) / len(v) if v else None
    try:
        return generate_sections(studs, req.capacity, req.num_sections)
    except ValueError as e:
        raise HTTPException(400, str(e))

# ---------------------------------------------------------------- REQUESTS
PRIORITIES = ("Low", "Normal", "High", "Critical")
# Accepts the canonical names plus older/alternate labels, any capitalization.
PRIORITY_MAP = {
    "low": "Low", "normal": "Normal", "high": "High", "critical": "Critical",
    "medium": "Normal", "urgent": "Critical",
}

def map_priority(value):
    """Turn whatever the frontend sends into one of the 4 allowed values (default Normal)."""
    if value is None or not str(value).strip():
        return "Normal"
    mapped = PRIORITY_MAP.get(str(value).strip().lower())
    if not mapped:
        raise ValueError(f"priority must be one of: {', '.join(PRIORITIES)}")
    return mapped

class RequestIn(BaseModel):
    student_id: UUID
    record_type_id: int
    remarks: str | None = None
    priority: str | None = "Normal"

class RequestStatusIn(BaseModel):
    status: Literal["Ongoing", "Completed", "Removed"]

@app.get("/request-types")
def request_types(authorization: str | None = Header(None)):
    """Feeds the 'Request type' dropdown straight from the record_types table."""
    require_login(authorization)
    return sb.table("record_types").select("id,type_name,description").order("type_name").execute().data

@app.post("/requests", status_code=201)
def create_request(body: RequestIn, authorization: str | None = Header(None)):
    uid = require_login(authorization)
    try:
        priority = map_priority(body.priority)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not sb.table("record_types").select("id").eq("id", body.record_type_id).execute().data:
        raise HTTPException(400, "Unknown request type")
    if not sb.table("students").select("id").eq("id", str(body.student_id)).execute().data:
        raise HTTPException(404, "Student not found")
    try:
        res = sb.table("requests").insert({
            "student_id": str(body.student_id),
            "record_type_id": body.record_type_id,
            "remarks": body.remarks,
            "priority": priority,
            "requested_by": uid,
        }).execute()
    except Exception:
        raise HTTPException(400, "Could not create request")
    row = res.data[0]
    log_action(uid, f"Created request {row['id']} ({priority})")
    return row

@app.patch("/requests/{request_id}/status")
def update_request_status(request_id: UUID, body: RequestStatusIn, authorization: str | None = Header(None)):
    """The database trigger fills completed_at / removed_at when the status changes."""
    uid = require_login(authorization)
    try:
        res = sb.table("requests").update({"status": body.status}).eq("id", str(request_id)).execute()
    except Exception:
        raise HTTPException(400, "Could not update request")
    if not res.data:
        raise HTTPException(404, "Request not found")
    log_action(uid, f"Request {request_id} -> {body.status}")
    return res.data[0]

# ---------------------------------------------------------------- SOFT ARCHIVE
@app.post("/students/{student_id}/archive")
def archive_student(student_id: UUID, authorization: str | None = Header(None)):
    """Soft delete: flags the student as archived. Nothing is removed, so the LRN, requests,
    grades and enrollments that point at this student all stay valid."""
    uid = require_login(authorization)
    found = sb.table("students").select("id,lrn,is_archived").eq("id", str(student_id)).execute().data
    if not found:
        raise HTTPException(404, "Student not found")
    if found[0]["is_archived"]:
        raise HTTPException(409, "Student is already archived")
    try:
        res = sb.table("students").update({
            "is_archived": True,
            "archived_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", str(student_id)).execute()
    except Exception:
        raise HTTPException(400, "Could not archive student")
    log_action(uid, f"Archived student {found[0]['lrn']}")
    return res.data[0]

# ---------------------------------------------------------------- CALENDAR
# Edit these dates whenever the schedule changes. Source: adviser consultation notes.
MILESTONES = [
    {"id": "prototype", "title": "Final Prototype & Documentation Target",
     "description": "Core modules locked for evaluation; manuscript at 80%.",
     "start": "2026-10-10", "end": "2026-10-10"},
    {"id": "acceptance", "title": "Client Acceptance & Usability Testing",
     "description": "Post-deployment survey and system walk-through with the client.",
     "start": "2026-10-12", "end": "2026-10-12"},
    {"id": "polish", "title": "Final Polish & Hardening",
     "description": "Bug fixes, navigation/routing, survey feedback, documentation at 100%.",
     "start": "2026-10-15", "end": "2026-10-31"},
]

def _fmt(d):
    return f"{d:%B} {d.day}, {d.year}"

def _range_label(a, b):
    if a == b:
        return _fmt(a)
    if (a.year, a.month) == (b.year, b.month):
        return f"{a:%B} {a.day} - {b.day}, {a.year}"
    return f"{_fmt(a)} - {_fmt(b)}"

def build_calendar(milestones, today, year=None):
    items = []
    for m in milestones:
        a, b = date.fromisoformat(m["start"]), date.fromisoformat(m["end"])
        if year and a.year != year:
            continue
        items.append({
            "id": m["id"], "title": m["title"], "description": m["description"],
            "start_date": a.isoformat(), "end_date": b.isoformat(),
            "date_label": _range_label(a, b), "year": a.year,
            "days_left": (b - today).days,
            "status": "past" if b < today else "ongoing" if a <= today <= b else "upcoming",
        })
    items.sort(key=lambda x: x["start_date"])
    return {
        "today": today.isoformat(), "today_label": _fmt(today), "year": year or today.year,
        "years": sorted({int(m["start"][:4]) for m in milestones} | {today.year}),
        "milestones": items,
    }

@app.get("/calendar")
def calendar(year: int | None = None, authorization: str | None = Header(None)):
    """Dashboard calendar: deadline labels, date ranges and years, ready for the frontend."""
    require_login(authorization)
    return build_calendar(MILESTONES, date.today(), year)
# ---------------------------------------------------------------- STUDENT GRADES
class GradeIn(BaseModel):
    school_year: str = Field(pattern=r"^\d{4}-\d{4}$")
    subject: str = Field(min_length=1, max_length=80)
    quarter: int = Field(ge=1, le=4)
    grade: float = Field(ge=0, le=100)

@app.get("/students/{student_id}/grades")
def list_student_grades(
    student_id: UUID,
    school_year: str | None = None,
    authorization: str | None = Header(None),
):
    """List grade rows for a student, optionally filtered by school year."""
    require_login(authorization)
    found = sb.table("students").select("id").eq("id", str(student_id)).execute().data
    if not found:
        raise HTTPException(404, "Student not found")
    query = sb.table("grades").select("id,student_id,school_year,subject,quarter,grade,created_at").eq("student_id", str(student_id))
    if school_year:
        if not re.fullmatch(r"\d{4}-\d{4}", school_year):
            raise HTTPException(400, "school_year must use YYYY-YYYY format")
        query = query.eq("school_year", school_year)
    return query.order("subject").order("quarter").execute().data

@app.post("/students/{student_id}/grades", status_code=200)
def save_student_grade(
    student_id: UUID,
    body: GradeIn,
    authorization: str | None = Header(None),
):
    """Insert or update one student's subject/quarter grade for a school year."""
    uid = require_login(authorization)
    if int(body.school_year.split("-")[1]) != int(body.school_year.split("-")[0]) + 1:
        raise HTTPException(400, "school_year must describe consecutive academic years, e.g. 2026-2027")
    found = sb.table("students").select("id,lrn").eq("id", str(student_id)).execute().data
    if not found:
        raise HTTPException(404, "Student not found")
    query = (
        sb.table("grades").select("id")
        .eq("student_id", str(student_id))
        .eq("school_year", body.school_year)
        .eq("subject", body.subject.strip())
        .eq("quarter", body.quarter)
    )
    existing = query.execute().data
    values = {"grade": body.grade, "subject": body.subject.strip()}
    try:
        if existing:
            result = sb.table("grades").update(values).eq("id", existing[0]["id"]).execute()
        else:
            values.update({"student_id": str(student_id), "school_year": body.school_year, "quarter": body.quarter})
            result = sb.table("grades").insert(values).execute()
    except Exception:
        raise HTTPException(400, "Could not save grade")
    if not result.data:
        raise HTTPException(400, "Could not save grade")
    log_action(uid, f"Saved grade for student {found[0]['lrn']} ({body.subject}, Q{body.quarter}, {body.school_year})")
    return result.data[0]

# ---------------------------------------------------------------- ACTIVITY LOGS
@app.get("/logs")
def list_activity_logs(limit: int = 100, authorization: str | None = Header(None)):
    """Return recent registrar audit events for the Logs page and dashboard."""
    require_login(authorization)
    safe_limit = min(max(limit, 1), 200)
    try:
        rows = (
            sb.table("activity_logs")
            .select("id,registrar_id,action,created_at,registrars(full_name,email)")
            .order("created_at", desc=True)
            .range(0, safe_limit - 1)
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(500, "Could not load activity logs")
    cleaned = []
    for row in rows:
        registrar = row.pop("registrars", None) or {}
        row["registrar_name"] = registrar.get("full_name")
        row["email"] = registrar.get("email")
        cleaned.append(row)
    return cleaned

# ---------------------------------------------------------------- LIST REQUESTS
@app.get("/requests")
def list_requests(status: Literal["Ongoing", "Completed", "Removed"] | None = None,
                  authorization: str | None = Header(None)):
    """Request page data: priority, status and the dates, newest first. ?status= filters."""
    require_login(authorization)
    q = (
        sb.table("requests")
        .select("id,priority,status,remarks,created_at,completed_at,removed_at,student_id,record_type_id,"
                "students(lrn,first_name,last_name),record_types(type_name)")
        .eq("is_archived", False)
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    rows = q.execute().data
    for r in rows:
        st = r.pop("students", None) or {}
        rt = r.pop("record_types", None) or {}
        r["student_lrn"] = st.get("lrn")
        r["student_name"] = f"{st.get('first_name', '')} {st.get('last_name', '')}".strip() or None
        r["type_name"] = rt.get("type_name")
    return rows