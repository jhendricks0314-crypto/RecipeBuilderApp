// Prepares a receipt file for the API.
//
// Claude reads JPEG, PNG, GIF and WebP images, plus PDFs. Phones hand you all
// sorts of other things — HEIC from an iPhone, BMP or TIFF from a scanner — and
// photos are often 8–12MB, which is slow to upload and wasteful to send.
//
// So: PDFs pass through untouched (Walmart's downloadable receipt is one, and
// it reads far more accurately than a photo). Anything else is drawn to a canvas
// and re-encoded as JPEG, which both converts the format and shrinks it. If the
// browser can display it, this can convert it.
const MAX_EDGE = 1800        // plenty for receipt text, far smaller than a raw photo
const JPEG_QUALITY = 0.82
const MAX_BYTES = 25 * 1024 * 1024

export async function prepareReceiptFile(file) {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is too large (${(file.size / 1048576).toFixed(1)}MB). Max 25MB.`)
  }

  const isPDF = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPDF) {
    return { base64: await toBase64(file), mediaType: 'application/pdf', name: file.name }
  }

  try {
    return { ...(await toJpeg(file)), name: file.name }
  } catch {
    // The browser couldn't decode it — HEIC on desktop Chrome is the usual
    // culprit. Send the original and let the server explain if it can't read it.
    return { base64: await toBase64(file), mediaType: file.type || 'image/jpeg', name: file.name }
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.readAsDataURL(file)
  })
}

async function toJpeg(file) {
  const bitmap = await decode(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'          // receipts are white; avoids black edges on transparency
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  // Safari and older browsers: go via an <img>, which also picks up any HEIC
  // support the OS provides.
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}
