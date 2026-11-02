
import { sql } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const products = await sql`
        SELECT
          id,
          name,
          sku,
          barcode,
          purchase_price,
          selling_price,
          stock,
          min_stock,
          unit,
          category_id,
          created_at
        FROM products
        ORDER BY created_at DESC
      `;

      return res.status(200).json({
        success: true,
        products
      });
    }

    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan"
    });
  } catch (error) {
    console.error("Products API error:", error);

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data produk"
    });
  }
      }
