import crypto from "crypto";

const SECRET = process.env["SESSION_SECRET"] ?? "bread-lab-dev-secret";
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface TokenPayload {
  userId: string;
  firstName: string;
  starterName: string;
  exp: number;
}

export function signToken(userId: string, firstName: string, starterName: string): string {
  const payload: TokenPayload = { userId, firstName, starterName, exp: Date.now() + TOKEN_TTL_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as TokenPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
