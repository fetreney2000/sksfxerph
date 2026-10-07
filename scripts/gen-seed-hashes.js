const { randomBytes, scrypt } = require("node:crypto");
const fs = require("node:fs");

/** Passwords for the seeded development accounts (documented in db/seed.sql). */
const ACCOUNTS = [
  { username: "nurul.aisyah", password: "guru2026" },
  { username: "ramlan.yusof", password: "penyelaras2026" },
  { username: "zulkifli.rahman", password: "admin2026" },
  { username: "ppd.petaling", password: "ppd2026" },
  { username: "jpn.selangor", password: "jpn2026" },
];

function hash(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, h) => {
        if (err) return reject(err);
        resolve(
          "scrypt$16384$8$1$" +
            salt.toString("base64url") +
            "$" +
            h.toString("base64url"),
        );
      },
    );
  });
}

(async () => {
  const out = {};
  for (const a of ACCOUNTS) {
    out[a.username] = { password: a.password, hash: await hash(a.password) };
  }
  fs.writeFileSync(
    require("path").join(__dirname, "seed-hashes.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(`generated ${Object.keys(out).length} hashes -> scripts/seed-hashes.json`);
})();
