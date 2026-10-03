-- A) Duplicate LRNs (must return 0 rows before the unique index can be made)
select lrn, count(*) from public.students group by lrn having count(*) > 1;

-- B) Status values currently used
select status, count(*) from public.students group by status order by 2 desc;

-- C) Grade formats currently used (analytics expects "Grade 1" ... "Grade 6")
select grade, count(*) from public.students group by grade order by 1;

-- D) Students missing gender (section generator needs it)
select count(*) as missing_gender from public.students where gender is null;

-- E) Students whose section text matches no row in sections
select distinct s.section from public.students s
left join public.sections x on x.name = s.section
where s.section is not null and x.id is null;