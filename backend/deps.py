"""Shared Supabase client + login check."""
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import HTTPException
from supabase import create_client

# Load the local backend/.env before initializing the Supabase client.
load_dotenv(Path(__file__).with_name(".env"))

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def require_login(authorization: str | None) -> str:
    """Frontend sends 'Authorization: Bearer <supabase access_token>'. Returns the user id."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    try:
        res = sb.auth.get_user(authorization.split(" ", 1)[1])
    except Exception:
        raise HTTPException(401, "Invalid token")
    if not res or not res.user:
        raise HTTPException(401, "Invalid token")
    return res.user.id

def log_action(user_id: str, action: str) -> None:
    """Best-effort write to activity_logs (audit trail)."""
    try:
        sb.table("activity_logs").insert({"registrar_id": user_id, "action": action}).execute()
    except Exception as e:
        print("activity log failed:", e)
