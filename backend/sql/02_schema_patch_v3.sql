-- 1) LRN must be unique (archived students keep their LRN too)
do $$
begin
  if exists (select 1 from public.students group by lrn having count(*) > 1) then
    raise notice 'Duplicate LRNs found: unique index NOT created. Fix them first.';
  else
    create unique index if not exists students_lrn_key on public.students (lrn);
  end if;
end $$;

-- 2) updated_at for version/audit purposes
alter table public.students
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();

-- 3) Indexes for search and the active-student list
create index if not exists idx_students_name
  on public.students (lower(last_name), lower(first_name));
create index if not exists idx_students_active_grade
  on public.students (grade) where not is_archived;

-- 4) Limit status to known values. NOT VALID = only checks new/changed rows, so old rows with odd values will not make this fail
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'students_status_check') then
    alter table public.students add constraint students_status_check
      check (status in ('Enrolled','Promoted','Transferred Out','Dropped','Graduated')) not valid;
  end if;
end $$;
