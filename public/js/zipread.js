// ---------- minimal streaming zip reader (zip64-aware, native DecompressionStream) ----------
async function zipEntries(blob) {
  const size = blob.size;
  const tailLen = Math.min(size, 65535 + 22 + 20);
  const tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a zip archive.');
  let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(tail.getBigUint64(loc + 8, true));
      const z = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
      if (z.getUint32(0, true) !== 0x06064b50) throw new Error('The zip file is damaged (zip64 directory missing).');
      count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    let lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    let x = p + 46 + nlen; const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true), sz = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(cd.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + sz;
    }
    out.push({ name, method, csize, usize, lho });
    p = xend + clen;
  }
  return out;
}
async function zipEntryStream(blob, e) {
  const h = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('The zip file is damaged (entry header missing).');
  const start = e.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = blob.slice(start, start + e.csize).stream();
  if (e.method === 0) return raw;
  if (e.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files. Unzip the export first and choose export.xml.');
    return raw.pipeThrough(new DecompressionStream('deflate-raw'));
  }
  throw new Error('Unsupported zip compression (method ' + e.method + '). Unzip the export first and choose the .xml or .csv file.');
}
async function zipEntryText(blob, e) {
  const s = await zipEntryStream(blob, e);
  return await new Response(s).text();
}
