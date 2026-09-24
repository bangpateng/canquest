import type { OneSwapConfig } from './oneswap.config';

export type SwapQuoteLike = {
  amountOut: number;
  effInput: number;
  networkFeeIn: number;
};

export type SwapQuoteGuardCode =
  | 'SWAP_NETWORK_FEE_TOO_HIGH'
  | 'SWAP_INPUT_BELOW_NETWORK_FEE'
  | 'SWAP_NO_EFFECTIVE_INPUT'
  | 'SWAP_NO_OUTPUT';

export class SwapQuoteGuardError extends Error {
  constructor(
    public readonly code: SwapQuoteGuardCode,
    message: string,
  ) {
    super(message);
    this.name = 'SwapQuoteGuardError';
  }
}

/**
 * Reject an economically unusable quote before OneSwap state, a pending row,
 * a ledger transfer, or a browser signature is created.
 *
 * `networkFeeIn` is taken from the input token. A quote can have acceptable
 * price impact while still spending most/all of the input on network fees.
 */
export function assertUsableSwapQuote(
  amountIn: number,
  quote: SwapQuoteLike,
  config: Pick<OneSwapConfig, 'maxNetworkFeeRatio'>,
): void {
  const input = Number(amountIn);
  const output = Number(quote.amountOut);
  const effectiveInput = Number(quote.effInput);
  const networkFee = Number(quote.networkFeeIn);

  if (!Number.isFinite(input) || input <= 0) {
    throw new SwapQuoteGuardError(
      'SWAP_NO_EFFECTIVE_INPUT',
      'This swap quote has no valid input amount.',
    );
  }
  if (!Number.isFinite(output) || output <= 0) {
    throw new SwapQuoteGuardError(
      'SWAP_NO_OUTPUT',
      'This swap quote has no usable output. Try again later.',
    );
  }
  if (!Number.isFinite(effectiveInput) || effectiveInput <= 0) {
    throw new SwapQuoteGuardError(
      'SWAP_NO_EFFECTIVE_INPUT',
      'The current network fee leaves no effective swap input.',
    );
  }
  if (!Number.isFinite(networkFee) || networkFee < 0) {
    throw new SwapQuoteGuardError(
      'SWAP_NO_EFFECTIVE_INPUT',
      'The current swap quote has an invalid network fee.',
    );
  }
  if (networkFee >= input) {
    throw new SwapQuoteGuardError(
      'SWAP_INPUT_BELOW_NETWORK_FEE',
      'This amount is below the current network fee. Try a larger amount.',
    );
  }

  const ratio = networkFee / input;
  if (ratio > config.maxNetworkFeeRatio) {
    throw new SwapQuoteGuardError(
      'SWAP_NETWORK_FEE_TOO_HIGH',
      'The current network fee is too high for this amount. Try a larger amount or try again later.',
    );
  }
}
