-- 1) EXISTING TABLES (already in the project; unchanged)
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  name text,
  grade text,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  lrn text not null,
  first_name text not null,
  last_name text not null,
  grade text,
  status text default 'Enrolled',
  created_at timestamp default now(),
  age smallint,
  section text
);

-- 2) ADDITIONS TO EXISTING TABLES
-- ERD fields (Birthdate, Address), gender for the section generator
-- (class size and gender balance), archive flags, and class size cap.
alter table public.students
  add column if not exists birthdate date,
  add column if not exists address text,
  add column if not exists gender text check (gender in ('Male', 'Female')),
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz;

alter table public.sections
  add column if not exists capacity smallint;

-- 3) REGISTRAR (user account)
-- The ERD lists a Password field. Passwords are NOT stored here:
-- Supabase Auth stores them hashed. This table holds the rest.
create table if not exists public.registrars (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'registrar' check (role in ('admin', 'registrar')),
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.registrars (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) RECORD TYPE + STUDENT RECORD + DOCUMENTS + OCR (from the ERD)
-- record_types also feeds the "request type" dropdown.
-- Seed values are placeholders: confirm with the registrar.
create table if not exists public.record_types (
  id serial primary key,
  type_name text not null unique,
  description text
);

insert into public.record_types (type_name, description) values
  ('Form 137', 'Permanent record'),
  ('SF10', 'Learner permanent academic record'),
  ('Certificate', 'Certificates issued by the registrar')
on conflict (type_name) do nothing;

create table if not exists public.student_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  record_type_id int references public.record_types(id),
  upload_date timestamptz not null default now(),
  version int not null default 1,
  is_archived boolean not null default false,
  archived_at timestamptz
);

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.student_records(id) on delete cascade,
  file_name text not null,
  file_type text,
  upload_date timestamptz not null default now()
);

create table if not exists public.ocr_results (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.document_files(id) on delete cascade,
  extract_text text,
  scan_status text
);

-- 5) REQUESTS (Request page: priority, status, dates)
-- NOT in the original ERD but shown in the Reports/Request wireframe and
-- required by the adviser's revisions. Add it to the ERD in the document.
-- Priority names are placeholders (adviser asked to change "URGENT" etc.).
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  record_type_id int references public.record_types(id),
  remarks text,
  priority text not null default 'Normal'
    check (priority in ('Low', 'Normal', 'High', 'Critical')),
  status text not null default 'Ongoing'
    check (status in ('Ongoing', 'Completed', 'Removed')),
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  removed_at timestamptz,
  is_archived boolean not null default false,
  archived_at timestamptz
);

create or replace function public.set_request_status_dates()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Completed' and old.status is distinct from 'Completed' then
    new.completed_at := now();
  elsif new.status = 'Removed' and old.status is distinct from 'Removed' then
    new.removed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists requests_status_dates on public.requests;
create trigger requests_status_dates
  before update on public.requests
  for each row execute function public.set_request_status_dates();

-- 6) AUDIT / HISTORY TABLES (from the ERD)
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  registrar_id uuid references public.registrars(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.report_history (
  id bigint generated always as identity primary key,
  registrar_id uuid references public.registrars(id) on delete set null,
  report_type text not null,
  generated_date timestamptz not null default now()
);

create table if not exists public.batch_history (
  id bigint generated always as identity primary key,
  registrar_id uuid references public.registrars(id) on delete set null,
  process_date timestamptz not null default now(),
  status text
);

-- 7) GRADES + ENROLLMENT HISTORY (student profile and analytics)
create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  school_year text not null,
  subject text not null,
  quarter smallint check (quarter between 1 and 4),
  grade numeric(5, 2),
  created_at timestamptz not null default now()
);

-- One row per student per school year ("2025-2026"). This is the data
-- the retention / migration forecast is built on.
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  school_year text not null,
  grade_level text not null,
  section_id uuid references public.sections(id) on delete set null,
  status text not null default 'Enrolled'
    check (status in ('Enrolled', 'Promoted', 'Transferred Out', 'Dropped', 'Graduated')),
  created_at timestamptz not null default now()
);

-- 8) PREDICTIVE ANALYTICS (linear regression done inside Postgres)
create or replace view public.enrollment_counts
with (security_invoker = true) as
select school_year, grade_level, count(*)::int as total
from public.enrollments
where status = 'Enrolled'
group by school_year, grade_level
order by school_year, grade_level;

-- Usage from the frontend: select * from forecast_enrollment(1);
-- Needs at least 2 school years of data per grade level.
create or replace function public.forecast_enrollment(p_years_ahead int default 1)
returns table (grade_level text, target_year int, predicted_total int)
language sql
stable
as $$
  with yearly as (
    select e.grade_level,
           split_part(e.school_year, '-', 1)::int as yr,
           count(*)::int as total
    from public.enrollments e
    where e.status = 'Enrolled'
    group by e.grade_level, split_part(e.school_year, '-', 1)::int
  ),
  fit as (
    select y.grade_level,
           regr_slope(y.total, y.yr) as slope,
           regr_intercept(y.total, y.yr) as intercept,
           max(y.yr) as last_year
    from yearly y
    group by y.grade_level
    having count(*) >= 2
  )
  select f.grade_level,
         f.last_year + p_years_ahead,
         greatest(round(f.intercept + f.slope * (f.last_year + p_years_ahead)), 0)::int
  from fit f
  order by f.grade_level;
$$;

-- 9) SECURITY (RLS) -- DO NOT RUN THIS YET OR YOU'LL EKUSUPURUSION INTO SMITERINS (IDK THE SPELLING)
-- Run this block only AFTER login works on the frontend. Turning on RLS
-- before then will block the pages that currently use the anon key.
--
-- alter table public.students        enable row level security;
-- alter table public.sections        enable row level security;
-- alter table public.registrars      enable row level security;
-- alter table public.record_types    enable row level security;
-- alter table public.student_records enable row level security;
-- alter table public.document_files  enable row level security;
-- alter table public.ocr_results     enable row level security;
-- alter table public.requests        enable row level security;
-- alter table public.activity_logs   enable row level security;
-- alter table public.report_history  enable row level security;
-- alter table public.batch_history   enable row level security;
-- alter table public.grades          enable row level security;
-- alter table public.enrollments     enable row level security;
--
-- Then one policy per table, for example:
-- create policy "authenticated full access" on public.students
--   for all to authenticated using (true) with check (true);