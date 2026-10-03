"""Run: python test_students.py"""
from datetime import date
from student_utils import compute_age, is_duplicate_error, sanitize_search, with_age

assert sanitize_search("Juan, (dela) Cruz%_;--") == "Juan dela Cruz--"
assert sanitize_search("a,b)or(id.eq.1") == "abor(id.eq.1".replace("(", "")
assert sanitize_search(None) == "" and len(sanitize_search("x" * 99)) == 50
assert compute_age("2015-06-15", date(2026, 6, 14)) == 10
assert compute_age("2015-06-15", date(2026, 6, 15)) == 11
assert compute_age(None) is None
assert with_age({"birthdate": "2015-01-01", "age": 99}, date(2026, 10, 3))["age"] == 11
assert with_age({"birthdate": None, "age": 8})["age"] == 8
class E(Exception): code = "23505"
assert is_duplicate_error(E()) and is_duplicate_error(Exception("duplicate key value"))
assert not is_duplicate_error(Exception("other"))
print("student helper tests passed")