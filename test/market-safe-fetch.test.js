'use strict';
/* Phase 3B-5 : SAFE-FETCH (tools/market/safe-fetch.js). Aucun accès réseau réel : DNS et transport sont SIMULÉS par injection ; une garde au niveau du processus fait échouer
   tout appel réel à net / tls / dns / http(s) / fetch (voir SF-20, dernier test, qui vérifie qu'aucune tentative n'a eu lieu). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { Readable, PassThrough } = require('node:stream');

/* ---------- garde réseau (installée AVANT le chargement du module testé) ---------- */
const breaches = [];
const trap = (name) => function () { breaches.push(name); throw new Error('ACCÈS RÉSEAU RÉEL INTERDIT : ' + name); };
net.Socket.prototype.connect = trap('net.Socket.connect'); net.connect = trap('net.connect'); net.createConnection = trap('net.createConnection');
tls.connect = trap('tls.connect'); http.request = trap('http.request'); http.get = trap('http.get'); dns.lookup = trap('dns.lookup'); dns.resolve = trap('dns.resolve');
dns.promises.lookup = trap('dns.promises.lookup'); dns.promises.resolve = trap('dns.promises.resolve'); globalThis.fetch = trap('fetch');
const realHttpsRequest = https.request;
https.request = trap('https.request');

const S = require('../tools/market/safe-fetch.js');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tools/market/safe-fetch.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/* ---------- environnement simulé ---------- */
function world(o) {
  const dnsMap = o.dns || {}, calls = { resolve: [], request: [] };
  let t = 0;
  const deps = {
    now: () => (t += 5),
    resolve: async h => {
      calls.resolve.push(h); const v = dnsMap[h], n = calls.resolve.filter(x => x === h).length;
      const val = typeof v === 'function' ? v(n) : v;
      if (val instanceof Error) throw val;
      if (!val) throw Object.assign(new Error('introuvable'), { code: 'ENOTFOUND' });
      return val.map(a => ({ address: a, family: a.includes(':') ? 6 : 4 }));
    },
    request: async call => {
      calls.request.push(call);
      const r = typeof o.route === 'function' ? o.route(call, calls.request.length) : o.route;
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r(call) : r;
    }
  };
  return { deps, calls };
}
const ADDR = '93.184.216.34';
const page = (call, extra) => Object.assign({ statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from('<html><title>Essai</title></html>')]), remoteAddress: call.address, aborted: 0, abort() { this.aborted++; } }, extra || {});
const redirect = (call, location, status) => page(call, { statusCode: status || 302, headers: { location }, body: Readable.from([]) });
const okWorld = (extra) => world(Object.assign({ dns: { 'boutique-essai.invalid': [ADDR] }, route: call => page(call) }, extra || {}));
const URL1 = 'https://boutique-essai.invalid/produits/serum?x=1#frag';

test('SF-1 limites et politique centralisées, figées ; aucune valeur numérique de limite dispersée dans le code', () => {
  assert.ok(Object.isFrozen(S.LIMITS) && Object.isFrozen(S.POLICY));
  for (const k of ['timeoutMs', 'socketTimeoutMs', 'maxRedirects', 'maxRawBytes', 'maxBodyBytes', 'maxUrlLength', 'maxAddresses', 'maxAddressAttempts']) assert.ok(Number.isFinite(S.LIMITS[k]) && S.LIMITS[k] > 0, k);
  assert.deepEqual(S.POLICY.allowedProtocols, ['https:']); assert.deepEqual(S.POLICY.allowedPorts, [443]);
  assert.ok(S.POLICY.allowedContentTypes.every(t => /^[a-z]+\/[a-z+.-]+$/.test(t)));
  for (const code of Object.keys(S.FAILURES)) assert.ok(typeof S.FAILURES[code] === 'string' && S.FAILURES[code].length > 3, code);
  const code = strip(src), outside = code.replace(/const LIMITS = Object\.freeze\(\{[\s\S]*?\}\);/, '').replace(/const POLICY = Object\.freeze\(\{[\s\S]*?\n\}\);/, '');
  assert.doesNotMatch(outside.replace(/'(?:\\.|[^'\\\n])*'/g, "''"), /\b(10000|8000|2048|1024 \* 1024)\b/, 'les limites ne sont définies qu\'une fois, dans LIMITS (hors littéraux de texte : préfixes d\'adresses)');
  assert.ok(/\bmaxRedirects\b/.test(outside) && /limits\.timeoutMs/.test(outside) && /limits\.maxBodyBytes/.test(outside), 'le code lit les limites centralisées');
  // la politique n'est pas surchargeable par option : opts.policy n'existe pas
  assert.doesNotMatch(code, /opts\.policy|o\.policy/);
});

test('SF-2 validation d\'URL : protocoles, identifiants, ports, formats ambigus, noms locaux, caractères de contournement', () => {
  const ok = u => assert.equal(S.validateUrl(u).ok, true, u);
  const ko = (u, code) => { const r = S.validateUrl(u); assert.equal(r.ok, false, String(u)); assert.equal(r.code, code, String(u) + ' → ' + r.code); };
  ok('https://boutique-essai.invalid/a/b?c=d'); ok('HTTPS://Boutique-Essai.INVALID/'); ok('https://boutique-essai.invalid:443/x'); ok('https://boutique-essai.invalid./x'); ok('https://bücher.example/p');
  assert.equal(S.validateUrl(URL1).href, 'https://boutique-essai.invalid/produits/serum?x=1', 'le fragment est retiré');
  for (const u of ['http://boutique-essai.invalid/', 'ftp://boutique-essai.invalid/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'gopher://boutique-essai.invalid/', 'ws://boutique-essai.invalid/']) ko(u, 'protocol_not_allowed');
  for (const u of ['not a url', 'https://', 'https:///x', '//boutique-essai.invalid/', 'boutique-essai.invalid/x', 'https://exa mple.invalid/', 'https://evil.invalid\\@good.invalid/', 'https://a.invalid/\u0000', 'https://a.invalid/\n']) assert.equal(S.validateUrl(u).ok, false, u);
  for (const u of [' https://boutique-essai.invalid/', 'https://boutique-essai.invalid/ ', 'https://boutique-essai.invalid/\n', '\thttps://boutique-essai.invalid/']) ko(u, 'url_forbidden_characters');
  ko('https://user:pass@boutique-essai.invalid/', 'credentials_not_allowed'); ko('https://user@boutique-essai.invalid/', 'credentials_not_allowed'); ko('https://:pass@boutique-essai.invalid/', 'credentials_not_allowed');
  for (const p of [80, 8080, 8443, 22, 6379, 65535]) ko('https://boutique-essai.invalid:' + p + '/', 'port_not_allowed');
  // IP en clair, y compris toutes les notations ambiguës normalisées par l'analyseur d'URL
  for (const h of ['127.0.0.1', '2130706433', '0x7f.1', '0x7f000001', '017700000001', '127.1', '0177.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '8.8.8.8', '[::1]', '[::ffff:127.0.0.1]', '[fe80::1]', '[2606:4700:4700::1111]', '[::ffff:7f00:1]']) ko('https://' + h + '/', 'ip_literal_not_allowed');
  for (const h of ['localhost', 'LOCALHOST', 'a.localhost', 'printer.local', 'metadata.google.internal', 'db.internal', 'intranet', 'nas', 'router.home.arpa', 'x.lan']) ko('https://' + h + '/', 'hostname_not_public');
  ko('https://' + 'a'.repeat(64) + '.invalid/', 'hostname_invalid'); ko('https://a..invalid/', 'hostname_invalid');
  ko('https://boutique-essai.invalid/' + 'x'.repeat(S.LIMITS.maxUrlLength), 'url_too_long');
  for (const bad of [null, undefined, 42, {}, [], '', '   ', true]) ko(bad, 'invalid_input');
});

test('SF-3 classification des adresses IP : IPv4 réservées, IPv6 non globales, formes encapsulées', () => {
  const pub = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '11.0.0.1', '100.63.255.255', '100.128.0.1', '198.20.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '2400:cb00::1', '2c0f:fb50::1'];
  const prv = { '0.0.0.0': 'unspecified', '0.1.2.3': 'unspecified', '10.0.0.1': 'private', '10.255.255.255': 'private', '100.64.0.1': 'carrier_grade_nat', '100.127.255.255': 'carrier_grade_nat', '127.0.0.1': 'loopback', '127.255.255.254': 'loopback',
    '169.254.169.254': 'link_local', '172.16.0.1': 'private', '172.31.255.255': 'private', '192.0.0.1': 'reserved', '192.0.2.1': 'documentation', '192.168.0.1': 'private', '198.18.0.1': 'benchmarking', '198.19.255.255': 'benchmarking',
    '198.51.100.7': 'documentation', '203.0.113.9': 'documentation', '224.0.0.1': 'multicast', '239.255.255.255': 'multicast', '240.0.0.1': 'reserved', '255.255.255.255': 'reserved',
    '::': 'unspecified', '::1': 'loopback', '::ffff:127.0.0.1': 'ipv6_embedded_ipv4', '::ffff:8.8.8.8': 'ipv6_embedded_ipv4', '::ffff:7f00:1': 'ipv6_embedded_ipv4', '::7f00:1': 'ipv6_embedded_ipv4', '64:ff9b::7f00:1': 'ipv6_embedded_ipv4',
    'fe80::1': 'link_local', 'febf::1': 'link_local', 'fc00::1': 'private', 'fd12:3456::1': 'private', 'ff02::1': 'multicast', 'ff00::': 'multicast', '2001:db8::1': 'documentation', '2001::1': 'reserved', '2002:7f00:1::': 'ipv6_embedded_ipv4',
    '3fff::1': 'documentation', 'fec0::1': 'ipv6_not_global_unicast', '100::1': 'ipv6_not_global_unicast', '1::1': 'ipv6_not_global_unicast', '0:0:0:0:0:0:0:1': 'loopback', '0000:0000:0000:0000:0000:ffff:7f00:0001': 'ipv6_embedded_ipv4'};
  for (const a of pub) { const c = S.classifyIp(a); assert.equal(c.public, true, a); assert.equal(c.reason, null); }
  // politique IPv6 à refus par défaut : les adresses hors des blocs alloués listés sont refusées (voir market-safe-fetch-ip.test.js)
  for (const a of ['2001:4860:4860::8888', '2001:200::1', '3ffe::1', '2000::1', '3000::1']) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.equal(c.reason, 'ipv6_unallocated', a); }
  for (const [a, reason] of Object.entries(prv)) { const c = S.classifyIp(a); assert.equal(c.public, false, a); assert.equal(c.reason, reason, a + ' → ' + c.reason); }
  for (const bad of ['', 'x', '1.2.3', '256.1.1.1', '1.2.3.4.5', '::1%eth0', 'fe80::1%lo', ':::', '1::2::3', null, undefined, 5, {}]) { const c = S.classifyIp(bad); assert.equal(c.public, false, String(bad)); assert.equal(c.reason, 'invalid_address'); }
  // exhaustif sur les frontières : chaque /8 de 0 à 255 est classé ; seuls les blocs attendus sont publics
  const publicFirstOctets = []; for (let a = 0; a < 256; a++) if (S.classifyIp(a + '.1.2.3').public) publicFirstOctets.push(a);
  for (const a of [0, 10, 127, 224, 225, 239, 240, 255]) assert.ok(!publicFirstOctets.includes(a), 'premier octet ' + a);
  assert.ok(publicFirstOctets.includes(8) && publicFirstOctets.includes(93) && publicFirstOctets.includes(151));
});

test('SF-4 URL valide : succès complet, résultat structuré et tracé', async () => {
  const w = okWorld();
  const r = await S.fetchPage(URL1, { deps: w.deps });
  assert.equal(r.ok, true); assert.equal(r.schema, 'safe-fetch/1'); assert.equal(r.failure, null);
  assert.equal(r.requestedUrl, URL1); assert.equal(r.finalUrl, 'https://boutique-essai.invalid/produits/serum?x=1'); assert.equal(r.status, 200);
  assert.equal(r.contentType, 'text/html'); assert.equal(r.charset, 'utf-8'); assert.equal(r.body, '<html><title>Essai</title></html>'); assert.equal(r.bytes, Buffer.byteLength('<html><title>Essai</title></html>')); assert.equal(r.rawBytes, r.bytes);
  assert.deepEqual(r.redirects, []); assert.equal(r.trace.length, 1); assert.deepEqual(r.trace[0], { url: 'https://boutique-essai.invalid/produits/serum?x=1', hostname: 'boutique-essai.invalid', address: ADDR, family: 4, status: 200, location: null });
  assert.ok(r.elapsedMs > 0);
  assert.equal(w.calls.resolve.length, 1); assert.equal(w.calls.request.length, 1);
  const call = w.calls.request[0];
  assert.deepEqual([call.hostname, call.address, call.family, call.port, call.path], ['boutique-essai.invalid', ADDR, 4, 443, '/produits/serum?x=1']);
  assert.equal(call.headers['Accept-Encoding'], S.POLICY.acceptEncoding); assert.equal(call.headers['User-Agent'], S.POLICY.userAgent);
  assert.ok(!Object.keys(call.headers).some(h => /^(authorization|cookie|proxy-authorization)$/i.test(h)), 'aucun en-tête d\'identification');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'sérialisable sans perte');
});

test('SF-5 refus avant toute résolution ou connexion : protocole, URL malformée, adresse IP, nom local', async () => {
  for (const [u, code] of [['http://boutique-essai.invalid/', 'protocol_not_allowed'], ['file:///etc/passwd', 'protocol_not_allowed'], ['pas une url', 'url_forbidden_characters'], ['https://', 'malformed_url'], ['https://127.0.0.1/', 'ip_literal_not_allowed'],
    ['https://[::1]/', 'ip_literal_not_allowed'], ['https://169.254.169.254/latest/meta-data/', 'ip_literal_not_allowed'], ['https://user:pw@boutique-essai.invalid/', 'credentials_not_allowed'], ['https://boutique-essai.invalid:8443/', 'port_not_allowed'],
    ['https://localhost/', 'hostname_not_public'], [null, 'invalid_input'], [42, 'invalid_input']]) {
    const w = okWorld(); const r = await S.fetchPage(u, { deps: w.deps });
    assert.equal(r.ok, false, String(u)); assert.equal(r.failure.code, code, String(u) + ' → ' + r.failure.code); assert.equal(r.body, null); assert.equal(r.failure.hop, 0);
    assert.equal(w.calls.resolve.length, 0, 'aucune résolution DNS'); assert.equal(w.calls.request.length, 0, 'aucune connexion');
  }
});

test('SF-6 DNS : adresses publiques acceptées ; privées, loopback, link-local, IPv6 interdites, mixtes : refusées en entier, sans connexion', async () => {
  const cases = {
    publicV4: [['93.184.216.34'], true], publicV6: [['2606:4700:4700::1111'], true], publicBoth: [['93.184.216.34', '2606:4700:4700::1111'], true],
    private10: [['10.0.0.5'], 'dns_forbidden_address'], private172: [['172.16.9.9'], 'dns_forbidden_address'], private192: [['192.168.1.10'], 'dns_forbidden_address'], loopback: [['127.0.0.1'], 'dns_forbidden_address'],
    metadata: [['169.254.169.254'], 'dns_forbidden_address'], cgnat: [['100.64.1.1'], 'dns_forbidden_address'], zero: [['0.0.0.0'], 'dns_forbidden_address'],
    v6loop: [['::1'], 'dns_forbidden_address'], v6ula: [['fd00::1'], 'dns_forbidden_address'], v6ll: [['fe80::1'], 'dns_forbidden_address'], v6mapped: [['::ffff:127.0.0.1'], 'dns_forbidden_address'], v6nat64: [['64:ff9b::a00:1'], 'dns_forbidden_address'],
    mixedV4: [['93.184.216.34', '10.0.0.5'], 'dns_mixed_addresses'], mixedFirstPrivate: [['127.0.0.1', '93.184.216.34'], 'dns_mixed_addresses'], mixedV6: [['2606:4700:4700::1111', 'fd00::1'], 'dns_mixed_addresses'],
    mixedFamilies: [['93.184.216.34', '::1'], 'dns_mixed_addresses'], garbage: [['pas-une-ip'], 'dns_forbidden_address'], empty: [[], 'dns_no_address']
  };
  for (const [name, [addrs, expect]] of Object.entries(cases)) {
    const w = world({ dns: { 'boutique-essai.invalid': addrs }, route: call => page(call) });
    const r = await S.fetchPage(URL1, { deps: w.deps });
    if (expect === true) { assert.equal(r.ok, true, name); assert.equal(w.calls.request.length, 1, name); assert.equal(w.calls.request[0].address, addrs[0], name + ' : première adresse validée'); }
    else { assert.equal(r.ok, false, name); assert.equal(r.failure.code, expect, name + ' → ' + r.failure.code); assert.equal(w.calls.request.length, 0, name + ' : aucune connexion'); assert.equal(r.body, null); }
  }
  // détail d'un refus mixte : adresses interdites listées, publique conservée comme information
  const w = world({ dns: { 'boutique-essai.invalid': ['93.184.216.34', '10.0.0.5'] }, route: call => page(call) });
  const r = await S.fetchPage(URL1, { deps: w.deps });
  assert.deepEqual(r.failure.detail, { forbidden: [{ address: '10.0.0.5', reason: 'private' }], public: ['93.184.216.34'] });
  // erreurs de résolution
  for (const [e, code] of [[Object.assign(new Error('x'), { code: 'ENOTFOUND' }), 'dns_not_found'], [Object.assign(new Error('x'), { code: 'ENODATA' }), 'dns_not_found'], [Object.assign(new Error('x'), { code: 'ESERVFAIL' }), 'dns_error'], [new Error('boum'), 'dns_error'], [Object.assign(new Error('x'), { code: 'ETIMEOUT' }), 'dns_error']]) {
    const ww = world({ dns: { 'boutique-essai.invalid': e }, route: call => page(call) }); const rr = await S.fetchPage(URL1, { deps: ww.deps });
    assert.equal(rr.ok, false); assert.equal(rr.failure.code, code); assert.equal(ww.calls.request.length, 0);
  }
  const many = world({ dns: { 'boutique-essai.invalid': Array.from({ length: 40 }, (_, i) => '93.184.216.' + (i + 1)) }, route: call => page(call) });
  assert.equal((await S.fetchPage(URL1, { deps: many.deps })).failure.code, 'dns_too_many_addresses');
  const dup = world({ dns: { 'boutique-essai.invalid': ['93.184.216.34', '93.184.216.34', '2606:4700:4700::1111', '2606:4700:4700:0:0:0:0:1111'] }, route: call => page(call, { statusCode: 500 }) });
  await S.fetchPage(URL1, { deps: dup.deps }); assert.equal(dup.calls.request.length, 1, 'adresses en double (formes IPv6 équivalentes) dédoublonnées : une seule tentative réussie ou échouée par adresse distincte');
});

test('SF-7 DNS rebinding : une seule résolution par étape, connexion épinglée sur l\'adresse validée, adresse connectée contrôlée', async () => {
  // le résolveur « change d'avis » à la deuxième question : la deuxième réponse (privée) ne doit jamais être demandée
  const w = world({ dns: { 'boutique-essai.invalid': n => (n === 1 ? ['93.184.216.34'] : ['127.0.0.1']) }, route: call => page(call) });
  const r = await S.fetchPage(URL1, { deps: w.deps });
  assert.equal(r.ok, true); assert.equal(w.calls.resolve.length, 1, 'une seule résolution'); assert.equal(w.calls.request.length, 1);
  assert.equal(w.calls.request[0].address, '93.184.216.34', 'la connexion vise l\'adresse validée, pas le nom'); assert.notEqual(w.calls.request[0].address, '127.0.0.1');
  assert.equal(w.calls.request[0].hostname, 'boutique-essai.invalid', 'le nom reste transmis pour SNI et vérification du certificat');
  // même scénario sur une redirection : chaque étape est résolue et validée, une fois
  const w2 = world({ dns: { 'a.invalid': n => (n === 1 ? ['93.184.216.34'] : ['10.0.0.1']), 'b.invalid': ['93.184.216.35'] }, route: call => (call.hostname === 'a.invalid' ? redirect(call, 'https://b.invalid/x') : page(call)) });
  const r2 = await S.fetchPage('https://a.invalid/start', { deps: w2.deps });
  assert.equal(r2.ok, true); assert.deepEqual(w2.calls.resolve, ['a.invalid', 'b.invalid']); assert.deepEqual(w2.calls.request.map(c => c.address), ['93.184.216.34', '93.184.216.35']);
  // l'adresse réellement connectée est comparée à l'adresse validée
  const bad = world({ dns: { 'boutique-essai.invalid': ['93.184.216.34'] }, route: call => page(call, { remoteAddress: '10.0.0.7' }) });
  const rb = await S.fetchPage(URL1, { deps: bad.deps });
  assert.equal(rb.ok, false); assert.equal(rb.failure.code, 'connection_address_mismatch'); assert.deepEqual(rb.failure.detail, { validated: '93.184.216.34', connected: '10.0.0.7' }); assert.equal(rb.body, null);
  assert.equal(rb.status, null, 'aucun statut ni URL finale pour une réponse venue d\'une adresse non validée'); assert.equal(rb.finalUrl, null);
  // échec fermé : un transport qui ne rapporte pas l'adresse n'est pas accepté
  for (const remote of [undefined, null, '', 42]) {
    const u = world({ dns: { 'boutique-essai.invalid': ['93.184.216.34'] }, route: call => page(call, { remoteAddress: remote }) }); const ru = await S.fetchPage(URL1, { deps: u.deps });
    assert.equal(ru.ok, false); assert.equal(ru.failure.code, 'connection_address_unverified', String(remote));
  }
  // formes équivalentes d'une même adresse IPv6 : acceptées
  const v6 = world({ dns: { 'boutique-essai.invalid': ['2606:4700:4700::1111'] }, route: call => page(call, { remoteAddress: '2606:4700:4700:0:0:0:0:1111' }) });
  assert.equal((await S.fetchPage(URL1, { deps: v6.deps })).ok, true);
  // la réponse arrivant d'une AUTRE adresse publique n'est pas acceptée non plus
  const other = world({ dns: { 'boutique-essai.invalid': ['93.184.216.34'] }, route: call => page(call, { remoteAddress: '93.184.216.99' }) });
  assert.equal((await S.fetchPage(URL1, { deps: other.deps })).failure.code, 'connection_address_mismatch');
});

test('SF-8 redirections : suivies une à une et validées ; URL initiale et finale conservées ; aucune redirection automatique', async () => {
  const w = world({ dns: { 'a.invalid': ['93.184.216.34'], 'b.invalid': ['93.184.216.35'], 'c.invalid': ['2606:4700:4700::1111'] }, route: call => {
    if (call.hostname === 'a.invalid' && call.path === '/start') return redirect(call, '/mid', 301);
    if (call.hostname === 'a.invalid' && call.path === '/mid') return redirect(call, 'https://b.invalid/other?q=1#f', 308);
    if (call.hostname === 'b.invalid' && call.path.startsWith('/other')) return redirect(call, 'https://c.invalid/final', 307);
    return page(call);
  } });
  const r = await S.fetchPage('https://a.invalid/start', { deps: w.deps });
  assert.equal(r.ok, true); assert.equal(r.requestedUrl, 'https://a.invalid/start'); assert.equal(r.finalUrl, 'https://c.invalid/final');
  assert.deepEqual(r.redirects, [{ from: 'https://a.invalid/start', to: 'https://a.invalid/mid', status: 301 }, { from: 'https://a.invalid/mid', to: 'https://b.invalid/other?q=1', status: 308 }, { from: 'https://b.invalid/other?q=1', to: 'https://c.invalid/final', status: 307 }]);
  assert.deepEqual(r.trace.map(t => [t.hostname, t.address, t.status]), [['a.invalid', '93.184.216.34', 301], ['a.invalid', '93.184.216.34', 308], ['b.invalid', '93.184.216.35', 307], ['c.invalid', '2606:4700:4700::1111', 200]]);
  assert.equal(w.calls.request.length, 4, 'une requête par étape : le transport ne suit rien tout seul');
  for (const status of [301, 302, 303, 307, 308]) { const x = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: (call, n) => (n === 1 ? redirect(call, '/ok', status) : page(call)) }); const rx = await S.fetchPage('https://a.invalid/', { deps: x.deps }); assert.equal(rx.ok, true, String(status)); assert.equal(rx.redirects[0].status, status); }
  // les redirections 300, 304, 305 ne sont pas des redirections
  for (const status of [300, 304, 305, 306]) { const x = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { statusCode: status, headers: { location: '/ok' } }) }); const rx = await S.fetchPage('https://a.invalid/', { deps: x.deps }); assert.equal(rx.failure.code, 'http_unexpected_status', String(status)); assert.equal(x.calls.request.length, 1); }
  // aucune redirection ne conserve d'en-tête d'identification d'une étape à l'autre
  assert.ok(w.calls.request.every(c => Object.keys(c.headers).sort().join() === 'Accept,Accept-Encoding,User-Agent'));
});

test('SF-9 redirections interdites : jamais suivies, aucune connexion vers la destination refusée', async () => {
  const forbid = {
    'IP en clair loopback': ['https://127.0.0.1/admin', 'ip_literal_not_allowed'], 'IP métadonnées cloud': ['https://169.254.169.254/latest/meta-data/', 'ip_literal_not_allowed'], 'IP notation décimale': ['https://2130706433/', 'ip_literal_not_allowed'],
    'IPv6 loopback': ['https://[::1]/', 'ip_literal_not_allowed'], 'rétrogradation http': ['http://b.invalid/', 'protocol_not_allowed'], 'autre protocole': ['ftp://b.invalid/', 'protocol_not_allowed'], 'javascript': ['javascript:alert(1)', 'protocol_not_allowed'],
    'autre port': ['https://b.invalid:8443/', 'port_not_allowed'], 'port 80': ['https://b.invalid:80/', 'port_not_allowed'], 'identifiants': ['https://u:p@b.invalid/', 'credentials_not_allowed'], 'nom local': ['https://localhost/', 'hostname_not_public'],
    'nom interne': ['https://metadata.google.internal/', 'hostname_not_public'], 'nom résolvant en privé': ['https://prive.invalid/', 'dns_forbidden_address'], 'nom résolvant en mixte': ['https://mixte.invalid/', 'dns_mixed_addresses'], 'nom inconnu': ['https://absent.invalid/', 'dns_not_found']
  };
  for (const [name, [target, code]] of Object.entries(forbid)) {
    const w = world({ dns: { 'a.invalid': ['93.184.216.34'], 'b.invalid': ['93.184.216.35'], 'prive.invalid': ['10.1.1.1'], 'mixte.invalid': ['93.184.216.36', '192.168.0.9'] }, route: call => (call.hostname === 'a.invalid' ? redirect(call, target) : page(call)) });
    const r = await S.fetchPage('https://a.invalid/', { deps: w.deps });
    assert.equal(r.ok, false, name); assert.equal(r.failure.code, code, name + ' → ' + r.failure.code); assert.equal(r.failure.hop >= 0, true); assert.equal(r.failure.phase, r.failure.hop > 0 ? 'redirect' : 'initial'); assert.equal(r.body, null);
    assert.equal(w.calls.request.length, 1, name + ' : une seule connexion (l\'étape initiale), jamais vers la destination refusée'); assert.equal(r.requestedUrl, 'https://a.invalid/'); assert.equal(r.finalUrl, null, name + ' : pas de page finale');
    assert.equal(r.redirects.length, 1, name); assert.equal(r.redirects[0].from, 'https://a.invalid/');
  }
  // Location relatif, protocole relatif, vide, absent, illisible
  for (const [loc, code] of [[undefined, 'redirect_without_location'], ['', 'redirect_without_location'], ['   ', 'redirect_without_location'], ['//127.0.0.1/x', 'ip_literal_not_allowed'], ['//localhost/x', 'hostname_not_public'], ['https://', 'redirect_invalid_location'], ['http://[::1', 'redirect_invalid_location']]) {
    const w = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { statusCode: 302, headers: loc === undefined ? {} : { location: loc }, body: Readable.from([]) }) });
    const r = await S.fetchPage('https://a.invalid/', { deps: w.deps }); assert.equal(r.ok, false, String(loc)); assert.equal(r.failure.code, code, String(loc) + ' → ' + r.failure.code); assert.equal(w.calls.request.length, 1);
  }
});

test('SF-10 boucles et nombre de redirections', async () => {
  const loop = world({ dns: { 'a.invalid': ['93.184.216.34'], 'b.invalid': ['93.184.216.35'] }, route: call => redirect(call, call.hostname === 'a.invalid' ? 'https://b.invalid/' : 'https://a.invalid/') });
  const r = await S.fetchPage('https://a.invalid/', { deps: loop.deps });
  assert.equal(r.ok, false); assert.equal(r.failure.code, 'redirect_loop'); assert.equal(loop.calls.request.length, 2, 'la boucle est coupée avant une troisième connexion');
  const self = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => redirect(call, '/') }); assert.equal((await S.fetchPage('https://a.invalid/', { deps: self.deps })).failure.code, 'redirect_loop'); assert.equal(self.calls.request.length, 1);
  const frag = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => redirect(call, '/#autre') }); assert.equal((await S.fetchPage('https://a.invalid/', { deps: frag.deps })).failure.code, 'redirect_loop', 'le fragment ne distingue pas deux pages');
  const chain = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: (call, n) => redirect(call, '/p' + n) });
  const rc = await S.fetchPage('https://a.invalid/', { deps: chain.deps });
  assert.equal(rc.ok, false); assert.equal(rc.failure.code, 'too_many_redirects'); assert.equal(chain.calls.request.length, S.LIMITS.maxRedirects + 1); assert.equal(rc.redirects.length, S.LIMITS.maxRedirects);
  const exact = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: (call, n) => (n <= 3 ? redirect(call, '/p' + n) : page(call)) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: exact.deps, limits: { maxRedirects: 3 } })).ok, true, 'exactement le maximum autorisé');
  const over = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: (call, n) => (n <= 4 ? redirect(call, '/p' + n) : page(call)) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: over.deps, limits: { maxRedirects: 3 } })).failure.code, 'too_many_redirects');
});

test('SF-11 limites de taille : annoncée, diffusée sans fin, bombe de décompression ; la lecture s\'arrête', async () => {
  const limits = { maxRawBytes: 50000, maxBodyBytes: 50000 };
  const declared = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { headers: { 'content-type': 'text/html', 'content-length': '999999999' } }) });
  const rd = await S.fetchPage('https://a.invalid/', { deps: declared.deps, limits }); assert.equal(rd.failure.code, 'body_too_large'); assert.deepEqual(rd.failure.detail, { limit: 'declared' }); assert.equal(rd.body, null);
  // flux sans fin et sans Content-Length : la lecture est interrompue peu après la limite
  let pushed = 0; let endless;
  const mk = () => { pushed = 0; endless = new Readable({ read() { pushed += 16384; this.push(Buffer.alloc(16384, 97)); } }); return endless; };
  const w = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { body: mk() }) });
  const r = await S.fetchPage('https://a.invalid/', { deps: w.deps, limits }); await new Promise(res => setTimeout(res, 30));
  assert.equal(r.ok, false); assert.equal(r.failure.code, 'body_too_large'); assert.equal(r.body, null); assert.ok(pushed <= 50000 + 8 * 16384, 'lecture bornée : ' + pushed + ' octets produits'); assert.equal(endless.destroyed, true, 'flux détruit');
  // exactement à la limite : accepté ; un octet de plus : refusé
  const mkBody = n => world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { body: Readable.from([Buffer.alloc(n, 97)]) }) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: mkBody(50000).deps, limits })).ok, true); assert.equal((await S.fetchPage('https://a.invalid/', { deps: mkBody(50001).deps, limits })).failure.code, 'body_too_large');
  // bombe de décompression : petit à l'arrivée, énorme décompressé
  const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0)); assert.ok(bomb.length < 100000);
  const wb = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: Readable.from([bomb]) }) });
  const rb = await S.fetchPage('https://a.invalid/', { deps: wb.deps, limits: { maxRawBytes: 200000, maxBodyBytes: 1024 * 1024 } });
  assert.equal(rb.ok, false); assert.equal(rb.failure.code, 'body_too_large'); assert.deepEqual(rb.failure.detail, { limit: 'decoded' });
  const wr = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { body: Readable.from([Buffer.alloc(30000), Buffer.alloc(30000)]) }) });
  assert.deepEqual((await S.fetchPage('https://a.invalid/', { deps: wr.deps, limits: { maxRawBytes: 50000, maxBodyBytes: 1000000 } })).failure.detail, { limit: 'raw' });
});

test('SF-12 contenu : types autorisés, encodages gérés (gzip, deflate, br), jeux de caractères', async () => {
  const run = (headers, chunks) => { const w = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { headers, body: Readable.from(chunks) }) }); return S.fetchPage('https://a.invalid/', { deps: w.deps }); };
  for (const ct of ['text/html', 'text/html; charset=utf-8', 'TEXT/HTML;charset=UTF-8', 'application/xhtml+xml', 'application/json', 'application/ld+json; charset=utf-8']) assert.equal((await run({ 'content-type': ct }, [Buffer.from('{}')])).ok, true, ct);
  for (const ct of ['image/png', 'application/pdf', 'application/octet-stream', 'text/plain', 'text/css', 'application/javascript', 'video/mp4', 'multipart/form-data', 'application/xml']) { const r = await run({ 'content-type': ct }, [Buffer.from('x')]); assert.equal(r.ok, false, ct); assert.equal(r.failure.code, 'content_type_not_allowed', ct); assert.equal(r.body, null); }
  for (const h of [{}, { 'content-type': '' }, { 'content-type': '   ' }]) assert.equal((await run(h, [Buffer.from('x')])).failure.code, 'content_type_missing');
  const text = '<html><body>café « prix » 12 700 FCFA</body></html>';
  const gz = await run({ 'content-type': 'text/html', 'content-encoding': 'gzip' }, [zlib.gzipSync(Buffer.from(text))]); assert.equal(gz.body, text); assert.ok(gz.rawBytes < gz.bytes + 40);
  assert.equal((await run({ 'content-type': 'text/html', 'content-encoding': 'deflate' }, [zlib.deflateSync(Buffer.from(text))])).body, text);
  assert.equal((await run({ 'content-type': 'text/html', 'content-encoding': 'br' }, [zlib.brotliCompressSync(Buffer.from(text))])).body, text);
  assert.equal((await run({ 'content-type': 'text/html', 'content-encoding': 'identity' }, [Buffer.from(text)])).body, text);
  const gzAll = zlib.gzipSync(Buffer.from(text)); assert.equal((await run({ 'content-type': 'text/html', 'content-encoding': 'gzip' }, [gzAll.subarray(0, 7), gzAll.subarray(7)])).body, text, 'morceaux multiples');
  for (const enc of ['compress', 'zstd', 'gzip, br', 'exotique']) { const r = await run({ 'content-type': 'text/html', 'content-encoding': enc }, [Buffer.from('x')]); assert.equal(r.failure.code, 'content_encoding_not_supported', enc); }
  const bad = await run({ 'content-type': 'text/html', 'content-encoding': 'gzip' }, [Buffer.from('ceci n\'est pas du gzip')]); assert.equal(bad.failure.code, 'body_decode_error');
  // jeux de caractères
  const latin = await run({ 'content-type': 'text/html; charset=iso-8859-1' }, [Buffer.from([0x63, 0x61, 0x66, 0xe9])]); assert.equal(latin.body, 'café'); assert.equal(latin.charset, 'iso-8859-1');
  const bom = await run({ 'content-type': 'text/html' }, [Buffer.from([0xef, 0xbb, 0xbf, 0x61])]); assert.equal(bom.body, 'a', 'BOM retiré');
  const unknown = await run({ 'content-type': 'text/html; charset=inconnu-9' }, [Buffer.from('café')]); assert.equal(unknown.ok, true); assert.equal(unknown.charset, 'utf-8'); assert.deepEqual(unknown.warnings, ['charset_unknown']);
  const invalid = await run({ 'content-type': 'text/html' }, [Buffer.from([0x61, 0xff, 0x62])]); assert.equal(invalid.ok, true); assert.ok(invalid.body.includes('�'), 'octets invalides remplacés, jamais d\'exception');
});

test('SF-13 réponses HTTP : seule 200 est un succès ; erreurs, statuts inattendus, réponses invalides', async () => {
  const run = (o) => { const w = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, o) }); return S.fetchPage('https://a.invalid/x', { deps: w.deps }); };
  for (const s of [400, 401, 403, 404, 410, 429, 451, 500, 502, 503, 504]) { const r = await run({ statusCode: s }); assert.equal(r.ok, false, String(s)); assert.equal(r.failure.code, 'http_error_status'); assert.equal(r.status, s); assert.equal(r.finalUrl, 'https://a.invalid/x'); assert.equal(r.body, null); assert.deepEqual(r.failure.detail, { status: s }); }
  for (const s of [201, 202, 203, 204, 205, 206, 100, 101, 102, 226]) { const r = await run({ statusCode: s }); assert.equal(r.ok, false, String(s)); assert.equal(r.failure.code, 'http_unexpected_status', String(s)); assert.equal(r.body, null); }
  for (const s of [0, 99, 600, 1000, -1, 200.5, '200', null, undefined, NaN]) { const r = await run({ statusCode: s }); assert.equal(r.ok, false, String(s)); assert.equal(r.failure.code, 'http_invalid_response', String(s)); }
  for (const bad of [{ headers: null }, { headers: 'x' }, { body: null }, { body: undefined }]) { const r = await run(bad); assert.equal(r.ok, false); assert.equal(r.failure.code, 'http_invalid_response'); }
  assert.equal((await run({ statusCode: 200 })).ok, true);
  // jamais de fausse réussite après erreur : chaque échec a ok false, un motif connu et aucun corps
  for (const s of [404, 500, 204]) { const r = await run({ statusCode: s, body: Readable.from([Buffer.from('<html>contenu</html>')]) }); assert.equal(r.ok, false); assert.equal(r.body, null); assert.ok(S.FAILURES[r.failure.code]); }
});

test('SF-14 délai : réponse jamais reçue, corps trop lent, réponse tardive fermée ; erreurs de connexion et TLS', async () => {
  const w = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: () => new Promise(() => { /* ne répond jamais */ }) });
  let t = Date.now(); const r = await S.fetchPage('https://a.invalid/', { deps: w.deps, limits: { timeoutMs: 40 } });
  assert.equal(r.ok, false); assert.equal(r.failure.code, 'timeout'); assert.ok(Date.now() - t < 1500, 'le délai est effectif'); assert.equal(r.body, null);
  // corps qui ne se termine jamais
  let stuck; const slow = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => { stuck = new Readable({ read() {} }); stuck.push(Buffer.from('<html>')); return page(call, { body: stuck }); } });
  t = Date.now(); const rs = await S.fetchPage('https://a.invalid/', { deps: slow.deps, limits: { timeoutMs: 40 } });
  assert.equal(rs.failure.code, 'timeout'); assert.ok(Date.now() - t < 1500); assert.equal(rs.body, null); await new Promise(res => setTimeout(res, 20)); assert.equal(stuck.destroyed, true, 'flux interrompu');
  // DNS qui ne répond jamais
  const dnsHang = { deps: { resolve: () => new Promise(() => {}), request: async () => { throw new Error('ne doit pas être appelé'); } } };
  assert.equal((await S.fetchPage('https://a.invalid/', Object.assign({ limits: { timeoutMs: 30 } }, dnsHang))).failure.code, 'timeout');
  // réponse arrivant après le délai : fermée, jamais lue
  let late; const lateW = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => new Promise(res => setTimeout(() => { late = page(call); res(late); }, 80)) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: lateW.deps, limits: { timeoutMs: 30 } })).failure.code, 'timeout'); await new Promise(res => setTimeout(res, 150)); assert.equal(late.aborted, 1, 'réponse tardive fermée');
  // le délai est total : il couvre les redirections
  const chain = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: (call, n) => new Promise(res => setTimeout(() => res(redirect(call, '/p' + n)), 25)) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: chain.deps, limits: { timeoutMs: 70, maxRedirects: 20 } })).failure.code, 'timeout');
  // connexion
  for (const [code, expect] of [['ECONNREFUSED', 'connection_error'], ['ECONNRESET', 'connection_error'], ['EHOSTUNREACH', 'connection_error'], ['ETIMEDOUT', 'connection_error'], ['ENETUNREACH', 'connection_error']]) {
    const c = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: () => Object.assign(new Error(code), { code }) }); const rc = await S.fetchPage('https://a.invalid/', { deps: c.deps });
    assert.equal(rc.ok, false); assert.equal(rc.failure.code, expect, code); assert.equal(rc.failure.detail, code); assert.equal(rc.status, null);
  }
  for (const code of ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_SSL_WRONG_VERSION_NUMBER']) {
    const c = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: () => Object.assign(new Error('tls'), { code }) }); assert.equal((await S.fetchPage('https://a.invalid/', { deps: c.deps })).failure.code, 'tls_error', code);
    assert.equal(c.calls.request.length, 1, 'une erreur de certificat n\'essaie pas d\'autre adresse');
  }
  // plusieurs adresses validées : repli seulement sur échec de connexion, jamais sur une réponse HTTP
  const multi = world({ dns: { 'a.invalid': ['93.184.216.34', '93.184.216.35', '2606:4700:4700::1111'] }, route: (call, n) => (n < 2 ? Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) : page(call)) });
  const rm = await S.fetchPage('https://a.invalid/', { deps: multi.deps }); assert.equal(rm.ok, true); assert.deepEqual(multi.calls.request.map(c => c.address), ['93.184.216.34', '93.184.216.35']); assert.equal(rm.trace[0].address, '93.184.216.35');
  const http500 = world({ dns: { 'a.invalid': ['93.184.216.34', '93.184.216.35'] }, route: call => page(call, { statusCode: 500 }) }); await S.fetchPage('https://a.invalid/', { deps: http500.deps }); assert.equal(http500.calls.request.length, 1, 'pas de repli sur une erreur HTTP');
  const allFail = world({ dns: { 'a.invalid': ['93.184.216.34', '93.184.216.35', '93.184.216.36', '93.184.216.37'] }, route: () => Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: allFail.deps })).failure.code, 'connection_error'); assert.equal(allFail.calls.request.length, S.LIMITS.maxAddressAttempts);
  // flux interrompu en cours de route
  const cut = new Readable({ read() {} }); cut.push(Buffer.from('<html>')); setTimeout(() => cut.destroy(), 10);
  const wc = world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { body: cut }) }); const rcut = await S.fetchPage('https://a.invalid/', { deps: wc.deps });
  assert.equal(rcut.ok, false); assert.ok(['body_incomplete', 'body_stream_error'].includes(rcut.failure.code), rcut.failure.code); assert.equal(rcut.body, null);
  const err = new Readable({ read() {} }); err.push(Buffer.from('<h')); setTimeout(() => err.destroy(new Error('reset')), 10);
  assert.equal((await S.fetchPage('https://a.invalid/', { deps: world({ dns: { 'a.invalid': ['93.184.216.34'] }, route: call => page(call, { body: err }) }).deps })).failure.code, 'body_stream_error');
});

test('SF-15 entrées et dépendances hostiles : jamais d\'exception, jamais de succès', async () => {
  for (const bad of [undefined, null, 0, 1.5, {}, [], () => 1, Symbol('x'), true]) { let r; await assert.doesNotReject(async () => { r = await S.fetchPage(bad, { deps: okWorld().deps }); }); assert.equal(r.ok, false); assert.equal(r.failure.code, 'invalid_input'); }
  // options absentes : le résolveur par défaut est utilisé ; il est remplacé ici par un bouchon local (jamais de vrai DNS) et sa seule utilisation est comptée
  const realLookup = dns.promises.lookup; let stubbed = 0; dns.promises.lookup = async () => { stubbed++; throw Object.assign(new Error('bouchon'), { code: 'ENOTFOUND' }); };
  try {
  for (const o of [undefined, null, 5, 'x', [], { deps: null }, { limits: null }, { deps: { resolve: 'x' } }]) { let r; await assert.doesNotReject(async () => { r = await S.fetchPage('https://a.invalid/', o); }); assert.equal(typeof r.ok, 'boolean'); if (!r.ok) assert.ok(S.FAILURES[r.failure.code]); }
  } finally { dns.promises.lookup = realLookup; }
  assert.ok(stubbed >= 5, 'le chemin par défaut a bien été emprunté, et intercepté par le bouchon : ' + stubbed);
  for (const deps of [{ resolve: () => { throw new Error('boum'); } }, { resolve: async () => null }, { resolve: async () => 'x' }, { resolve: async () => [null, 5, {}] }, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: () => { throw new TypeError('boum'); } },
    { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => 'pas une réponse' }, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: 5, remoteAddress: '93.184.216.34' }) }]) {
    let r; await assert.doesNotReject(async () => { r = await S.fetchPage('https://a.invalid/', { deps }); }); assert.equal(r.ok, false); assert.equal(r.body, null); assert.ok(S.FAILURES[r.failure.code], r.failure.code);
  }
  // l'échec d'une étape ne laisse aucune minuterie active (le test s'arrête sans attendre le délai total)
  const t = Date.now(); await S.fetchPage('https://a.invalid/', { deps: { resolve: async () => { throw new Error('x'); } } }); assert.ok(Date.now() - t < 500);
});

test('SF-16 le transport par défaut : connexion directe vers l\'adresse validée (SNI sur le nom), Host explicite, agent jetable, TLS 1.2 minimum ; aucune résolution de nom', async () => {
  const seen = [];
  https.request = (options, cb) => {
    seen.push(options);
    const { EventEmitter } = require('node:events'); const req = new EventEmitter(); req.setTimeout = (ms, fn) => { req.timeoutMs = ms; req.onTimeout = fn; }; req.destroy = () => { req.destroyed = true; };
    req.end = () => { const res = Readable.from([Buffer.from('<html>ok</html>')]); res.statusCode = 200; res.headers = { 'content-type': 'text/html' }; res.socket = { remoteAddress: options.host }; setImmediate(() => cb(res)); };
    return req;
  };
  try {
    const w = world({ dns: { 'boutique-essai.invalid': ['2606:4700:4700::1111', '93.184.216.34'] }, route: null });
    const r = await S.fetchPage('https://boutique-essai.invalid/p?q=1', { deps: { resolve: w.deps.resolve, now: w.deps.now } });     // transport par défaut, https.request espionné
    assert.equal(r.ok, true); assert.equal(r.body, '<html>ok</html>'); assert.equal(seen.length, 1);
    const o = seen[0];
    assert.equal(o.host, '2606:4700:4700::1111', 'la connexion vise l\'adresse validée'); assert.equal(o.family, 6); assert.equal(o.port, 443); assert.equal(o.method, 'GET'); assert.equal(o.path, '/p?q=1');
    assert.equal(o.servername, 'boutique-essai.invalid', 'SNI et vérification du certificat sur le nom'); assert.equal(o.headers.Host, 'boutique-essai.invalid'); assert.equal(o.setHost, false);
    assert.equal(o.agent, false, 'aucune connexion réutilisée'); assert.equal(o.minVersion, 'TLSv1.2'); assert.ok(!('lookup' in o), 'aucune résolution de nom à la connexion'); assert.ok(!('rejectUnauthorized' in o), 'validation du certificat laissée active');
    assert.equal(o.timeout, undefined); assert.equal(w.calls.resolve.length, 1);
    // le socket réel rapporte une autre adresse : refusé
    https.request = (options, cb) => { const { EventEmitter } = require('node:events'); const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {}; req.end = () => { const res = Readable.from([Buffer.from('x')]); res.statusCode = 200; res.headers = { 'content-type': 'text/html' }; res.socket = { remoteAddress: '10.0.0.9' }; setImmediate(() => cb(res)); }; return req; };
    const bad = await S.fetchPage('https://boutique-essai.invalid/', { deps: { resolve: w.deps.resolve, now: w.deps.now } }); assert.equal(bad.failure.code, 'connection_address_mismatch');
    // erreur de socket
    https.request = () => { const { EventEmitter } = require('node:events'); const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {}; req.end = () => setImmediate(() => req.emit('error', Object.assign(new Error('refus'), { code: 'ECONNREFUSED' }))); return req; };
    assert.equal((await S.fetchPage('https://boutique-essai.invalid/', { deps: { resolve: w.deps.resolve, now: w.deps.now } })).failure.code, 'connection_error');
    // options de requête : port non standard, Host avec port (cas non atteignable via fetchPage, la politique n'autorise que 443)
    assert.equal(S.buildRequestOptions({ address: '93.184.216.34', family: 4, port: 8443, path: '/', hostname: 'a.invalid', headers: {} }).headers.Host, 'a.invalid:8443');
  } finally { https.request = trap('https.request'); }
});

test('SF-17 aucun suivi automatique, aucun fetch, aucun proxy ni dépendance : le code source le confirme', () => {
  const code = strip(src);
  assert.doesNotMatch(code, /\bfetch\s*\(|undici|XMLHttpRequest|axios|node-fetch|got\(|require\((?!['"]node:)/);
  assert.doesNotMatch(code, /\bfollowRedirects\b|redirect\s*:\s*['"]follow/);
  assert.doesNotMatch(code, /process\.env|HTTPS?_PROXY|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/);
  assert.doesNotMatch(code, /dns\.(lookup|resolve)\w*\(|dns\.promises\.(?!lookup\(hostname)/);
  assert.equal((code.match(/dns\.promises\.lookup\(/g) || []).length, 1, 'une seule résolution possible, dans le résolveur par défaut');
  assert.equal((code.match(/https\.request\(/g) || []).length, 1, 'une seule ouverture de connexion, dans le transport par défaut');
  assert.doesNotMatch(code, /require\(['"]node:(http|net|tls)['"]\)\.(request|connect)/);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'js')).concat(walk(path.join(ROOT, 'server')), walk(path.join(ROOT, 'api')))) if (/\.js$/.test(f)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tools\/market|safe-fetch|extractors/, path.relative(ROOT, f));
  const other = fs.readdirSync(path.join(ROOT, 'tools/market')).filter(f => /\.js$/.test(f) && f !== 'safe-fetch.js');
  for (const f of other) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'tools/market', f), 'utf8'), /require\(['"]\.\/safe-fetch(\.js)?['"]\)/, f + ' ne charge pas safe-fetch');
});

test('SF-18 résultat : forme stable, URL initiale et finale, traçabilité ; échecs sans corps ni fausse réussite', async () => {
  const keys = ['schema', 'ok', 'requestedUrl', 'finalUrl', 'status', 'contentType', 'charset', 'rawBytes', 'bytes', 'body', 'redirects', 'trace', 'failure', 'warnings', 'elapsedMs'];
  const scenarios = [okWorld(), world({ dns: {}, route: null }), world({ dns: { 'boutique-essai.invalid': ['10.0.0.1'] }, route: null }), world({ dns: { 'boutique-essai.invalid': [ADDR] }, route: call => page(call, { statusCode: 404 }) })];
  for (const w of scenarios) {
    const r = await S.fetchPage(URL1, { deps: w.deps }); assert.deepEqual(Object.keys(r).sort(), keys.slice().sort());
    if (r.ok) { assert.equal(r.failure, null); assert.equal(typeof r.body, 'string'); } else { assert.equal(r.body, null); assert.deepEqual(Object.keys(r.failure).sort(), ['code', 'detail', 'hop', 'message', 'phase', 'url']); assert.equal(r.failure.message, S.FAILURES[r.failure.code]); }
    assert.equal(r.requestedUrl, URL1);
  }
  const ok = await S.fetchPage(URL1, { deps: okWorld().deps }), ok2 = await S.fetchPage(URL1, { deps: okWorld().deps }); assert.deepEqual(ok, ok2, 'déterministe avec horloge et réseau simulés');
});

test('SF-19 invariants sur un grand nombre de scénarios aléatoires (graine fixe) : jamais ok avec un corps nul ni sans statut 200 ; jamais de connexion vers une adresse non publique', async () => {
  let seed = 20261012; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const addrs = ['93.184.216.34', '2606:4700:4700::1111', '10.0.0.1', '127.0.0.1', '169.254.169.254', 'fd00::1', '::ffff:10.0.0.1', '8.8.8.8', '192.168.1.1', '100.64.0.9'];
  const locs = ['/a', 'https://b.invalid/x', 'https://127.0.0.1/', 'http://b.invalid/', 'https://c.invalid:8443/', 'https://priv.invalid/', '', '//b.invalid/y', 'https://b.invalid/'];
  let ok = 0, ko = 0;
  for (let n = 0; n < 1500; n++) {
    const dnsMap = { 'a.invalid': Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(addrs)), 'b.invalid': [pick(addrs)], 'priv.invalid': ['10.9.9.9'], 'c.invalid': [pick(addrs)] };
    const w = world({ dns: dnsMap, route: (call, k) => { const roll = rnd(); if (roll < 0.15) return Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); if (roll < 0.5 && k < 6) return redirect(call, pick(locs), pick([301, 302, 307])); return page(call, { statusCode: pick([200, 200, 200, 404, 500]), remoteAddress: rnd() < 0.05 ? '10.0.0.2' : call.address }); } });
    const r = await S.fetchPage('https://a.invalid/', { deps: w.deps });
    for (const c of w.calls.request) assert.equal(S.classifyIp(c.address).public, true, 'connexion vers une adresse non publique : ' + c.address);
    if (r.ok) { ok++; assert.equal(typeof r.body, 'string'); assert.equal(r.status, 200); assert.equal(r.failure, null); assert.ok(r.trace.every(t => S.classifyIp(t.address).public)); assert.ok(r.redirects.length <= S.LIMITS.maxRedirects); }
    else { ko++; assert.equal(r.body, null); assert.ok(S.FAILURES[r.failure.code]); }
    assert.ok(w.calls.request.length <= (S.LIMITS.maxRedirects + 1) * S.LIMITS.maxAddressAttempts);
  }
  assert.ok(ok > 30 && ko > 100, 'les deux issues sont exercées (' + ok + ' succès, ' + ko + ' échecs)');
});

test('SF-20 absence d\'accès réseau réel : la garde du processus n\'a enregistré aucune tentative', () => {
  assert.deepEqual(breaches, [], 'tentatives réseau réelles : ' + breaches.join(','));
  assert.notEqual(https.request, realHttpsRequest, 'https.request est resté piégé pendant les tests');
});
