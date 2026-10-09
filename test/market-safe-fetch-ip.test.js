'use strict';
/* Phase 3B-5 : AUDIT CIBLÉ DES ADRESSES IP de safe-fetch (classifyIp et tables V4_SPECIAL / V6_SPECIAL / V6_ALLOCATED).
   POLITIQUE IPv6 : refus par défaut. Une adresse de 2000::/3 n'est publique que si elle est dans un bloc ALLOUÉ listé (V6_ALLOCATED) ET hors des préfixes à usage spécial.
   La liste des allocations est MINIMALE et NON VÉRIFIÉE (aucune ressource externe) : les tests prouvent la cohérence de la politique avec elle-même et avec un oracle écrit à part, pas son exhaustivité.
   Méthode : une politique « oracle » écrite ICI, séparément du code, avec un mécanisme différent (net.BlockList de Node + arithmétique BigInt), puis comparaison aux frontières de chaque préfixe
   et sur des centaines de milliers d'adresses. Les préfixes de l'oracle reprennent, de mémoire, les registres IANA des adresses à usage spécial (IPv4 et IPv6) : aucune ressource externe n'a été consultée.
   Données locales uniquement ; aucun accès réseau (aucune connexion n'est ouverte : classifyIp est une fonction pure). */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const S = require('../tools/market/safe-fetch.js');

/* ---------- oracle indépendant ---------- */
const ORACLE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];
const ORACLE_V6 = [
  ['::', 128], ['::1', 128], ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['100:0:0:1::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48],
  ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
];
const ORACLE_ALLOC = [['2003::', 18], ['2400::', 12], ['2600::', 12], ['2610::', 23], ['2620::', 23], ['2800::', 12], ['2a00::', 12], ['2c00::', 12]];
const bl4 = new net.BlockList(), bl6 = new net.BlockList(), bl6a = new net.BlockList();
for (const [p, b] of ORACLE_ALLOC) bl6a.addSubnet(p, b, 'ipv6');
for (const [p, b] of ORACLE_V4) bl4.addSubnet(p, b, 'ipv4');
for (const [p, b] of ORACLE_V6) bl6.addSubnet(p, b, 'ipv6');

const v4big = a => a.split('.').reduce((n, o) => n * 256n + BigInt(o), 0n);
const v4str = n => [24n, 16n, 8n, 0n].map(s => String((n >> s) & 255n)).join('.');
const v6big = a => {                                              // forme canonique par l'analyseur d'URL (jamais de notation pointée), puis expansion
  const c = new URL('http://[' + a + ']').hostname.slice(1, -1), h = c.split('::');
  const part = x => (x === '' ? [] : x.split(':'));
  const left = part(h[0]), right = h.length === 2 ? part(h[1]) : [], groups = h.length === 2 ? left.concat(Array(8 - left.length - right.length).fill('0'), right) : left;
  return groups.reduce((n, g) => n * 65536n + BigInt(parseInt(g, 16)), 0n);
};
const v6str = n => Array.from({ length: 8 }, (_, i) => ((n >> BigInt(16 * (7 - i))) & 0xffffn).toString(16)).join(':');
const range4 = (p, b) => { const s = v4big(p), size = 1n << BigInt(32 - b); return [s, s + size - 1n]; };
const range6 = (p, b) => { const s = v6big(p), size = 1n << BigInt(128 - b); return [s, s + size - 1n]; };
const oraclePublic4 = n => !bl4.check(v4str(n), 'ipv4');
const oraclePublic6 = n => (n >> 125n) === 1n && bl6a.check(v6str(n), 'ipv6') && !bl6.check(v6str(n), 'ipv6');

let seed = 20261014;
const rnd32 = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const rnd128 = () => ((BigInt(rnd32()) << 96n) | (BigInt(rnd32()) << 64n) | (BigInt(rnd32()) << 32n) | BigInt(rnd32()));
const rndIn = (lo, hi) => lo + (rnd128() % (hi - lo + 1n));

test('IP-1 les tables du code sont bien formées : préfixes alignés, longueurs valides, motifs connus', () => {
  const REASONS = new Set(['unspecified', 'private', 'carrier_grade_nat', 'loopback', 'link_local', 'reserved', 'documentation', 'benchmarking', 'multicast', 'ipv6_embedded_ipv4', 'ipv6_not_global_unicast', 'ipv6_unallocated']);
  assert.ok(Object.isFrozen(S.V4_SPECIAL) && Object.isFrozen(S.V6_SPECIAL) && Object.isFrozen(S.V6_GLOBAL));
  for (const r of S.V4_SPECIAL) { assert.ok(Object.isFrozen(r)); assert.ok(net.isIPv4(r.prefix) && r.bits >= 1 && r.bits <= 32 && REASONS.has(r.reason), r.prefix); const [s] = range4(r.prefix, r.bits); assert.equal(v4str(s), r.prefix, 'préfixe aligné : ' + r.prefix + '/' + r.bits); }
  for (const r of S.V6_SPECIAL) { assert.ok(Object.isFrozen(r)); assert.ok(net.isIPv6(r.prefix) && r.bits >= 1 && r.bits <= 128 && REASONS.has(r.reason), r.prefix); const [s] = range6(r.prefix, r.bits); assert.equal(s, v6big(r.prefix), 'préfixe aligné : ' + r.prefix + '/' + r.bits); }
  assert.deepEqual(S.V6_GLOBAL, { prefix: '2000::', bits: 3 });
  assert.ok(Object.isFrozen(S.V6_ALLOCATED) && Object.isFrozen(S.V6_ALLOCATED_STATUS));
  for (const r of S.V6_ALLOCATED) { assert.ok(Object.isFrozen(r) && net.isIPv6(r.prefix) && r.bits >= 3 && r.bits <= 32 && typeof r.holder === 'string', r.prefix); const [s0, e0] = range6(r.prefix, r.bits); assert.equal(s0, v6big(r.prefix), 'bloc aligné : ' + r.prefix + '/' + r.bits); assert.equal(s0 >> 125n, 1n, 'à l\'intérieur de 2000::/3 : ' + r.prefix); assert.equal(e0 >> 125n, 1n); }
  assert.equal(S.V6_ALLOCATED_STATUS.exhaustive, false, 'la liste ne se dit pas exhaustive'); assert.equal(S.V6_ALLOCATED_STATUS.verifiedAgainstRegistry, false, 'ni vérifiée contre le registre'); assert.equal(S.V6_ALLOCATED_STATUS.defaultDecision, 'refuse');
  assert.deepEqual(S.V6_ALLOCATED.map(r => r.prefix + '/' + r.bits), ORACLE_ALLOC.map(([p, b]) => p + '/' + b), 'mêmes blocs que l\'oracle (même source : mémoire)');
  // tout préfixe de l'oracle est couvert par au moins une ligne du code, à l'intérieur de 2000::/3 ou refusé d'office hors de 2000::/3
  for (const [p, b] of ORACLE_V4) assert.equal(S.classifyIp(p).public, false, p);
  for (const [p, b] of ORACLE_V6) assert.equal(S.classifyIp(p.endsWith('::') || p.includes('::') ? p : p).public, false, p);
});

test('IP-2 IPv4 : chaque préfixe réservé est refusé du premier au dernier octet ; les voisins sont jugés comme l\'oracle', () => {
  for (const [p, b] of ORACLE_V4) {
    const [lo, hi] = range4(p, b), mid = lo + (hi - lo) / 2n;
    for (const n of [lo, lo + 1n, mid, hi - 1n, hi]) { if (n < lo || n > hi) continue; const c = S.classifyIp(v4str(n)); assert.equal(c.public, false, v4str(n) + ' dans ' + p + '/' + b); assert.ok(c.reason, v4str(n)); }
    for (const n of [lo - 1n, hi + 1n]) { if (n < 0n || n > 0xffffffffn) continue; assert.equal(S.classifyIp(v4str(n)).public, oraclePublic4(n), 'voisin ' + v4str(n) + ' de ' + p + '/' + b); }
  }
  // motifs attendus pour les plages les plus sensibles
  for (const [a, reason] of Object.entries({ '10.0.0.1': 'private', '172.16.0.1': 'private', '172.31.255.255': 'private', '192.168.255.255': 'private', '127.0.0.1': 'loopback', '169.254.169.254': 'link_local', '100.64.0.0': 'carrier_grade_nat', '100.127.255.255': 'carrier_grade_nat',
    '0.0.0.0': 'unspecified', '192.0.2.1': 'documentation', '198.51.100.1': 'documentation', '203.0.113.1': 'documentation', '198.18.0.1': 'benchmarking', '224.0.0.1': 'multicast', '255.255.255.255': 'reserved', '192.31.196.1': 'reserved', '192.52.193.1': 'reserved', '192.175.48.1': 'reserved', '192.88.99.1': 'reserved' }))
    assert.equal(S.classifyIp(a).reason, reason, a);
  for (const a of ['172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '192.0.1.1', '192.31.195.255', '192.31.197.0', '192.52.192.255', '192.52.194.0', '192.175.47.255', '192.175.49.0', '198.17.255.255', '198.20.0.0', '223.255.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.0', '169.253.255.255', '169.255.0.0', '8.8.8.8', '1.1.1.1', '93.184.216.34', '41.0.0.1', '196.200.0.1'])
    assert.equal(S.classifyIp(a).public, true, a + ' est publique');
});

test('IP-3 IPv4 : toute forme non canonique est refusée (zéros initiaux, octal, hexadécimal, abrégé, entier, espaces, unicode)', () => {
  for (const a of ['01.1.1.1', '8.8.8.08', '012.0.0.1', '010.0.0.1', '0177.0.0.1', '127.000.000.001', '00.0.0.0', '0x7f.0.0.1', '0x7f000001', '127.1', '127.0.1', '2130706433', '017700000001', '8.8.8', '8.8.8.8.8', '8.8.8.256', '8.8.8.-1', '8.8.8.', '.8.8.8.8',
    ' 8.8.8.8', '8.8.8.8 ', '8.8.8.8\n', '\t8.8.8.8', '8.8.8.8%eth0', '8.8.8.8/32', '8.8.8.8:443', '８.８.８.８', '8．8．8．8', '', ' ', 'localhost', 'example.com', '8.8.8.8\u0000', '1e3.1.1.1', '+8.8.8.8', '8.8.8.+8']) {
    const c = S.classifyIp(a); assert.equal(c.public, false, JSON.stringify(a)); assert.ok(['invalid_address', 'unspecified', 'private', 'loopback'].includes(c.reason) || /./.test(c.reason), JSON.stringify(a));
    if (net.isIP(a) === 0) assert.equal(c.reason, 'invalid_address', JSON.stringify(a));
  }
  for (const bad of [null, undefined, 8, 8.8, {}, [], ['8.8.8.8'], true, Symbol('x'), () => '8.8.8.8', Buffer.from('8.8.8.8'), new String('8.8.8.8')]) assert.equal(S.classifyIp(bad).public, false);
  assert.equal(S.classifyIp('8.8.8.8').public, true, 'la forme canonique est acceptée');
});

test('IP-4 IPv4 : comparaison à l\'oracle sur toutes les frontières de /16 et 300 000 adresses aléatoires', () => {
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) for (const [c, d] of [[0, 0], [0, 1], [128, 128], [255, 254], [255, 255]]) {
    const n = BigInt(((a << 24) >>> 0) + (b << 16) + (c << 8) + d), ip = v4str(n);
    assert.equal(S.classifyIp(ip).public, oraclePublic4(n), ip);
  }
  for (let i = 0; i < 300000; i++) { const n = BigInt(rnd32()), ip = v4str(n); if (S.classifyIp(ip).public !== oraclePublic4(n)) assert.fail('écart avec l\'oracle : ' + ip); }
  for (const [p, b] of ORACLE_V4) { const [lo, hi] = range4(p, b); for (let i = 0; i < 300; i++) { const n = rndIn(lo, hi); if (S.classifyIp(v4str(n)).public) assert.fail('accepté dans un préfixe réservé : ' + v4str(n)); } }
});

test('IP-5 IPv6 : préfixes de documentation 2001:db8::/32 et 3fff::/20 refusés sur toute leur étendue ; le motif change exactement à la frontière', () => {
  for (const [p, b, label] of [['2001:db8::', 32, 'RFC 3849'], ['3fff::', 20, 'RFC 9637']]) {
    const [lo, hi] = range6(p, b);
    for (const n of [lo, lo + 1n, hi - 1n, hi, lo + (hi - lo) / 2n, rndIn(lo, hi), rndIn(lo, hi), rndIn(lo, hi)]) { const c = S.classifyIp(v6str(n)); assert.equal(c.public, false, label + ' ' + v6str(n)); assert.equal(c.reason, 'documentation', v6str(n)); assert.equal(c.kind, 'special'); }
    for (const n of [lo - 1n, hi + 1n]) { const c = S.classifyIp(v6str(n)); assert.equal(c.public, false, 'voisin immédiat : ' + v6str(n)); assert.equal(c.reason, 'ipv6_unallocated', 'le voisin n\'est plus de la documentation mais reste refusé : espace non alloué'); assert.equal(c.kind, 'unverified'); }
  }
  for (const a of ['2001:db8::', '2001:db8::1', '2001:DB8::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '3fff::', '3fff::1', '3fff:0:0:0:0:0:0:1', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:0abc::1']) assert.equal(S.classifyIp(a).reason, 'documentation', a);
  for (const a of ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::', '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::', '3fff:1000::1', '3fff:ffff::1']) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.equal(c.reason, 'ipv6_unallocated', a); }
});

test('IP-6 IPv6 : destinations à usage spécial refusées (protocoles IETF, Teredo, ORCHID, AS112, benchmarking, 6to4...) ; adresses globales acceptées', () => {
  const special = {
    '2001::': 'reserved', '2001:0:4136:e378:8000:63bf:3fff:fdd2': 'reserved' /* Teredo */, '2001:1::1': 'reserved' /* PCP anycast */, '2001:1::2': 'reserved', '2001:1::3': 'reserved', '2001:2::1': 'reserved' /* benchmarking */, '2001:3::1': 'reserved' /* AMT */,
    '2001:4:112::1': 'reserved' /* AS112 */, '2001:10::1': 'reserved' /* ORCHID */, '2001:20::1': 'reserved' /* ORCHIDv2 */, '2001:30::1': 'reserved' /* DETs */, '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff': 'reserved',
    '2620:4f:8000::': 'reserved', '2620:4f:8000::1': 'reserved', '2620:4f:8000:ffff:ffff:ffff:ffff:ffff': 'reserved', '2002::': 'ipv6_embedded_ipv4', '2002:7f00:1::': 'ipv6_embedded_ipv4', '2002:c0a8:101::1': 'ipv6_embedded_ipv4', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff': 'ipv6_embedded_ipv4',
    '5f00::1': 'ipv6_not_global_unicast' /* SRv6 SIDs */, '100::': 'ipv6_not_global_unicast' /* discard */, '100:0:0:1::1': 'ipv6_not_global_unicast', 'fec0::1': 'ipv6_not_global_unicast', 'fc00::': 'private', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff': 'private',
    'fe80::': 'link_local', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff': 'link_local', 'ff00::': 'multicast', 'ff02::1': 'multicast', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff': 'multicast', '::': 'unspecified', '::1': 'loopback'
  };
  for (const [a, reason] of Object.entries(special)) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.equal(c.reason, reason, a + ' → ' + c.reason); }
  // voisins des plages spéciales de 2000::/3 : jugés comme l'oracle (refusés tant qu'ils ne sont pas dans un bloc alloué)
  for (const [p, b] of ORACLE_V6.filter(([p]) => v6big(p) >> 125n === 1n)) { const [lo, hi] = range6(p, b); for (const n of [lo - 1n, hi + 1n]) assert.equal(S.classifyIp(v6str(n)).public, oraclePublic6(n), 'voisin ' + v6str(n) + ' de ' + p + '/' + b); }
  // la seule plage spéciale située DANS un bloc alloué : ses voisins immédiats sont acceptés, elle non
  { const [lo, hi] = range6('2620:4f:8000::', 48); for (const n of [lo - 1n, hi + 1n]) assert.equal(S.classifyIp(v6str(n)).public, true, 'voisin accepté : ' + v6str(n)); for (const n of [lo, hi]) assert.equal(S.classifyIp(v6str(n)).public, false); }
  // exemples d'adresses globales d'opérateurs connus (données locales, de mémoire) situées dans des blocs alloués listés : acceptées
  for (const a of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2620:fe::fe', '2400:cb00::1', '2800:3f0:4001:80a::200e', '2c0f:fb50::1', '2a01:4f8:10a:1::2', '2603:1030:20e::1', '2607:f8b0:4005:80f::200e', '2600:1f18::1', '2003::1', '2610:1::1'])
    assert.equal(S.classifyIp(a).public, true, a);
  // CONSÉQUENCE DOCUMENTÉE : des adresses réellement publiques mais situées hors des blocs listés sont refusées (échec sûr), faute de table d'allocations dans le dépôt
  for (const a of ['2001:4860:4860::8888', '2001:41d0:2:1::1', '2001:200::1', '2001:470::1', '2001:4200::1', '2a10::1', '2630::1']) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.equal(c.reason, 'ipv6_unallocated', a); }
  assert.equal(S.classifyIp('2606:4700:4700::1111').public, S.classifyIp('2606:4700:4700:0000:0000:0000:0000:1111').public); assert.equal(S.classifyIp('2606:4700:4700::1111').public, S.classifyIp('2606:4700:4700::1111'.toUpperCase()).public);
});

test('IP-7 IPv6 : formes IPv4 encapsulées, mappées, compatibles ou traduites refusées sous toutes leurs écritures, y compris vers une IPv4 publique', () => {
  const forms = ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:7f00:0001', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:7f00:0001', '::FFFF:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1', '::ffff:169.254.169.254', '::ffff:8.8.8.8', '::ffff:808:808', '::ffff:93.184.216.34',
    '::127.0.0.1', '::7f00:1', '::8.8.8.8', '::808:808', '::1.2.3.4', '0:0:0:0:0:0:7f00:1', '::ffff:0:0', '::ffff:0:127.0.0.1', '::ffff:0:8.8.8.8', '::ffff:0:7f00:1', '0:0:0:0:ffff:0:808:808',
    '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::8.8.8.8', '64:ff9b::808:808', '64:ff9b::a00:1', '64:ff9b:1::1', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', '64:ff9b:0:1::1',
    '2002:7f00:1::', '2002:0a00:0001::1', '2002:808:808::1', '2002:5db8:d822::1', '2001:0:5ef5:79fb:0:0:0:0', '2001:0:7f00:1::'];
  for (const a of forms) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.ok(['ipv6_embedded_ipv4', 'ipv6_not_global_unicast', 'reserved'].includes(c.reason), a + ' → ' + c.reason); }
  // l'IPv4 embarquée n'est jamais jugée publique : on ne « déballe » pas l'adresse
  assert.equal(S.classifyIp('::ffff:8.8.8.8').public, false); assert.equal(S.classifyIp('64:ff9b::8.8.8.8').public, false); assert.equal(S.classifyIp('2002:808:808::').public, false);
  // formes invalides ou ambiguës
  for (const a of ['::1%eth0', 'fe80::1%lo', '[::1]', '[2606:4700:4700::1111]', '::g', '1::2::3', ':::', '12345::', '2606:4700:4700::1111:', ' 2606:4700:4700::1111', '2606:4700:4700::1111 ', '2606:4700:4700::1111/64', '::ffff:127.0.0.256', '::ffff:127.0.0', '::ffff:01.0.0.1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7']) { const c = S.classifyIp(a); assert.equal(c.public, false, a); }
  assert.equal(S.classifyIp('::ffff:01.0.0.1').reason, 'invalid_address', 'zéro initial dans une IPv4 encapsulée');
});

test('IP-8 IPv6 : comparaison à l\'oracle sur 400 000 adresses (aléatoires, dans 2000::/3, dans chaque bloc alloué, dans chaque préfixe spécial) et toutes les frontières', () => {
  let publicCount = 0, unallocated = 0;
  const check = n => { const a = v6str(n), c = S.classifyIp(a); if (c.public !== oraclePublic6(n)) assert.fail('écart avec l\'oracle : ' + a + ' code=' + c.public); if (c.public) publicCount++; if (c.reason === 'ipv6_unallocated') unallocated++; };
  for (let i = 0; i < 100000; i++) check(rnd128());                                                                         // uniforme : presque toujours hors de 2000::/3
  for (let i = 0; i < 100000; i++) check((1n << 125n) | (rnd128() & ((1n << 125n) - 1n)));                                   // uniforme dans 2000::/3 : presque tout est non alloué
  for (const [p, b] of ORACLE_ALLOC) { const [lo, hi] = range6(p, b); for (let i = 0; i < 4000; i++) check(rndIn(lo, hi)); for (const n of [lo, lo + 1n, hi - 1n, hi, lo - 1n, hi + 1n]) check(n); }
  for (const [p, b] of ORACLE_V6) { const [lo, hi] = range6(p, b); for (let i = 0; i < 2000; i++) check(rndIn(lo, hi)); for (const n of [lo, hi, lo - 1n, hi + 1n]) if (n >= 0n && n < (1n << 128n)) check(n); }
  for (const r of S.V6_SPECIAL) { const [lo, hi] = range6(r.prefix, r.bits); for (let i = 0; i < 500; i++) { const n = rndIn(lo, hi); assert.equal(S.classifyIp(v6str(n)).public, false, 'ligne du code ' + r.prefix + '/' + r.bits); assert.equal(oraclePublic6(n), false, 'la ligne du code ' + r.prefix + '/' + r.bits + ' est aussi refusée par l\'oracle'); } }
  for (const r of S.V4_SPECIAL) { const [lo, hi] = range4(r.prefix, r.bits); for (let i = 0; i < 500; i++) { const n = rndIn(lo, hi); assert.equal(S.classifyIp(v4str(n)).public, false); assert.equal(oraclePublic4(n), false, 'la ligne du code ' + r.prefix + '/' + r.bits + ' est aussi refusée par l\'oracle'); } }
  assert.ok(publicCount > 20000 && unallocated > 90000, 'l\'échantillon contient des adresses acceptées (' + publicCount + ') et beaucoup d\'adresses non allouées refusées (' + unallocated + ')');
});

test('IP-9 de bout en bout : un DNS qui répond avec une de ces adresses ne provoque aucune connexion ; une adresse globale allouée est utilisée telle quelle', async () => {
  const mk = answers => { const calls = []; return { calls, deps: { now: () => 0, resolve: async () => answers.map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })), request: async c => { calls.push(c); return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: require('node:stream').Readable.from([Buffer.from('<html></html>')]), remoteAddress: c.address, abort() {} }; } } }; };
  for (const a of ['2001:db8::1', '3fff::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2002:7f00:1::', '2620:4f:8000::1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'fd00::1', 'fe80::1', '5f00::1', '192.31.196.1', '192.175.48.1', '192.52.193.1', '10.0.0.1', '169.254.169.254', '012.0.0.1', '8.8.8.08',
    '3ffe::1', '2000::1', '3000::1', '2001:4860:4860::8888', '2a10::1']) {
    const w = mk([a]); const r = await S.fetchPage('https://boutique-essai.invalid/', { deps: w.deps }); assert.equal(r.ok, false, a); assert.equal(r.failure.code, 'dns_forbidden_address', a); assert.equal(w.calls.length, 0, a + ' : aucune connexion');
  }
  // adresse dangereuse mêlée à une adresse publique : refus en entier
  for (const a of ['2001:db8::1', '2002:7f00:1::', '::ffff:7f00:1', 'fd00::1', '10.0.0.1', '012.0.0.1', '192.175.48.1']) { const m = mk(['2606:4700:4700::1111', a]); const rm = await S.fetchPage('https://boutique-essai.invalid/', { deps: m.deps }); assert.equal(rm.failure.code, 'dns_mixed_addresses', a); assert.equal(m.calls.length, 0); }
  // adresse non allouée mêlée à une adresse publique : jamais utilisée, la publique l'est
  for (const a of ['3ffe::1', '2000::1', '3000::1', '2001:4860:4860::8888']) {
    const m = mk([a, '2606:4700:4700::1111', '93.184.216.34']); const rm = await S.fetchPage('https://boutique-essai.invalid/', { deps: m.deps });
    assert.equal(rm.ok, true, a); assert.deepEqual(m.calls.map(c => c.address), ['2606:4700:4700::1111'], a + ' : seule l\'adresse publique est utilisée'); assert.deepEqual(rm.warnings, ['dns_unverified_addresses_ignored']);
  }
  const only4 = mk(['3ffe::1', '8.8.8.8']); const r4 = await S.fetchPage('https://boutique-essai.invalid/', { deps: only4.deps }); assert.equal(r4.ok, true); assert.deepEqual(only4.calls.map(c => c.address), ['8.8.8.8'], 'site à double pile : la connexion se fait en IPv4');
  for (const a of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2400:cb00::1', '2c0f:fb50::1', '2800:3f0::1', '2620:fe::fe', '93.184.216.34', '8.8.8.8']) { const w = mk([a]); const r = await S.fetchPage('https://boutique-essai.invalid/', { deps: w.deps }); assert.equal(r.ok, true, a); assert.equal(w.calls[0].address, a); assert.deepEqual(r.warnings, []); }
});

test('IP-10 espace global-unicast non alloué ou réservé : refusé par défaut (3ffe::/16, 2000::/8, 3000::/4 et tout 2000::/3 hors blocs alloués)', () => {
  const refused = (lo, hi, label) => { for (const n of [lo, lo + 1n, hi - 1n, hi, lo + (hi - lo) / 2n, rndIn(lo, hi), rndIn(lo, hi)]) { const c = S.classifyIp(v6str(n)); assert.equal(c.public, false, label + ' ' + v6str(n)); assert.ok(['ipv6_unallocated', 'documentation', 'reserved', 'ipv6_embedded_ipv4'].includes(c.reason), label + ' ' + v6str(n) + ' → ' + c.reason); } };
  refused(...range6('3ffe::', 16), '3ffe::/16');                                  // 6bone, retiré : réservé, jamais une adresse publique valide
  refused(...range6('2000::', 8), '2000::/8');                                    // début de 2000::/3, non alloué
  refused(...range6('3000::', 4), '3000::/4');                                    // 3000::/4 : non alloué, dont 3fff::/20 (documentation)
  for (const a of ['3ffe::', '3ffe::1', '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2000::', '2000::1', '20ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3000::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff']) assert.equal(S.classifyIp(a).public, false, a);
  assert.equal(S.classifyIp('3ffe::1').reason, 'ipv6_unallocated'); assert.equal(S.classifyIp('2000::1').reason, 'ipv6_unallocated'); assert.equal(S.classifyIp('3000::1').reason, 'ipv6_unallocated');
  assert.equal(S.classifyIp('3ffe::1').kind, 'unverified', 'non dangereuse en soi, mais jamais utilisée');
  // appartenir à 2000::/3 ne suffit pas : l\'espace non listé est refusé même s\'il n\'est dans aucun préfixe spécial
  let inRange = 0, accepted = 0; for (let i = 0; i < 20000; i++) { const n = (1n << 125n) | (rnd128() & ((1n << 125n) - 1n)); inRange++; if (S.classifyIp(v6str(n)).public) accepted++; }
  assert.ok(accepted / inRange < 0.05, 'moins de 5 % de 2000::/3 est accepté : ' + accepted + '/' + inRange);
});

test('IP-11 frontières de chaque bloc alloué : premier et dernier octets acceptés, voisins refusés sauf s\'ils sont eux-mêmes dans un bloc alloué', () => {
  for (const [p, b] of ORACLE_ALLOC) {
    const [lo, hi] = range6(p, b);
    for (const n of [lo, lo + 1n, lo + (hi - lo) / 2n, hi - 1n, hi]) { if (oraclePublic6(n) !== S.classifyIp(v6str(n)).public) assert.fail('écart interne ' + v6str(n)); }
    for (const n of [lo, hi]) assert.equal(S.classifyIp(v6str(n)).public, !bl6.check(v6str(n), 'ipv6'), 'bord du bloc ' + p + '/' + b + ' : ' + v6str(n));
    for (const n of [lo - 1n, hi + 1n]) { const inOther = ORACLE_ALLOC.some(([q, c]) => { const [l2, h2] = range6(q, c); return n >= l2 && n <= h2; }); assert.equal(S.classifyIp(v6str(n)).public, inOther && !bl6.check(v6str(n), 'ipv6'), 'voisin ' + v6str(n) + ' du bloc ' + p + '/' + b); }
  }
  // exemples explicites de frontières
  for (const [a, expected] of Object.entries({ '2400::': true, '240f:ffff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2410::': false, '23ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff': false, '2600::': true, '260f:ffff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2610::': true, '2610:1ff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2610:200::': false, '2611::': false,
    '2620::': true, '2620:1ff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2620:200::': false, '2621::': false, '2800::': true, '280f:ffff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2810::': false, '2a00::': true, '2a0f:ffff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2a10::': false, '2c00::': true, '2c0f:ffff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2c10::': false,
    '2003::': true, '2003:3fff:ffff:ffff:ffff:ffff:ffff:ffff': true, '2003:4000::': false, '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff': false, '2004::': false })) assert.equal(S.classifyIp(a).public, expected, a);
});

test('IP-12 la limite est écrite : liste minimale, non vérifiée, procédure de remplacement et conséquences documentées', () => {
  const fs = require('node:fs'), path = require('node:path'), readme = fs.readFileSync(path.join(__dirname, '../tools/market/README.md'), 'utf8'), code = fs.readFileSync(path.join(__dirname, '../tools/market/safe-fetch.js'), 'utf8');
  for (const needle of [/V6_ALLOCATED/, /refus par défaut/i, /non alloué/i, /3ffe::\/16/, /ipv6-unicast-address-assignments/, /minimale/i, /non vérifi/i, /double pile|dual-stack/i, /2001:4860/, /procédure/i]) assert.match(readme, needle, String(needle));
  assert.match(code, /LIMITE ASSUMÉE ET DOCUMENTÉE/); assert.match(code, /ipv6-unicast-address-assignments/);
  assert.doesNotMatch(readme, /liste exhaustive des allocations|exhaustivité garantie/i);
});
