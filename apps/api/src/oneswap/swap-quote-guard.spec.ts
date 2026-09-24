import { assertUsableSwapQuote, SwapQuoteGuardError } from './swap-quote-guard';

const cfg = { maxNetworkFeeRatio: 0.5 } as const;
const quote = (
  overrides: Partial<Parameters<typeof assertUsableSwapQuote>[1]> = {},
) => ({
  amountOut: 1,
  effInput: 9,
  networkFeeIn: 1,
  ...overrides,
});

describe('assertUsableSwapQuote', () => {
  it('accepts a usable quote below the fee ratio', () => {
    expect(() =>
      assertUsableSwapQuote(10, quote({ effInput: 7, networkFeeIn: 3 }), cfg),
    ).not.toThrow();
  });

  it('rejects input at or below the network fee', () => {
    expect(() =>
      assertUsableSwapQuote(10, quote({ effInput: 0, networkFeeIn: 10 }), cfg),
    ).toThrow(SwapQuoteGuardError);
    try {
      assertUsableSwapQuote(10, quote({ effInput: 0, networkFeeIn: 10 }), cfg);
    } catch (e) {
      expect(e).toMatchObject({ code: 'SWAP_NO_EFFECTIVE_INPUT' });
    }
  });

  it('rejects a network fee that exceeds the input', () => {
    try {
      assertUsableSwapQuote(10, quote({ effInput: 1, networkFeeIn: 11 }), cfg);
      throw new Error('expected quote guard to throw');
    } catch (e) {
      expect(e).toMatchObject({ code: 'SWAP_INPUT_BELOW_NETWORK_FEE' });
    }
  });

  it('rejects a fee ratio above the configured threshold', () => {
    try {
      assertUsableSwapQuote(10, quote({ effInput: 4, networkFeeIn: 6 }), cfg);
      throw new Error('expected quote guard to throw');
    } catch (e) {
      expect(e).toMatchObject({ code: 'SWAP_NETWORK_FEE_TOO_HIGH' });
    }
  });

  it('rejects zero output and invalid values', () => {
    try {
      assertUsableSwapQuote(10, quote({ amountOut: 0 }), cfg);
      throw new Error('expected quote guard to throw');
    } catch (e) {
      expect(e).toMatchObject({ code: 'SWAP_NO_OUTPUT' });
    }
    try {
      assertUsableSwapQuote(10, quote({ amountOut: Number.NaN }), cfg);
      throw new Error('expected quote guard to throw');
    } catch (e) {
      expect(e).toMatchObject({ code: 'SWAP_NO_OUTPUT' });
    }
  });
});
