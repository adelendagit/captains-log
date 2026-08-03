const crypto = require("crypto");

const pendingCodes = new Map();
const TOKEN_VERSION = 1;
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_LIFETIME_MS = 5 * 60 * 1000;

function encryptionKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.SESSION_SECRET || "trellosession")
    .digest();
}

function encodePart(value) {
  return Buffer.from(value).toString("base64url");
}

function decodePart(value) {
  return Buffer.from(value, "base64url");
}

function createMobileToken(user) {
  const payload = JSON.stringify({
    version: TOKEN_VERSION,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    user,
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [encodePart(iv), encodePart(tag), encodePart(encrypted)].join(".");
}

function decodeMobileToken(token) {
  try {
    const [ivPart, tagPart, encryptedPart] = String(token).split(".");
    if (!ivPart || !tagPart || !encryptedPart) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      decodePart(ivPart),
    );
    decipher.setAuthTag(decodePart(tagPart));
    const decrypted = Buffer.concat([
      decipher.update(decodePart(encryptedPart)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decrypted);
    if (
      payload.version !== TOKEN_VERSION ||
      !payload.user ||
      Number(payload.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return payload.user;
  } catch (_error) {
    return null;
  }
}

function createPairingCode(user) {
  const code = crypto.randomBytes(32).toString("base64url");
  const mobileUser = {
    id: user.id || user.idMember || user.profile?.id,
    displayName: user.displayName || user._json?.fullName || null,
    username: user.username || user._json?.username || null,
    token: user.token,
    tokenSecret: user.tokenSecret,
  };
  pendingCodes.set(code, {
    user: mobileUser,
    expiresAt: Date.now() + CODE_LIFETIME_MS,
  });
  return code;
}

function exchangePairingCode(code) {
  const pending = pendingCodes.get(code);
  pendingCodes.delete(code);
  if (!pending || pending.expiresAt <= Date.now()) return null;
  return createMobileToken(pending.user);
}

function mobileBearerAuthentication(req, _res, next) {
  if (!req.user) {
    const match = req.get("authorization")?.match(/^Bearer\s+(.+)$/i);
    if (match) req.user = decodeMobileToken(match[1]);
  }
  next();
}

module.exports = {
  createPairingCode,
  decodeMobileToken,
  exchangePairingCode,
  mobileBearerAuthentication,
};
