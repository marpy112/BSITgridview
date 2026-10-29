import { certificateVerificationUrl, certificatePageSize, maxCertificateJpegBytes, maxBulkCertificateRecipients } from '../../shared/certificates.js';

export function pdfBytes(base64) {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

export async function readCertificateJpeg(file) {
  if (!file || file.size > maxCertificateJpegBytes || !/\.jpe?g$/i.test(file.name)) throw new Error('Choose a JPEG (.jpg or .jpeg) design of up to 1 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  const { PDFDocument } = await import('pdf-lib');
  let dimensions;
  try {
    const pdf = await PDFDocument.create();
    const jpeg = await pdf.embedJpg(data);
    dimensions = { width: jpeg.width, height: jpeg.height };
  } catch { throw new Error('This file could not be opened. Upload a valid JPEG image.'); }
  certificatePageSize(dimensions.width, dimensions.height);
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await imageFromUrl(sourceUrl);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 3200 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    // Bake in EXIF orientation so the image preview and PDF export have identical geometry.
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    let jpegBase64;
    for (const quality of [0.95, 0.87, 0.79, 0.71, 0.63, 0.55]) {
      jpegBase64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (jpegBase64.length <= 1380000) break;
    }
    if (jpegBase64.length > 1380000) throw new Error('The JPEG is too detailed to save. Export a smaller image and try again.');
    return { jpegBase64, ...certificatePageSize(canvas.width, canvas.height) };
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export async function renderCertificateDesign(template) {
  if (template.jpegBase64) return `data:image/jpeg;base64,${template.jpegBase64}`;
  // The legacy build includes Map/WeakMap compatibility helpers needed by embedded browsers.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: pdfBytes(template.pdfBase64), isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1800 / Math.max(original.width, original.height) });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally { await task.destroy(); }
}

export async function certificateQr(url) {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(url, { width: 600, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('The certificate preview could not be rendered.')); image.src = url;
  });
}

// Preview and PDF use the same text artwork, including names outside Latin alphabets.
function textArtwork(value, item, width, height, bold) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * item.width / 100));
  canvas.height = Math.max(1, Math.round(height * item.size / 100 * 2));
  const context = canvas.getContext('2d');
  let size = height * item.size / 100;
  const family = item.font === 'serif' ? 'Georgia, "Times New Roman", serif' : 'Arial, sans-serif';
  const font = () => `${bold ? '600' : '400'} ${size}px ${family}`;
  context.font = font();
  while (context.measureText(value).width > canvas.width - 2 && size > 1) { size -= 0.5; context.font = font(); }
  context.fillStyle = item.color; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(value, canvas.width / 2, canvas.height / 2, canvas.width);
  return canvas;
}

export async function certificatePreview(backgroundUrl, layout, name, id, qrUrl) {
  const [background, qr] = await Promise.all([imageFromUrl(backgroundUrl), imageFromUrl(qrUrl)]);
  const canvas = document.createElement('canvas'); canvas.width = background.width; canvas.height = background.height;
  const context = canvas.getContext('2d');
  context.drawImage(background, 0, 0);
  for (const [item, value, bold] of [[layout.name, name, true], [layout.certificateId, `Certificate ID: ${id}`, false]]) {
    const text = textArtwork(value, item, canvas.width, canvas.height, bold);
    context.drawImage(text, canvas.width * item.x / 100 - text.width / 2, canvas.height * item.y / 100 - text.height / 2);
  }
  const size = canvas.width * layout.qr.size / 100;
  context.drawImage(qr, canvas.width * layout.qr.x / 100, canvas.height * layout.qr.y / 100, size, size);
  return canvas.toDataURL('image/png');
}

export async function createCertificatePdf(template, certificates, { onProgress } = {}) {
  if (!Array.isArray(certificates) || !certificates.length || certificates.length > maxBulkCertificateRecipients) throw new Error('Choose a valid certificate batch.');
  if (new Set(certificates.map(item => item.id)).size !== certificates.length || new Set(certificates.map(item => item.token)).size !== certificates.length) throw new Error('Every certificate must have its own ID and verification QR code.');
  const verificationUrls = certificates.map(item => item.verificationUrl || certificateVerificationUrl(window.location.origin, item.token));
  if (new Set(verificationUrls).size !== certificates.length) throw new Error('Every certificate must have a different QR verification link.');
  if (certificates.some(item => item.status === 'revoked' || item.templateId !== template.id)) throw new Error('Use valid certificates from the same design.');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const [artwork] = await doc.embedPdf(pdfBytes(template.pdfBase64), [0]);
  for (const [index, certificate] of certificates.entries()) {
    const url = certificate.verificationUrl || certificateVerificationUrl(window.location.origin, certificate.token);
    const qr = await certificateQr(url);
    const page = doc.addPage([template.width, template.height]); page.drawPage(artwork);
    const scale = 3;
    for (const [item, value, bold] of [[template.layout.name, certificate.recipientName, true], [template.layout.certificateId, `Certificate ID: ${certificate.id}`, false]]) {
      const text = textArtwork(value, item, template.width * scale, template.height * scale, bold);
      const image = await doc.embedPng(text.toDataURL('image/png'));
      page.drawImage(image, { x: template.width * item.x / 100 - text.width / scale / 2,
        y: template.height * (1 - item.y / 100) - text.height / scale / 2, width: text.width / scale, height: text.height / scale });
    }
    const qrImage = await doc.embedPng(qr);
    const size = template.width * template.layout.qr.size / 100;
    page.drawImage(qrImage, { x: template.width * template.layout.qr.x / 100,
      y: template.height * (1 - template.layout.qr.y / 100) - size, width: size, height: size });
    onProgress?.(index + 1, certificates.length);
    if ((index + 1) % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const first = certificates[0];
  doc.setTitle(certificates.length === 1 ? `${first.title} - ${first.recipientName}` : `${first.title} - ${certificates.length} certificates`);
  doc.setAuthor(first.issuer); doc.setSubject(certificates.length === 1 ? `Certificate ID: ${first.id}` : `${certificates.length} individually verifiable certificates`);
  doc.setCreationDate(new Date(first.issuedAt));
  return doc.save();
}

function savePdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

export async function downloadCertificate(template, certificate) {
  savePdf(await createCertificatePdf(template, [certificate]), `${certificate.id}.pdf`);
}

export async function downloadCertificateBatch(template, certificates, options) {
  savePdf(await createCertificatePdf(template, certificates, options), `IBACMI-certificates-${certificates[0].id}.pdf`);
}
