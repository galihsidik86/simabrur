/**
 * Buat thumbnail JPEG kecil dari sebuah file gambar DI SISI KLIEN (canvas),
 * lalu diunggah bersama foto asli. Tujuannya agar grid galeri memuat berkas
 * mini (bukan foto penuh) — hemat kuota jamaah. Tanpa pustaka server (sharp),
 * dan mendukung apa pun yang bisa didekode browser (JPG/PNG/WEBP).
 *
 * Mengembalikan null bila dekode gagal → server otomatis menyajikan foto penuh.
 */
export async function makeThumbnail(file: File, maxDim = 480, quality = 0.72): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
  } catch {
    return null;
  }
}
