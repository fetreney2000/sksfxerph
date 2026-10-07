const { randomBytes, scrypt } = require("node:crypto");

const password = process.argv[2] || "cikgu123";
const salt = randomBytes(16);

scrypt(
  password,
  salt,
  64,
  { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  (err, hash) => {
    if (err) throw err;
    const stored =
      "scrypt$16384$8$1$" +
      salt.toString("base64url") +
      "$" +
      hash.toString("base64url");
    process.stdout.write(stored);
  },
);
