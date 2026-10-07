from dotenv import load_dotenv
load_dotenv()
import os
from supabase import create_client

url = os.environ["SUPABASE_URL"]
print("Backend project URL:", url)
sb = create_client(url, os.environ["SUPABASE_SERVICE_KEY"])
users = sb.auth.admin.list_users()
print("Users found:", len(users))
for u in users:
    print("-", u.email, "| confirmed" if u.email_confirmed_at else "| NOT confirmed")