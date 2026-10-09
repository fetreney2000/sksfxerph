"""Generate db/seed.sql from scripts/seed-hashes.json.

Kept as a generator rather than hand-written SQL because the scrypt hashes are
random per run — regenerating means the documented plaintext passwords and the
stored hashes can never drift apart silently.

    node scripts/gen-seed-hashes.js   # refresh seed-hashes.json
    python scripts/_gen_seed.py       # emit db/seed.sql
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
hashes = json.loads((root / "scripts" / "seed-hashes.json").read_text(encoding="utf-8"))

# username -> (role, full_name, email)
ACCOUNTS = [
    ("nurul.aisyah", "guru_biasa", "Nurul Aisyah binti Rahim", "nurul.aisyah@sk0000.local"),
    ("ramlan.yusof", "gpk", "Ramlan bin Yusof", "ramlan.yusof@sk0000.local"),
    ("zulkifli.rahman", "guru_besar", "Zulkifli bin Rahman", "zulkifli.rahman@sk0000.local"),
    ("pentadbir.sk", "pentadbir", "Pentadbir eRPH", "pentadbir@sk0000.local"),
]

rows = []
for username, role, full_name, email in ACCOUNTS:
    h = hashes[username]["hash"]
    pwd = hashes[username]["password"]
    rows.append(
        f"  -- username: {username:<18} password: {pwd}\n"
        f"  ('{username}', '{h}', '{full_name}', '{email}', '{role}', true)"
    )
user_rows = ",\n".join(rows)
usernames = ", ".join(f"'{u}'" for u, *_ in ACCOUNTS)

SQL = f"""-- ============================================================================
-- eRPH · SEED DATA (development)
-- ============================================================================
--
-- Run AFTER db/schema.sql, in the Supabase SQL editor.
--
-- ⚠  THE PASSWORDS BELOW ARE DEVELOPMENT CREDENTIALS AND THIS REPOSITORY IS
--    PUBLIC. They exist so you can log in as each role and exercise the UI.
--    For any deployment beyond your own machine:
--        node scripts/hash-password.js 'your-new-password'
--    paste the output over the hash, and delete the `password:` comment.
--
-- What gets seeded:
--   · 1 school            + its school_setting row
--   · 1 account per member_role  (guru_biasa / gpk / guru_besar / pentadbir,
--     plus an inactive `system` row used as a stable actor id for automated
--     rows — it cannot log in: is_active = false)
--   · a school_member row per account, mirroring the account role
--   · 3 subjects + 3 classes  — the FK targets a plan cannot be created without
--   · 1 submitted lesson plan so the reviewer screens have something to grade
--
-- Idempotent: every statement uses ON CONFLICT DO NOTHING or a WHERE NOT
-- EXISTS guard, so re-running is safe.
-- ============================================================================

-- ── 1 · school ───────────────────────────────────────────────────────────────
-- `SK0000` is only a starting value: nothing keys off it, and an administrator
-- can change it from /pentadbiran once the deployment is live. `resolveSchool()`
-- reads the active row, not this code, so a rename cannot strand the branding.
insert into erph.school (kod_sekolah, nama, level, ppd, jpn)
values ('SK0000', 'SK St. Francis Xavier', 'rendah', 'PPD Keningau', 'JPN Sabah')
on conflict (kod_sekolah) do nothing;

insert into erph.school_setting (school_id)
select id from erph.school where kod_sekolah = 'SK0000'
on conflict (school_id) do nothing;

-- ── 2 · subjects (the editor's subject selector reads these) ─────────────────
insert into erph.subject (code, nama, curriculum) values
  ('MAT',  'Matematik',     'KSSR'),
  ('BM',   'Bahasa Melayu', 'KSSR'),
  ('SAIN', 'Sains',         'KSSR')
on conflict (code) do nothing;

-- ── 3 · classes (rph_document.class_id is NOT NULL — no class, no plan) ──────
insert into erph.class (school_id, nama, tahun, session)
select s.id, v.nama, v.tahun, '2026/2027'
from erph.school s
cross join (values
  ('5 Amanah', 5::smallint),
  ('5 Bidara', 5::smallint),
  ('4 Melur',  4::smallint)
) as v(nama, tahun)
where s.kod_sekolah = 'SK0000'
on conflict (school_id, session, nama) do nothing;

-- ── 4 · one account per role ────────────────────────────────────────────────
insert into erph.user (username, password_hash, full_name, email, role, is_active)
values
{user_rows},
  -- Service account: not a person. Kept inactive so it can never be used to
  -- log in; exists so automated rows have a stable actor to reference.
  ('sistem.erph', '!not-a-password', 'Sistem eRPH', null, 'system', false)
on conflict do nothing;

-- ── 5 · membership (an account with no school cannot sync, review or report) ─
insert into erph.school_member (school_id, user_id, role)
select s.id, u.id, u.role
from erph.school s
join erph.user u
  on u.username in ({usernames})
where s.kod_sekolah = 'SK0000'
on conflict do nothing;

-- ── 6 · one submitted plan, so the reviewer screens are not empty ────────────
-- Complete by KPM's rules (profil + aktiviti + refleksi + intervensi), status
-- 'submitted' so a Guru Besar logging in can grade it immediately.
insert into erph.rph_document
  (school_id, owner_id, class_id, subject_code, session, week_no, plan_date,
   slot_time, status, payload, version, submitted_at)
select s.id, u.id, c.id, 'MAT', '2026/2027', 1, date '2026-10-05',
       time '07:30', 'submitted',
       jsonb_build_object(
         'payload_version', 1,
         'bilangan_murid', 28,
         'fasa_tema', 'Nombor & Operasi',
         'kod_sk', '3.1',
         'standard_kandungan', 'Mengenal, membaca dan menulis semula nombor hingga 100,000',
         'kod_sp', '3.1.1',
         'standard_pembelajaran', '3.1.1 Menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan',
         'bidang', 'Nombor & Operasi',
         'objektif', 'Murid dapat menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan dengan ketepatan 80%.',
         'aktiviti', jsonb_build_array(
           jsonb_build_object('masa', '10 minit', 'aktiviti_guru',
             'Set induksi: slaid nombor harian', 'aktiviti_murid',
             'Mengenal pasti nombor besar dalam kehidupan seharian'),
           jsonb_build_object('masa', '20 minit', 'aktiviti_guru',
             'Penerangan nilai tempat menggunakan carta digit',
             'aktiviti_murid', 'Saling mengajar dalam kumpulan'),
           jsonb_build_object('masa', '15 minit', 'aktiviti_guru',
             'PdM: agihan lembaran kerja', 'aktiviti_murid',
             'Menyelesaikan 5 soalan nombor hingga 100,000'),
           jsonb_build_object('masa', '5 minit', 'aktiviti_guru',
             'Penutup: kuiz pantas', 'aktiviti_murid', 'Menjawab di papan putih')
         ),
         'emk', jsonb_build_array('Kerjasama', 'Kreativiti', 'Nilai Murni: Amanah'),
         'kbat', 'Murid menganalisis nilai tempat bagi situasi sebenar.',
         'refleksi', '7 daripada 28 murid keliru dengan nilai “puluhan”.',
         'intervensi', 'Intervensi kumpulan kecil Khamis, 07:00-07:20.'
       ),
       1, now()
from erph.school s
join erph.user u on u.username = 'nurul.aisyah'
join erph.class c on c.school_id = s.id and c.nama = '5 Amanah' and c.session = '2026/2027'
where s.kod_sekolah = 'SK0000'
  and not exists (
    select 1 from erph.rph_document d
    where d.school_id = s.id and d.owner_id = u.id and d.class_id = c.id
      and d.session = '2026/2027' and d.week_no = 1 and d.plan_date = date '2026-10-05'
  );
"""

(root / "db" / "seed.sql").write_text(SQL, encoding="utf-8")
print(f"db/seed.sql written ({len(SQL)} chars)")
