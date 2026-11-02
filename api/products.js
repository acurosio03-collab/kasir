import { sql } from "../lib/db.js";
import { getSessionUser } from "../lib/session.js";

export default async function handler(req, res) {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Silakan login terlebih dahulu"
      });
    }

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
        WHERE owner_id = ${user.userId}
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

