

import {randomBytes} from 'node:crypto';

const LEGACY_ID = /^\d{13}-(?:[a-z0-9_-]{1,58}-)?[a-f0-9]{8}$/;
const PREFIX = 'knref_';
const ALPHABET = 'abcdefghijklmnop';
const MIN_LENGTH = 22;
const MAX_LENGTH = 81;

export function newReferenceId() {
  return 'kn_' + [...randomBytes(16)]
    .map(byte => ALPHABET[byte >> 4] + ALPHABET[byte & 15]).join('');
}

export function toToolReference(id) {
  if (typeof id !== 'string' || !LEGACY_ID.test(id)) return id;
  return PREFIX + [...Buffer.from(id, 'ascii')]
    .map(byte => ALPHABET[byte >> 4] + ALPHABET[byte & 15]).join('');
}

export function fromToolReference(id) {
  if (typeof id !== 'string' || !id.startsWith(PREFIX)) return id;
  const encoded = id.slice(PREFIX.length);
  if (encoded.length < MIN_LENGTH * 2 || encoded.length > MAX_LENGTH * 2 ||
      encoded.length % 2 || !/^[a-p]+$/.test(encoded)) {
    throw new Error('INVALID_KNOWLEDGE_REFERENCE');
  }
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 2) {
    bytes.push((ALPHABET.indexOf(encoded[i]) << 4) | ALPHABET.indexOf(encoded[i + 1]));
  }
  const decoded = Buffer.from(bytes).toString('ascii');
  if (!LEGACY_ID.test(decoded) || toToolReference(decoded) !== id) {
    throw new Error('INVALID_KNOWLEDGE_REFERENCE');
  }
  return decoded;
}


export function decodeToolReferences(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key,
    key === 'id' ? fromToolReference(value) :
    key === 'query_image' && value && typeof value === 'object' && !Array.isArray(value) ? {...value, ...Object.hasOwn(value,'id') ? {id:fromToolReference(value.id)} : {}} :
    key === 'ids' && Array.isArray(value) ? value.map(fromToolReference) : value]));
}


export function encodeToolReferences(value) {
  if (Array.isArray(value)) return value.map(encodeToolReferences);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'id' || key === 'entryId' ? toToolReference(item) :
    encodeToolReferences(item)]));
}
