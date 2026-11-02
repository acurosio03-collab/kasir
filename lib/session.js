
import { verifyToken } from "./auth.js";

export async function getSessionUser(req) {
  try {
    const cookies = req.headers.cookie || "";

    const token = cookies
      .split(";")
      .map(item => item.trim())
      .find(item => item.startsWith("kasir_token="))
      ?.substring("kasir_token=".length);

    if (!token) return null;

    return await verifyToken(token);
  } catch {
    return null;
  }
}
  
