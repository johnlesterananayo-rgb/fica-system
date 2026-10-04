"""
FICA backend service.  Run:  uvicorn api:app --reload --port 8001
Env (.env, never commit): SUPABASE_URL, SUPABASE_SERVICE_KEY, FRONTEND_ORIGIN
"""
import os
from collections import defaultdict

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analytics import forecast_enrollment, risk_flags
from deps import require_login, sb
from sections import generate_sections
from students import router as students_router

app = FastAPI(title="FICA Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:5500")],
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
        sb.table("students").select("id,gender")
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