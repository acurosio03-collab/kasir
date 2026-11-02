
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
    const setupKey = req.headers["x-setup-key"];

    if (
      !process.env.ADMIN_SETUP_KEY ||
      setupKey !== process.env.ADMIN_SETUP_KEY
    ) {
      return res.status(403).json({
        success: false,
        message: "Kunci setup tidak valid"
      });
    }

    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Semua kolom wajib diisi"
      });
    }

    if (password.length < 12) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 12 karakter"
      });
    }

    const existing = await sql`
      SELECT id FROM users LIMIT 1
    `;

    if (existing.length > 0) {
      return res.status(403).json({
        success: false,
        message: "Admin pertama sudah dibuat"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (
        ${name.trim()},
        ${email.trim().toLowerCase()},
        ${passwordHash}
      )
      RETURNING id, name, email
    `;

    return res.status(201).json({
      success: true,
      message: "Admin pertama berhasil dibuat",
      user: result[0]
    });

  } catch (error) {
    console.error("Setup admin error:", error);

    return res.status(500).json({
      success: false,
      message: "Gagal membuat admin"
    });
  }
  }
      
