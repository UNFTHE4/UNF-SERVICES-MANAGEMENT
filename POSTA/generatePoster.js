async function fetchLogoAsBase64(url, timeoutMs = 10000) {
  if (!url) return null;
  let target = url.startsWith('http://') ? 'https://' + url.slice(7) : url;

  // ESPN's CDN requires a browser-like User-Agent and Accept header
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://www.espn.com/',
      },
    });
    if (!res.ok) {
      console.warn(`Logo fetch failed (${res.status}): ${target}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) {
      console.warn(`Logo too small (${buf.length}b): ${target}`);
      return null;
    }
    const ct = (res.headers.get('content-type') || '').split(';')[0] || 'image/png';
    if (!ct.startsWith('image/')) {
      console.warn(`Not an image (${ct}): ${target}`);
      return null;
    }
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn(`Logo fetch error for ${target}: ${e.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}
