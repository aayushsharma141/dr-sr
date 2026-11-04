// Dependency-free PDF page counter + MediaBox reader for Chromium/Skia PDFs (Node >= 18).
// Skia writes PDF-1.4 with plain (non-compressed) page dictionaries, so a text scan is enough.
// Usage: node pdfinfo.mjs file.pdf [more.pdf ...]
import { readFileSync } from 'node:fs'

const PT_PER_MM = 72 / 25.4

export function pdfPages(path) {
  const text = readFileSync(path).toString('latin1')
  const pages = []
  for (const obj of text.split('endobj')) {
    if (!/\/Type\s*\/Page(?![s\w])/.test(obj)) continue // /Page but not /Pages
    const box = obj.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/)
    if (!box) continue
    const w = Number(box[3]) - Number(box[1])
    const h = Number(box[4]) - Number(box[2])
    pages.push({ widthMm: +(w / PT_PER_MM).toFixed(1), heightMm: +(h / PT_PER_MM).toFixed(1) })
  }
  return pages
}

if (process.argv[1] && process.argv[1].endsWith('pdfinfo.mjs')) {
  for (const f of process.argv.slice(2)) {
    const pages = pdfPages(f)
    console.log(f.split(/[\\/]/).pop(), '=>', pages.length, 'page(s):', JSON.stringify(pages))
  }
}
