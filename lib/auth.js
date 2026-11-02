
import { SignJWT, jwtVerify } from "jose";

const secret = process.env.JWT_SECRET;

if (!secret) {
  throw new Error("JWT_SECRET belum dikonfigurasi");
}

const key = new TextEncoder().encode(secret);

export async function createToken(user) {
  return await new SignJWT({
    userId: user.id,
    email: user.email
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, key);
  return payload;
}
