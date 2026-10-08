/* DERMAI : générateur de PDF, sans dépendance, sans réseau, sans stockage. Pur : des blocs de mise en page entrent, des octets PDF sortent.
   Polices standard du PDF (Helvetica, Helvetica-Bold, encodage WinAnsi) : rien n'est embarqué, tous les accents français sont couverts.
   Une photo n'entre que sous forme d'un JPEG déjà nettoyé par l'appelant (js/export-view.js : repassé par un canvas, donc sans métadonnées EXIF ni
   position GPS) ; ce module ne lit ni ne conserve rien d'autre.
   Blocs : title, hero (texte + image), heading, para, kv, bar (indicateur : libellé, barre, score, statut), list, step, note, space. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiPdf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAGE_W = 595, PAGE_H = 842, MARGIN = 48, TOP = 54, BOTTOM = 62;
  const INK = [0.16, 0.12, 0.14], MUTED = [0.43, 0.38, 0.4], PLUM = [0.35, 0.17, 0.23], TRACK = [0.93, 0.89, 0.9], ACCENT = [0.88, 0.44, 0.56];

  /* Largeurs Helvetica (AFM, 1000 = 1 em) des caractères ASCII 32 à 126. Les lettres accentuées prennent la largeur de leur lettre de base. */
  const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const EXTRA = { 'œ': 944, 'Œ': 1000, '«': 556, '»': 556, '…': 1000, '–': 556, '—': 1000, '’': 222, '‘': 222, '“': 333, '”': 333, '•': 350, '·': 278, '°': 400, '×': 584, '€': 556, ' ': 278, ' ': 278, 'ç': 500, 'Ç': 722, 'ß': 611 };
  /* Windows-1252 : caractères hors Latin-1 qui existent dans l'encodage WinAnsi des polices standard. */
  const CP1252 = { '€': 0x80, '…': 0x85, 'Œ': 0x8c, 'œ': 0x9c, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, ' ': 0x20 };

  const widthOf = ch => {
    if (EXTRA[ch] !== undefined) return EXTRA[ch];
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return W[c - 32];
    const base = ch.normalize('NFD').charAt(0), b = base.charCodeAt(0);
    return b >= 32 && b <= 126 ? W[b - 32] : 556;
  };
  /* Texte en points : le gras est mesuré 6 % plus large (marge de sécurité, jamais plus étroit que la réalité). */
  const measure = (str, size, bold) => [...String(str)].reduce((s, ch) => s + widthOf(ch), 0) * size / 1000 * (bold ? 1.06 : 1);

  /* Chaîne → octets WinAnsi (un octet par caractère, « ? » si le caractère n'existe pas). */
  function encode(str) {
    const out = [];
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      out.push(CP1252[ch] !== undefined ? CP1252[ch] : (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : c === 0xa0 ? 0xa0 : 0x3f);
    }
    return out;
  }
  const hex = bytes => '<' + bytes.map(b => (b < 16 ? '0' : '') + b.toString(16)).join('') + '>';
  const utf16hex = s => { const out = ['fe', 'ff']; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out.push((c >> 8).toString(16).padStart(2, '0'), (c & 255).toString(16).padStart(2, '0')); } return '<' + out.join('') + '>'; };
  const num = n => (Math.round(n * 100) / 100).toString();
  const col = c => c.map(num).join(' ');

  function wrap(str, size, bold, maxW) {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const cand = line ? line + ' ' + word : word;
        if (line && measure(cand, size, bold) > maxW) { lines.push(line); line = word; } else line = cand;
      }
      lines.push(line);
    }
    return lines;
  }

  /* JPEG : dimensions et nombre de composantes (marqueurs SOF). Autre chose qu'un JPEG 8 bits en gris ou en RVB : null (la photo est alors omise). */
  function jpegInfo(b) {
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        const comps = b[i + 9], precision = b[i + 4];
        const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
        return precision === 8 && w > 0 && h > 0 && (comps === 1 || comps === 3) && (m === 0xc0 || m === 0xc1 || m === 0xc2) ? { width: w, height: h, components: comps } : null;
      }
      i += 2 + len;
    }
    return null;
  }

  function layout(doc) {
    const pages = [], images = [];
    let ops = null, y = TOP;
    const newPage = () => { ops = []; pages.push(ops); y = TOP; };
    newPage();
    const room = h => PAGE_H - BOTTOM - y >= h;
    const ensure = h => { if (!room(h)) newPage(); };
    const text = (str, x, size, bold, color, base) => {
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${col(color || INK)} rg ${num(x)} ${num(PAGE_H - (base !== undefined ? base : y + size))} Td ${hex(encode(str))} Tj ET`);
    };
    const rect = (x, top, w, h, color) => ops.push(`${col(color)} rg ${num(x)} ${num(PAGE_H - top - h)} ${num(w)} ${num(h)} re f`);
    const CW = PAGE_W - 2 * MARGIN;
    const paras = (str, x, w, size, bold, color, lead) => { for (const l of wrap(str, size, bold, w)) { ensure(size * lead); text(l, x, size, bold, color); y += size * lead; } };

    for (const blk of doc.blocks) {
      switch (blk.t) {
        case 'space': y += blk.h || 8; break;
        case 'title': {
          ensure(70);
          text('dermai', MARGIN, 26, true, PLUM); y += 32;
          if (blk.sub) { text(blk.sub, MARGIN, 11, false, MUTED); y += 15; }
          if (blk.date) { text(blk.date, MARGIN, 10, false, MUTED); y += 14; }
          rect(MARGIN, y + 2, CW, 1.2, ACCENT); y += 12;
          break;
        }
        case 'hero': {
          const img = blk.image, ratio = img ? img.width / img.height : 1;
          const iw = img ? Math.min(110, 140 * ratio) : 0, ih = img ? iw / ratio : 0, tw = CW - (img ? iw + 18 : 0);
          const lines = []; for (const t of blk.lines) for (const l of wrap(t.text, t.size, t.bold, tw)) lines.push({ text: l, size: t.size, bold: t.bold, color: t.color });
          const th = lines.reduce((s, l) => s + l.size * 1.3, 0);
          ensure(Math.max(th, ih) + 8);
          const y0 = y; let yy = y0;
          for (const l of lines) { text(l.text, MARGIN, l.size, l.bold, l.color, yy + l.size); yy += l.size * 1.3; }
          if (img) { const idx = images.push(img); ops.push(`q ${num(iw)} 0 0 ${num(ih)} ${num(PAGE_W - MARGIN - iw)} ${num(PAGE_H - y0 - ih)} cm /Im${idx} Do Q`); }
          y = y0 + Math.max(th, ih) + 8;
          break;
        }
        case 'heading': ensure(46); y += 12; text(blk.text, MARGIN, 13, true, PLUM); y += 20; break;
        case 'para': paras(blk.text, MARGIN, CW, blk.size || 10, !!blk.bold, blk.muted ? MUTED : INK, 1.4); y += 4; break;
        case 'note': paras(blk.text, MARGIN, CW, 8.5, false, MUTED, 1.35); y += 4; break;
        case 'kv': {
          const lw = 130, ls = wrap(blk.value, 10, false, CW - lw);
          ensure(14 * ls.length);
          text(blk.label, MARGIN, 9.5, true, MUTED);
          for (const l of ls) { text(l, MARGIN + lw, 10, false, INK); y += 14; }
          break;
        }
        case 'bar': {
          ensure(20);
          const bx = MARGIN + 170, bw = 130, sc = Math.max(0, Math.min(100, Number(blk.score) || 0));
          text(blk.label, MARGIN, 10, false, INK);
          rect(bx, y + 3, bw, 6, TRACK); rect(bx, y + 3, bw * sc / 100, 6, PLUM);
          text(blk.score === null || blk.score === undefined ? 'n/d' : sc + '/100', bx + bw + 10, 10, true, INK);
          if (blk.tag) text(blk.tag, bx + bw + 62, 9, false, MUTED);
          y += 18;
          break;
        }
        case 'list': for (const it of blk.items) {
          const ls = wrap(it, 10, false, CW - 14); ensure(14 * ls.length);
          text('•', MARGIN, 10, false, PLUM);
          for (const l of ls) { text(l, MARGIN + 14, 10, false, INK); y += 14; }
        } y += 2; break;
        case 'step': {
          const ds = wrap(blk.detail || '', 9.5, false, CW - 14);
          ensure(34 + 13 * ds.length);
          text(blk.label, MARGIN, 8.5, false, MUTED); y += 12;
          text(blk.name, MARGIN, 10.5, true, INK); y += 15;
          for (const l of ds) { text(l, MARGIN + 14, 9.5, false, MUTED); y += 13; }
          y += 4;
          break;
        }
        default: break;
      }
    }

    /* Pied de page : mention cosmétique et numéro de page sur chaque page. */
    pages.forEach((p, i) => {
      ops = p;
      const base = PAGE_H - 34, n = (i + 1) + ' / ' + pages.length;
      ops.push(`${col(TRACK)} rg ${MARGIN} 46 ${CW} 0.6 re f`);   // filet au-dessus du pied de page (y compté depuis le bas)
      text(doc.footer || '', MARGIN, 8, false, MUTED, base);
      text(n, PAGE_W - MARGIN - measure(n, 8, false), 8, false, MUTED, base);
    });
    return { pages, images };
  }

  const ascii = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  const pad10 = n => String(n).padStart(10, '0');
  const stamp = d => { const p = x => String(x).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; };

  /* doc : { title, footer, date (Date), blocks }. Renvoie un Uint8Array (PDF 1.4). */
  function build(doc) {
    const { pages, images } = layout(doc);
    const objs = [];        // { head, data } : data = Uint8Array de flux, ou null
    const add = (head, data) => objs.push({ head, data: data || null }) && objs.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');           // rempli à la fin
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    add(`<< /Title ${utf16hex(doc.title || 'DERMAI')} /Producer ${utf16hex('DERMAI')} /CreationDate (${stamp(doc.date instanceof Date ? doc.date : new Date(0))}) >>`);
    const imgIds = images.map(im => {
      const info = jpegInfo(im.bytes);
      return add(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, im.bytes);
    });
    const kids = [];
    for (const ops of pages) {
      const data = ascii(ops.join('\n'));
      const cid = add(`<< /Length ${data.length} >>`, data);
      const xo = imgIds.length ? ` /XObject << ${imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo} >> /Contents ${cid} 0 R >>`));
    }
    objs[1].head = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;

    const chunks = [Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])], offsets = [];
    let pos = chunks[0].length;
    const push = u => { chunks.push(u); pos += u.length; };
    objs.forEach((o, i) => {
      offsets.push(pos);
      push(ascii(`${i + 1} 0 obj\n${o.head}\n`));
      if (o.data) { push(ascii('stream\n')); push(o.data); push(ascii('\nendstream\n')); }
      push(ascii('endobj\n'));
    });
    const xref = pos;
    push(ascii(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${pad10(o)} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(pos); let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  return { build, layout, measure, wrap, encode, jpegInfo, PAGE_W, PAGE_H, MARGIN };
});
