
import { verifyToken } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan"
    });
  }

  try {
    const cookie = req.headers.cookie || "";

    const token = cookie
      .split(";")
      .map(item => item.trim())
      .find(item => item.startsWith("kasir_token="))
      ?.substring("kasir_token=".length);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Belum login"
      });
    }

    const user = await verifyToken(token);

    return res.status(200).json({
      success: true,
      user: {
        id: user.userId,
        email: user.email
      }
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Sesi tidak valid atau sudah kedaluwarsa"
    });
  }
                                    }
