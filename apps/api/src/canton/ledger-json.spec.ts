/**
 * Unit test pembaca JSON ledger — menjaga hasil narrowing TETAP sama dengan
 * pembacaan langsung sebelumnya (termasuk fallback), karena modul ini dipakai
 * untuk menggantikan akses `any` di jalur ACS/contract ledger.
 */
import {
  asRecord,
  readStr,
  readStrOr,
  readStrArray,
  pick,
  readAcsCreatedEvent,
  readAcsCreatedEvents,
} from './ledger-json';

const ACS_ENTRY = {
  contractEntry: {
    JsActiveContract: {
      createdEvent: {
        templateId: 'pkg:Utility.Registry.Holding.V0.Holding:Holding',
        contractId: '00abc',
        createArgument: { owner: 'party::1' },
      },
    },
  },
};

describe('asRecord', () => {
  it('menerima objek, menolak array/null/primitif', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord('x')).toBeNull();
    expect(asRecord(5)).toBeNull();
  });
});

describe('readStr / readStrOr / readStrArray', () => {
  it('readStr hanya meloloskan string', () => {
    expect(readStr('a')).toBe('a');
    expect(readStr('')).toBe('');
    expect(readStr(1)).toBeNull();
    expect(readStr(null)).toBeNull();
  });

  it('readStrOr memakai fallback untuk non-string (termasuk null)', () => {
    expect(readStrOr('a', 'z')).toBe('a');
    expect(readStrOr(null, 'z')).toBe('z');
    expect(readStrOr(0, 'z')).toBe('z');
    expect(readStrOr(undefined)).toBe('');
  });

  it('readStrArray membuang elemen non-string', () => {
    expect(readStrArray(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(readStrArray('not-array')).toEqual([]);
    expect(readStrArray(undefined)).toEqual([]);
  });
});

describe('pick', () => {
  it('menelusuri berantai dan berhenti aman di mata rantai non-objek', () => {
    const root = { a: { b: { c: 7 } } };
    expect(pick(root, 'a', 'b', 'c')).toBe(7);
    expect(pick(root, 'a', 'x', 'c')).toBeNull();
    expect(pick(null, 'a')).toBeNull();
    expect(pick(undefined, 'a', 'b')).toBeNull();
    // Array bukan objek untuk keperluan pick (konsisten dgn asRecord).
    expect(pick([1, 2], '0')).toBeNull();
  });
});

describe('readAcsCreatedEvent', () => {
  it('mengambil createdEvent dari bentuk ACS verbose', () => {
    const ev = readAcsCreatedEvent(ACS_ENTRY);
    expect(ev?.contractId).toBe('00abc');
    expect(readStr(pick(ev, 'createArgument', 'owner'))).toBe('party::1');
  });

  it('null bila bentuk tidak sesuai / kosong', () => {
    expect(readAcsCreatedEvent({})).toBeNull();
    expect(readAcsCreatedEvent(null)).toBeNull();
    expect(
      readAcsCreatedEvent({ contractEntry: { JsActiveContract: {} } }),
    ).toBeNull();
  });
});

describe('readAcsCreatedEvents', () => {
  it('mengambil semua createdEvent, melewati entri tanpa createdEvent', () => {
    const events = readAcsCreatedEvents([ACS_ENTRY, {}, null, ACS_ENTRY]);
    expect(events).toHaveLength(2);
    expect(events[0].templateId).toBe(
      'pkg:Utility.Registry.Holding.V0.Holding:Holding',
    );
  });

  it('respons non-array → daftar kosong (setara Array.isArray(a)?a:[])', () => {
    expect(readAcsCreatedEvents(null)).toEqual([]);
    expect(readAcsCreatedEvents({ error: 'x' })).toEqual([]);
    expect(readAcsCreatedEvents('nope')).toEqual([]);
  });
});
