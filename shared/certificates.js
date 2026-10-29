export const certificateIssuer = 'IBACMI Department of Information Technology';
export const maxCertificateJpegBytes = 1024 * 1024;
export const maxBulkCertificateRecipients = 200;

export function certificatePageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 6000 || height > 6000 || width * height > 20000000) {
    throw new Error('Use a JPEG design no larger than 6000 pixels per side and 20 megapixels.');
  }
  const scale = 842 / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}
export const defaultCertificateLayout = {
  name: { x: 50, y: 46, width: 74, size: 5, color: '#172744', font: 'serif' },
  certificateId: { x: 50, y: 91, width: 70, size: 1.7, color: '#172744', font: 'sans-serif' },
  qr: { x: 82, y: 72, size: 11 },
};

export function clampCertificateLayout(layout, width, height) {
  const next = structuredClone(layout);
  for (const key of ['name', 'certificateId']) {
    const item = next[key];
    item.x = Math.min(100 - item.width / 2, Math.max(item.width / 2, item.x));
    item.y = Math.min(100 - item.size, Math.max(item.size, item.y));
  }
  next.qr.size = Math.min(next.qr.size, 90 * height / width);
  next.qr.x = Math.min(100 - next.qr.size, Math.max(0, next.qr.x));
  next.qr.y = Math.min(100 - next.qr.size * width / height, Math.max(0, next.qr.y));
  return next;
}

export function validCertificateLayout(layout, width, height) {
  if (!layout || !Number.isFinite(width) || !Number.isFinite(height) || width < 72 || height < 72 || width > 2000 || height > 2000) return false;
  for (const key of ['name', 'certificateId']) {
    const item = layout[key];
    if (!item || !['x', 'y', 'width', 'size'].every(field => typeof item[field] === 'number' && Number.isFinite(item[field])) ||
        item.width < 10 || item.width > 100 || item.size < 1 || item.size > 12 ||
        item.x - item.width / 2 < 0 || item.x + item.width / 2 > 100 ||
        item.y - item.size < 0 || item.y + item.size > 100 ||
        !/^#[0-9a-f]{6}$/i.test(item.color) || !['serif', 'sans-serif'].includes(item.font)) return false;
  }
  const qr = layout.qr;
  return Boolean(qr && ['x', 'y', 'size'].every(key => typeof qr[key] === 'number' && Number.isFinite(qr[key])) &&
    qr.size >= 7 && qr.size <= 30 && qr.x >= 0 && qr.y >= 0 &&
    qr.x + qr.size <= 100 && qr.y + qr.size * width / height <= 100);
}

export function certificateVerificationUrl(origin, token) {
  return `${new URL(origin).origin}/#/verify/${encodeURIComponent(token)}`;
}

export function certificateTime(value) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'long', timeStyle: 'medium', timeZone: 'Asia/Manila',
  }).format(new Date(value));
}
