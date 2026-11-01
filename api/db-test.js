
import { sql } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const result = await sql`SELECT NOW() AS server_time`;

    return res.status(200).json({
      success: true,
      message: "KASIRPRO berhasil terhubung ke Neon!",
      database: "Neon PostgreSQL",
      server_time: result[0].server_time
    });
  } catch (error) {
    console.error("Database error:", error);

    return res.status(500).json({
      success: false,
      message: "Koneksi database gagal."
    });
  }
}
