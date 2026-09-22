import { ConfigService } from '@nestjs/config';

import { ClaimOfferService } from './claim-offer.service';

type FeeResolver = (quest: {
  claimFeeCc?: number | null;
  rewardType: string;
}) => number;

describe('ClaimOfferService fee defaults', () => {
  let resolveFee: FeeResolver;

  beforeEach(() => {
    const service = new ClaimOfferService(
      new ConfigService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getSnapshot: () => ({
          tokenFeeCc: 1,
          codeFeeCc: 0.5,
          combinedFeeCc: 1,
        }),
      } as never,
    );
    resolveFee = (
      service as unknown as { resolveFee: FeeResolver }
    ).resolveFee.bind(service);
  });

  it('matches the canonical defaults for every active paid template', () => {
    expect(resolveFee({ rewardType: 'CC_ONLY' })).toBe(1);
    expect(resolveFee({ rewardType: 'CC_MANUAL' })).toBe(1);
    expect(resolveFee({ rewardType: 'INVITE_CODE_FCFS' })).toBe(0.5);
    expect(resolveFee({ rewardType: 'INVITE_CODE_RANDOM' })).toBe(0.5);
    expect(resolveFee({ rewardType: 'CC_AND_CODE_RAFFLE' })).toBe(1);
    expect(resolveFee({ rewardType: 'WAITLIST_EMAIL' })).toBe(0);
  });

  it('keeps an explicit positive campaign fee', () => {
    expect(resolveFee({ rewardType: 'CC_ONLY', claimFeeCc: 7 })).toBe(7);
  });
});
