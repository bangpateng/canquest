import { findUserByPartyExact, type PartyUserLookup } from './party-user-resolution';

/**
 * Phase 4 L1 — unit test resolver ketat (gap #19): atribusi party→user HANYA
 * via User.cantonPartyId eksak. Semua kasus di bawah adalah bentuk-bentuk
 * kecocokan palsu yang heuristik lama terima.
 */
function makeLookup(
  rows: Array<{ id: string; username: string | null; cantonPartyId: string }>,
): PartyUserLookup {
  return {
    async findMany(args) {
      const q = args.where.cantonPartyId.equals.toLowerCase();
      return rows
        .filter((r) => r.cantonPartyId.toLowerCase() === q)
        .slice(0, args.take);
    },
  };
}

describe('findUserByPartyExact (resolver ketat party→user)', () => {
  it('resolusi eksak: party sama persis dengan cantonPartyId user', async () => {
    const users = makeLookup([
      { id: 'u1', username: 'karel', cantonPartyId: 'karel::1220abc' },
    ]);
    await expect(
      findUserByPartyExact(users, 'karel::1220abc'),
    ).resolves.toEqual({ userId: 'u1', username: 'karel' });
  });

  it('resolusi eksak case-insensitive: casing beda tetap satu user', async () => {
    const users = makeLookup([
      { id: 'u1', username: 'karel', cantonPartyId: 'Karel::1220ABC' },
    ]);
    await expect(
      findUserByPartyExact(users, 'karel::1220abc'),
    ).resolves.toEqual({ userId: 'u1', username: 'karel' });
  });

  it('party tak dikenal → null WALAUPUN ada user dengan username = prefix party (jebakan heuristik lama)', async () => {
    const users = makeLookup([
      // user "budi" TIDAK punya party — event party "budi::…" bukan miliknya.
      { id: 'u1', username: 'budi', cantonPartyId: 'budi2::1220fff' },
    ]);
    await expect(findUserByPartyExact(users, 'budi::1220abc')).resolves.toBeNull();
  });

  it('party milik user lain tidak bisa dicocokkan via prefix username user ketiga', async () => {
    const users = makeLookup([
      { id: 'owner', username: 'karel', cantonPartyId: 'karel::1220abc' },
      // "karel2" adalah username orang lain — heuristik lama bisa salah tangkap.
      { id: 'lain', username: 'karel2', cantonPartyId: 'karel2::1220def' },
    ]);
    // Query party karel2::… harus jatuh ke user "lain" (eksak), bukan "owner".
    await expect(
      findUserByPartyExact(users, 'karel2::1220def'),
    ).resolves.toEqual({ userId: 'lain', username: 'karel2' });
    // Party yang tidak terdaftar milik siapa pun → null, bukan nebak prefix.
    await expect(findUserByPartyExact(users, 'karel3::1220xxx')).resolves.toBeNull();
  });

  it('party auth0_… TIDAK di-resolve lewat keycloakId (fallback lama dihapus)', async () => {
    const users = makeLookup([
      { id: 'u1', username: 'ali', cantonPartyId: 'ali::1220111' },
    ]);
    await expect(
      findUserByPartyExact(users, 'auth0_007c6643538f2eadd3e573dd05b9'),
    ).resolves.toBeNull();
  });

  it('party internal canquest: → null tanpa query DB', async () => {
    let queried = false;
    const users: PartyUserLookup = {
      async findMany() {
        queried = true;
        return [];
      },
    };
    await expect(
      findUserByPartyExact(users, 'canquest:internal'),
    ).resolves.toBeNull();
    expect(queried).toBe(false);
  });

  it('tabrakan casing di DB (dua user match case-insensitive) → null (fail-closed)', async () => {
    const users = makeLookup([
      { id: 'u1', username: 'karel', cantonPartyId: 'karel::1220abc' },
      { id: 'u2', username: 'karel-dupe', cantonPartyId: 'KAREL::1220ABC' },
    ]);
    await expect(findUserByPartyExact(users, 'karel::1220abc')).resolves.toBeNull();
  });

  it('input kosong / whitespace → null', async () => {
    const users = makeLookup([]);
    await expect(findUserByPartyExact(users, '')).resolves.toBeNull();
    await expect(findUserByPartyExact(users, '   ')).resolves.toBeNull();
    await expect(findUserByPartyExact(users, null)).resolves.toBeNull();
    await expect(findUserByPartyExact(users, undefined)).resolves.toBeNull();
  });
});
