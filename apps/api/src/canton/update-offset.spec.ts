/**
 * L60-fallback: resolveUpdateOffset — pure function, tanpa service.
 *
 * A. top-level offset ada → pakai top-level
 * B. nested LEDGER_EFFECTS unanimous → checkpoint maju ke offset itu
 * C. multi-event offset sama → maju sekali
 * D. tanpa event offset → NaN (checkpoint TAHAN)
 * E. event offset beda → NaN (checkpoint TAHAN)
 * F. monotonik advanceOffset tetap intact (diuji via perilaku tryExtract lama:
 *    NaN/null tidak menggerakkan apa pun — lihat advanceOffset guard)
 */
import { resolveUpdateOffset } from './canton-updates.service';

describe('resolveUpdateOffset (L60 checkpoint fallback)', () => {
  it('A: top-level offset ada → pakai top-level (event diabaikan)', () => {
    expect(
      resolveUpdateOffset('2180853', [{ offset: 1 }, { offset: 2 }]),
    ).toBe(2180853);
    expect(resolveUpdateOffset({ absolute: '819747' }, [])).toBe(819747);
    expect(resolveUpdateOffset(100, [{ offset: 200 }])).toBe(100);
  });

  it('B: nested LEDGER_EFFECTS tanpa top-level, unanimous → pakai itu', () => {
    // Bentuk produksi: { update:{ Transaction:{ value:{
    //   updateId, commandId, workflowId, effectiveAt, events:[
    //     { ExercisedEvent:{ offset:1325354, nodeId:0, ... } }]}}}}
    // (tanpa top-level offset).
    expect(resolveUpdateOffset(undefined, [{ offset: 1325354 }])).toBe(
      1325354,
    );
  });

  it('C: multi-event offset sama → maju sekali ke nilai itu', () => {
    expect(
      resolveUpdateOffset(undefined, [
        { offset: 2180853 },
        { offset: 2180853 },
        { offset: 2180853 },
        { offset: 2180853 },
        { offset: 2180853 },
        { offset: 2180853 },
      ]),
    ).toBe(2180853);
  });

  it('D: tanpa event offset → NaN (checkpoint TAHAN)', () => {
    expect(resolveUpdateOffset(undefined, [])).toBeNaN();
    expect(resolveUpdateOffset(undefined, [{}, {}])).toBeNaN();
    expect(
      resolveUpdateOffset(undefined, [{ nodeId: 0 }, { nodeId: 1 }]),
    ).toBeNaN();
  });

  it('E: event offset beda → NaN (checkpoint TAHAN)', () => {
    expect(
      resolveUpdateOffset(undefined, [{ offset: 100 }, { offset: 200 }]),
    ).toBeNaN();
  });

  it('F: non-finite diabaikan; bila sisa unanimous tetap pakai', () => {
    // undefined/null/NaN terfilter; sisa [50,50] unanimous → 50.
    expect(
      resolveUpdateOffset(undefined, [
        { offset: undefined },
        { offset: 50 },
        { offset: null },
        { offset: 50 },
      ]),
    ).toBe(50);
    // String numerik ikut terparse (Number(...)).
    expect(resolveUpdateOffset(undefined, [{ offset: '77' }])).toBe(77);
  });

  it('G: TIDAK PERNAH dari effectiveAt/nodeId/index/lastOffset', () => {
    // Event tanpa offset tapi dengan nodeId besar → tetap NaN.
    expect(
      resolveUpdateOffset(undefined, [{ nodeId: 999 }, { nodeId: 1000 }]),
    ).toBeNaN();
    // Top-level invalid + event invalid → NaN walau effectiveAt ada
    // (helper tidak menerima effectiveAt sama sekali — signature proof).
    expect(resolveUpdateOffset('bukan-angka', [{}])).toBeNaN();
  });
});
