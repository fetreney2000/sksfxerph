// biome-ignore-all lint/suspicious/noConsole: this is a CLI script, and its output is its interface.
/**
 * One complete week of demo RPH for Kartini Serah, signed by Bob Edrem.
 *
 * Drives the real RPCs rather than writing rows, so the plans pass through
 * submit_rph's completeness gate and sahkan_rph's role, scope and signature
 * checks exactly as they would from the UI. `erph.actor()` reads the
 * X-Erph-User header under service_role, which is how a script can act as a
 * named member.
 *
 * The signature is generated here, not in a browser. The design puts the key
 * pair in the reviewer's device; a script key is structurally a *second
 * device*, which the system allows and which verifies — but it is not Bob's
 * key, so signing from his laptop afterwards would produce a different one.
 *
 * Run:  node scripts/make-demo-week.mjs [--force]
 */
import crypto from "node:crypto";

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
// The JWT service-role key, not SUPABASE_SECRET_KEY: `sb_secret_…` is rejected
// on the PostgREST endpoint ("Forbidden use of secret API key in browser") and
// is for the Management API only.
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
// Deliberate. This creates and *approves* a week of RPH as a named teacher
// and a named reviewer, against whatever database the environment points at.
if (process.env.ERPH_DEMO !== "1") {
  console.error(
    "Refusing to run: this writes to the configured database and approves\n" +
      "plans as a named reviewer.\n\n" +
      "Set ERPH_DEMO=1 if that is what you mean.",
  );
  process.exit(1);
}
const FORCE = process.argv.includes("--force");

const SESSION = "2026/2027";
const TERM_START = Date.UTC(2026, 2, 16); // Monday 16 March 2026, as a date token
const DAY = 86_400_000;

async function api(path, { headers, ...init } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      // The app's client passes `db: { schema: "erph" }` to supabase-js, which
      // sets these. Without them PostgREST resolves every name against `public`
      // and reports the erph tables as missing.
      "Accept-Profile": "erph",
      "Content-Profile": "erph",
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const asUser = (id) => ({ headers: { "X-Erph-User": id } });

/** Current school week, mirroring lib/config.ts's currentWeek(). */
function currentWeek() {
  const now = Date.now();
  const myt = now + 8 * 3600_000; // tokens are MYT calendar days
  const dow = Math.floor((myt % DAY) / DAY) === 0 ? 0 : new Date(myt).getUTCDay();
  const toMonday = dow === 0 ? 1 : dow === 6 ? 2 : 0;
  const monday = myt + toMonday * DAY;
  return Math.max(1, Math.floor((monday - TERM_START) / DAY / 7) + 1);
}

const iso = (token) => new Date(token).toISOString().slice(0, 10);
const weekMonday = (w) => TERM_START + (w - 1) * 7 * DAY;

/* ── canonical JSON + ES256, matching lib/signature exactly ─────────────── */

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortDeep(v[k])]),
        )
      : v;
const canonicalize = (v) => JSON.stringify(sortDeep(v));
const sha256Hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const b64url = (b) => Buffer.from(b).toString("base64url");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const SPKI = b64url(publicKey.export({ type: "spki", format: "der" }));

/** Detached ES256 over the envelope's canonical bytes, raw r||s (P1363). */
function signEnvelope(envelope) {
  return b64url(
    crypto.sign("sha256", Buffer.from(canonicalize(envelope), "utf8"), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }),
  );
}

/* ── the week ───────────────────────────────────────────────────────────── */

const ACTIVITIES = [
  "Set induksi: slaid nombor harian",
  "Mengenal pasti nombor besar dalam kehidupan seharian",
  "Penerangan nilai tempat menggunakan carta digit",
  "Saling mengajar dalam kumpulan; melengkapkan carta",
  "PdPc: agihan lembaran kerja dan pemerhatian",
  "Menyelesaikan lima soalan nombor hingga 100,000",
  "Penutup: kuiz pantas",
];

const makePayload = (tajuk, objektif, refleksi) => ({
  payload_version: 2,
  fasa_tema: "Nombor & Operasi",
  bidang: "Nilai tempat",
  tajuk,
  standard_kandungan:
    "Mengenal, membaca dan menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan",
  standard_pembelajaran:
    "3.1.1 Menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan",
  objektif,
  kriteria_kejayaan:
    "Murid menulis semula nombor hingga 100,000 dengan ketepatan 80% dalam lembaran kerja.",
  aktiviti: ACTIVITIES.map((nama, i) => ({ nama, sub: i > 0 && i % 3 === 0 })),
  refleksi,
});

const DAYS = [
  {
    tajuk: "Nilai tempat bagi nombor hingga 100,000",
    objektif:
      "Murid dapat menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan dengan betul.",
    refleksi:
      "7 daripada 28 murid keliru dengan nilai puluhan. Intervensi kumpulan kecil Khamis, 07:00-07:20.",
  },
  {
    tajuk: "Membaca dan menulis nombor dalam bentuk perkataan",
    objektif:
      "Murid dapat menulis nombor hingga 100,000 dalam bentuk perkataan tanpa bimbingan.",
    refleksi: "Semua murid mencapai sasaran. Dua murid perlu pengukuhan dalam ejaan nombor.",
  },
  {
    tajuk: "Membanding dan menyusun nombor hingga 100,000",
    objektif: "Murid dapat menyusun nombor hingga 100,000 mengikut urutan menaik dan menurun.",
    refleksi:
      "Aktiviti kad disusun berjaya. Kumpulan B perlu masa tambahan untuk urutan menurun.",
  },
  {
    tajuk: "Penambahan dua nombor hingga 100,000",
    objektif:
      "Murid dapat menambah dua nombor hingga 100,000 dengan bantuan carta nilai tempat.",
    refleksi:
      "6 murid perlu latihan tambahan dengan blok nilai tempat sebelum tajuk seterusnya.",
  },
  {
    tajuk: "Penolakan dua nombor hingga 100,000",
    objektif:
      "Murid dapat menolak dua nombor hingga 100,000 dengan betul dalam lembaran kerja.",
    refleksi: "Kelas berjaya menguasai tajuk minggu ini. PdP minggu depan boleh diteruskan.",
  },
];

/* ── go ─────────────────────────────────────────────────────────────────── */

const week = currentWeek();
console.log(`School week ${week}, session ${SESSION}`);

const schools = await api(
  `/rest/v1/school?kod_sekolah=eq.${process.env.NEXT_PUBLIC_SCHOOL_CODE ?? "XCA1043"}&select=id,nama`,
);
const schoolId = schools?.[0]?.id;
if (!schoolId) throw new Error("School not found.");

// Resolved by username first: `or=(user.username...)` needs PostgREST to join
// and filter in one hop, which the schema cache does not always allow. Two
// plain queries are slower and cannot be wrong.
const users = await api(
  "/rest/v1/user?username=in.(kartini.serah,bob.edrem)&select=id,username,full_name",
);
const kartiniUser = users?.find((u) => u.username === "kartini.serah");
const bobUser = users?.find((u) => u.username === "bob.edrem");
if (!kartiniUser || !bobUser) throw new Error("Kartini or Bob not found.");

const members = await api(
  `/rest/v1/school_member?school_id=eq.${schoolId}` +
    `&user_id=in.(${kartiniUser.id},${bobUser.id})&select=user_id,role`,
);
const kartini = members?.find((m) => m.user_id === kartiniUser.id);
const bob = members?.find((m) => m.user_id === bobUser.id);
if (!kartini || !bob) throw new Error("Kartini or Bob has no membership here.");
console.log(`Kartini ${kartini.user_id}, Bob ${bob.user_id}`);

const classes = await api(
  `/rest/v1/class?school_id=eq.${schoolId}&session=eq.${SESSION}&select=id,nama&order=nama&limit=1`,
);
const cls = classes?.[0];
if (!cls) throw new Error("No class for this session.");

// Any subject code Kartini can use; the demo seeds use MAT.
// Looked up rather than hardcoded: the demo seed uses MAT, this school's own
// subject table does not, and a fixed code fails the foreign key on insert.
const subjects = await api(`/rest/v1/subject?select=code,nama&order=code&limit=1`);
const subjectCode = subjects?.[0]?.code;
if (!subjectCode) throw new Error("No subject configured for this school.");
console.log(`Class ${cls.nama}, subject ${subjectCode} (${subjects[0].nama})`);

const created = [];
for (let i = 0; i < 5; i += 1) {
  const planDate = iso(weekMonday(week) + i * DAY);
  const existing = await api(
    `/rest/v1/rph_document?school_id=eq.${schoolId}&owner_id=eq.${kartini.user_id}` +
      `&class_id=eq.${cls.id}&subject_code=eq.${subjectCode}&session=eq.${SESSION}` +
      `&week_no=eq.${week}&plan_date=eq.${planDate}&deleted_at=is.null&select=id,status`,
  );
  if (existing?.length && !FORCE) {
    console.log(`  ${planDate}: already exists (${existing[0].status}) — skipped`);
    created.push(existing[0].id);
    continue;
  }
  if (existing?.length && FORCE) {
    await api(`/rest/v1/rph_document?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
  }

  const payload = makePayload(DAYS[i].tajuk, DAYS[i].objektif, DAYS[i].refleksi);
  const inserted = await api(`/rest/v1/rph_document`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        school_id: schoolId,
        owner_id: kartini.user_id,
        class_id: cls.id,
        subject_code: subjectCode,
        session: SESSION,
        week_no: week,
        plan_date: planDate,
        slot_time: "07:20",
        slot_time_end: "12:40",
        payload,
        status: "draft",
        version: 1,
        content_hash: sha256Hex(canonicalize(payload)),
        client_updated_at: new Date().toISOString(),
      },
    ]),
  });
  const doc = inserted?.[0];
  if (!doc) throw new Error(`Insert failed for ${planDate}.`);
  created.push(doc.id);
  console.log(`  ${planDate}: created draft ${doc.id.slice(0, 8)}`);
}

console.log("\nSubmitting as Kartini…");
for (const id of created) {
  try {
    await api(`/rest/v1/rpc/submit_rph`, {
      method: "POST",
      ...asUser(kartini.user_id),
      body: JSON.stringify({ p_document: id }),
    });
    console.log(`  ${id.slice(0, 8)}: submitted`);
  } catch (e) {
    console.log(`  ${id.slice(0, 8)}: ${String(e.message).slice(0, 120)}`);
  }
}

console.log("\nSigning and approving as Bob…");
for (const id of created) {
  const docRows = await api(
    `/rest/v1/rph_document?id=eq.${id}&select=id,version,payload,status`,
  );
  const doc = docRows?.[0];
  if (!doc) continue;
  if (doc.status !== "submitted") {
    console.log(`  ${id.slice(0, 8)}: status ${doc.status}, not signing`);
    continue;
  }

  const envelope = {
    v: 1,
    alg: "ES256",
    kid: SPKI,
    doc: doc.id,
    ver: doc.version,
    hash: sha256Hex(canonicalize(doc.payload)),
    signer: bob.user_id,
    decision: "sahkan",
    at: new Date().toISOString(),
  };
  const signature = signEnvelope(envelope);

  await api(`/rest/v1/rph_signature`, {
    method: "POST",
    body: JSON.stringify({
      document_id: doc.id,
      document_version: doc.version,
      signer_id: bob.user_id,
      alg: "ES256",
      public_key: SPKI,
      signature,
      envelope,
    }),
  });

  try {
    await api(`/rest/v1/rpc/sahkan_rph`, {
      method: "POST",
      ...asUser(bob.user_id),
      body: JSON.stringify({
        p_document: doc.id,
        p_comment: "Data contoh — dijana oleh skrip untuk semakan paparan.",
      }),
    });
    console.log(`  ${doc.id.slice(0, 8)}: sahkan ✔`);
  } catch (e) {
    console.log(`  ${doc.id.slice(0, 8)}: ${String(e.message).slice(0, 160)}`);
  }
}

console.log("\nDone. Open /minggu → Cetak minggu.");
