const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');

const { AccessoryNameRegistry, sanitizeName } = require('../dist/AccessoryNameRegistry');
const { normalizeLoxoneConfig, validateLoxoneConnectionConfig } = require('../dist/LoxoneConfig');
const sdp = require('../dist/homekit/hksv/sdp');
const rsa = require('../dist/homekit/hksv/rsa');
const ffmpegArgs = require('../dist/homekit/hksv/ffmpegArgs');

// Supporting glue that survives the binding migration: the name registry, the
// config normaliser, and the HKSV camera helpers.

test('AccessoryNameRegistry sanitizes names and keeps duplicates unique', () => {
  const registry = new AccessoryNameRegistry();

  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-1'), 'Living A Lamp 1');
  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-2'), 'Living A Lamp 1 1');
  assert.equal(registry.generate('Living (A)', 'Lamp #1', 'uuid-1'), 'Living A Lamp 1');
});

test('sanitizeName strips HAP-invalid characters so names start/end with a letter or number', () => {
  // The exact names HAP-NodeJS warned about.
  assert.equal(sanitizeName('Zone #4'), 'Zone 4');
  assert.equal(sanitizeName('Autopilot (N)'), 'Autopilot N');
  assert.equal(sanitizeName('Autopilot (D)'), 'Autopilot D');
  assert.equal(sanitizeName('InloopKast 100%'), 'InloopKast 100');
  // Keeps letters, numbers, spaces, apostrophes.
  assert.equal(sanitizeName("Kid's room 2"), "Kid's room 2");
  // All-symbol input degrades to '' (callers fall back).
  assert.equal(sanitizeName('###'), '');
});

test('normalizeLoxoneConfig trims exclusions and normalizes room filters', () => {
  const normalized = normalizeLoxoneConfig({
    Exclusions: ' Switch,Dimmer ,, ',
    roomfilter: { type: 'inclusion', list: ' Kitchen, Living ' },
  });

  assert.deepEqual(normalized.excludedTypes, ['Switch', 'Dimmer']);
  assert.deepEqual(normalized.roomFilter, { type: 'inclusion', rooms: ['kitchen', 'living'] });
});

test('validateLoxoneConnectionConfig reports missing credentials and invalid ports', () => {
  assert.deepEqual(validateLoxoneConnectionConfig({
    host: '192.168.1.10', username: 'homebridge', password: 'secret', port: 80,
  }), []);

  assert.deepEqual(validateLoxoneConnectionConfig({
    host: ' ', username: '', password: undefined, port: 70000,
  }), [
    'host is required',
    'username is required',
    'password is required',
    'port must be a number between 1 and 65535',
  ]);
});

const OFFER_SDP = [
  'v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1', '',
].join('\r\n');

const ANSWER_SDP_SWAPPED = [
  'v=0', 'o=- 2 2 IN IP4 0.0.0.0', 's=-', 't=0 0',
  'a=group:BUNDLE 1 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:0', '',
].join('\r\n');

test('sdp helpers split, describe, and permute media sections', () => {
  assert.equal(sdp.splitSdpSections('no media here'), undefined);

  const parts = sdp.splitSdpSections(OFFER_SDP);
  assert.equal(parts.mediaSections.length, 2);
  assert.equal(sdp.describeSdpMlineOrder(OFFER_SDP), 'audio:0,video:1');
  assert.equal(sdp.describeSdpMlineOrder(ANSWER_SDP_SWAPPED), 'video:1,audio:0');

  assert.equal(sdp.permuteSections(['a']).length, 1);
  assert.equal(sdp.permuteSections(['a', 'b']).length, 2);
  assert.equal(sdp.permuteSections(['a', 'b', 'c']).length, 6);
  assert.equal(sdp.permuteSections(['a', 'b', 'c', 'd', 'e']).length, 0); // capped
});

test('sdp reordering produces an answer whose m-lines match the offer order', () => {
  const candidates = sdp.buildReorderedAnswerCandidates(OFFER_SDP, ANSWER_SDP_SWAPPED);
  assert.ok(candidates.length > 0, 'expected at least one reordered candidate');

  const matching = candidates.find((c) => sdp.describeSdpMlineOrder(c) === 'audio:0,video:1');
  assert.ok(matching, 'expected a candidate reordered to the offer m-line order');
  assert.match(matching, /a=group:BUNDLE 0 1/);

  assert.deepEqual(sdp.buildReorderedAnswerCandidates(OFFER_SDP, 'v=0\r\nm=audio 9 RTP 111\r\na=mid:0\r\n'), []);
});

test('rsa.createRsaPublicKey parses PEM, JWK components, and hex DER', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const der = publicKey.export({ type: 'spki', format: 'der' });

  const roundTrip = (key) => {
    const enc = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from('hello'));
    const dec = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, enc);
    return dec.toString('utf8');
  };

  assert.equal(roundTrip(rsa.createRsaPublicKey(undefined, undefined, pem)), 'hello', 'PEM text');
  assert.equal(roundTrip(rsa.createRsaPublicKey(jwk.n, jwk.e, undefined)), 'hello', 'JWK n/e components');
  assert.equal(roundTrip(rsa.createRsaPublicKey(undefined, undefined, der.toString('hex'))), 'hello', 'hex DER');

  assert.throws(() => rsa.createRsaPublicKey(undefined, undefined, undefined));
});

test('ffmpegArgs tokenizer honours quotes and extractHost parses URLs', () => {
  assert.deepEqual(
    ffmpegArgs.tokenizeFfmpegArgs('-i rtsp://cam/stream -af "volume=2.0" -f s16le'),
    ['-i', 'rtsp://cam/stream', '-af', 'volume=2.0', '-f', 's16le'],
  );
  assert.deepEqual(ffmpegArgs.tokenizeFfmpegArgs("-x 'a b c'"), ['-x', 'a b c']);
  assert.deepEqual(ffmpegArgs.tokenizeFfmpegArgs(''), []);

  assert.equal(ffmpegArgs.extractHost('http://192.168.1.20:8080/mjpg/video.mjpg'), '192.168.1.20:8080');
  assert.equal(ffmpegArgs.extractHost('http://192.168.1.20:80/mjpg/video.mjpg'), '192.168.1.20');
  assert.equal(ffmpegArgs.extractHost('not a url'), null);
});
