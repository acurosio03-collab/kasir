
import { sql } from "../lib/db.js";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan"
    });
  }

  try {
    const resetKey = req.headers["x-reset-key"];

    if (
      !process.env.ADMIN_RESET_KEY ||
      resetKey !== process.env.ADMIN_RESET_KEY
    ) {
      return res.status(403).json({
        success: false,
        message: "Kunci reset tidak valid"
      });
    }

    const { email, newPassword } = req.body || {};

    if (!email || !newPassword || newPassword.length < 12) {
      return res.status(400).json({
        success: false,
        message: "Email wajib diisi dan password minimal 12 karakter"
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const result = await sql`
      UPDATE users
      SET password_hash = ${passwordHash}
      WHERE LOWER(email) = LOWER(${email.trim()})
      RETURNING id, name, email
    `;

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message: "Akun admin tidak ditemukan"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password admin berhasil diperbarui"
    });

  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      success: false,
      message: "Gagal memperbarui password"
    });
  }
}
  
