import { useEffect, useState } from 'react';
import type { AxiosInstance } from 'axios';

/**
 * <img> biasa tak dapat menyertakan header Authorization, sedangkan file galeri
 * disajikan lewat endpoint ber-otentikasi (staf: `api`, portal: token portal).
 * Komponen ini mengambil gambar sebagai blob memakai instance axios yang sudah
 * membawa token, lalu menampilkannya via object URL (dibebaskan saat unmount).
 */
export function AuthImage({
  client, src, alt, className, style, onClick
}: {
  client: AxiosInstance;
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    client
      .get(src, { responseType: 'blob' })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, src]);

  if (failed) {
    return <div className={className} style={{ background: '#efe8da', display: 'grid', placeItems: 'center', color: '#a89e88', fontSize: 10, ...style }}>gagal</div>;
  }
  if (!url) {
    return <div className={className} style={{ background: '#e7ddc9', ...style }} />;
  }
  return <img src={url} alt={alt} className={className} style={style} loading="lazy" onClick={onClick} />;
}

/** Unduh file dari endpoint ber-otentikasi (blob → object URL → klik <a download>). */
export async function downloadViaClient(client: AxiosInstance, url: string, filename: string): Promise<void> {
  const res = await client.get(url, { responseType: 'blob' });
  const objectUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
