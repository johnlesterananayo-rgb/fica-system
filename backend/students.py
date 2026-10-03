"""Student records CRUD (step 1). Delete = archive, added in step 2."""
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from deps import log_action, require_login, sb
from student_utils import is_duplicate_error, sanitize_search, with_age

router = APIRouter(prefix="/students", tags=["students"])
Status = Literal["Enrolled", "Promoted", "Transferred Out", "Dropped", "Graduated"]

class StudentIn(BaseModel):
    lrn: str = Field(pattern=r"^\d{6,12}$")  # tighten to exactly 12 digits for real data
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    grade: str = Field(pattern=r"^Grade [1-6]$")
    gender: Literal["Male", "Female"] | None = None
    birthdate: date | None = None
    address: str | None = None
    section: str | None = None
    status: Status = "Enrolled"

class StudentUpdate(BaseModel):
    lrn: str | None = Field(None, pattern=r"^\d{6,12}$")
    first_name: str | None = Field(None, min_length=1, max_length=80)
    last_name: str | None = Field(None, min_length=1, max_length=80)
    grade: str | None = Field(None, pattern=r"^Grade [1-6]$")
    gender: Literal["Male", "Female"] | None = None
    birthdate: date | None = None
    address: str | None = None
    section: str | None = None
    status: Status | None = None

@router.get("")
def list_students(
    search: str | None = None,
    grade: str | None = None,
    status: str | None = None,
    include_archived: bool = False,
    page: int = 1,
    page_size: int = 20,
    authorization: str | None = Header(None),
):
    require_login(authorization)
    page, page_size = max(page, 1), min(max(page_size, 1), 100)
    q = sb.table("students").select("*", count="exact")
    if not include_archived:
        q = q.eq("is_archived", False)
    if grade:
        q = q.eq("grade", grade)
    if status:
        q = q.eq("status", status)
    s = sanitize_search(search)
    if s:
        q = q.or_(f"lrn.ilike.%{s}%,first_name.ilike.%{s}%,last_name.ilike.%{s}%")
    start = (page - 1) * page_size
    res = q.order("last_name").order("first_name").range(start, start + page_size - 1).execute()
    return {"data": [with_age(r) for r in res.data], "total": res.count, "page": page, "page_size": page_size}

@router.get("/{student_id}")
def get_student(student_id: UUID, authorization: str | None = Header(None)):
    require_login(authorization)
    res = sb.table("students").select("*").eq("id", str(student_id)).execute()
    if not res.data:
        raise HTTPException(404, "Student not found")
    return with_age(res.data[0])

@router.post("", status_code=201)
def create_student(body: StudentIn, authorization: str | None = Header(None)):
    uid = require_login(authorization)
    try:
        res = sb.table("students").insert(body.model_dump(mode="json")).execute()
    except Exception as e:
        if is_duplicate_error(e):
            raise HTTPException(409, "A student with this LRN already exists")
        raise HTTPException(400, "Could not create student")
    row = res.data[0]
    log_action(uid, f"Created student {row['lrn']}")
    return with_age(row)

@router.patch("/{student_id}")
def update_student(student_id: UUID, body: StudentUpdate, authorization: str | None = Header(None)):
    uid = require_login(authorization)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        raise HTTPException(400, "Nothing to update")
    try:
        res = sb.table("students").update(changes).eq("id", str(student_id)).execute()
    except Exception as e:
        if is_duplicate_error(e):
            raise HTTPException(409, "A student with this LRN already exists")
        raise HTTPException(400, "Could not update student")
    if not res.data:
        raise HTTPException(404, "Student not found")
    log_action(uid, f"Updated student {res.data[0]['lrn']}: {', '.join(changes)}")
    return with_age(res.data[0])