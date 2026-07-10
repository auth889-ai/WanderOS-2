import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const iterations = 120_000;
const keyLength = 64;
const digest = "sha512";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");

  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash = "") {
  const [scheme, iterationText, salt, hash] = storedHash.split(":");

  if (scheme !== "pbkdf2" || !iterationText || !salt || !hash) {
    return false;
  }

  const parsedIterations = Number(iterationText);
  if (!Number.isInteger(parsedIterations) || parsedIterations < 10_000) {
    return false;
  }

  const candidate = pbkdf2Sync(password, salt, parsedIterations, keyLength, digest);
  const expected = Buffer.from(hash, "hex");

  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
