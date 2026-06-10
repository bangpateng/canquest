import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * FeaturedAppActivityService
 *
 * Creates FeaturedAppActivityMarker contracts on the Canton ledger to earn
 * app rewards for CanQuest activity.
 *
 * Official Canton Network documentation:
 *   https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker
 *
 * How it works:
 *   1. The App Provider (CanQuest validator party) creates a
 *      FeaturedAppActivityMarker contract for each meaningful user action.
 *   2. Super Validators detect these markers each round and credit the
 *      App Provider's reward coupon pool proportional to activity volume.
 *   3. Reward coupons are redeemed for Canton Coin.
 *
 * Template: splice-amulet:Splice.Amulet:AppRewardCoupon (internal)
 * Marker:   splice-amulet:Splice.Amulet:FeaturedAppActivityMarker
 *
 * In DevNet/TestNet this is a no-op unless the validator is registered as
 * a featured app. In MainNet it generates real CC rewards.
 *
 * Reference implementation in cn-quickstart:
 *   https://github.com/digital-asset/cn-quickstart/blob/main/quickstart/backend/src/main/java/com/digitalasset/quickstart/service/LicenseApiImpl.java
 */
@Injectable()
export class FeaturedAppActivityService {
  private readonly logger = new Logger(FeaturedAppActivityService.name);

  private readonly baseUrl: string;
  private readonly secret: string | null;
  private readonly ledgerApiUser: string;
  private readonly ledgerAudience: string;
  private readonly appProviderPartyId: string | null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('CANTON_JSON_API_URL') ?? 'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
    this.secret = config.get<string>('CANTON_SPLICE_SECRET') ?? null;
    this.ledgerApiUser =
      config.get<string>('CANTON_LEDGER_API_USER') ?? 'ledger-api-user';
    this.ledgerAudience =
      config.get<string>('CANTON_LEDGER_API_AUDIENCE') ??
      'https://canton.network.global';
    this.appProviderPartyId =
      config.get<string>('CANTON_APP_PROVIDER_PARTY_ID') ?? null;
  }

  private ledgerToken(): string | null {
    if (!this.secret) return null;
    return jwt.sign(
      { sub: this.ledgerApiUser, aud: this.ledgerAudience },
      this.secret,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
  }

  private authHeaders(): Record<string, string> {
    const token = this.ledgerToken();
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) base['Authorization'] = `Bearer ${token}`;
    return base;
  }

  /**
   * Returns true if the service is configured and can submit activity markers.
   * Requires CANTON_APP_PROVIDER_PARTY_ID to be set in addition to the
   * standard Canton JSON API settings.
   */
  /** App-reward layer (quest/task markers). Off by default — enable only on featured-app MainNet. */
  get isEnabled(): boolean {
    const flag = this.config.get<string>('FEATURED_APP_MARKERS_ENABLED');
    return flag === 'true' || flag === '1';
  }

  get isConfigured(): boolean {
    return (
      this.isEnabled &&
      Boolean(this.appProviderPartyId && this.secret && this.baseUrl)
    );
  }

  /**
   * Record a FeaturedAppActivityMarker for a user action.
   *
   * Per the Canton docs, each meaningful user interaction (quest completion,
   * CC transfer, wallet creation, etc.) should result in one marker contract.
   * The Super Validators aggregate these per round to compute rewards.
   *
   * Spec: https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker
   *
   * @param activityType - human-readable label for this activity
   * @param userPartyId  - the Canton Party ID of the end user
   * @param description  - optional extra context
   */
  async recordActivity(
    activityType: 'quest_completed' | 'cc_transfer' | 'wallet_created' | 'task_verified',
    userPartyId: string,
    description?: string,
  ): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.debug(
        'FeaturedAppActivity: CANTON_APP_PROVIDER_PARTY_ID not set — skipping marker.',
      );
      return false;
    }

    // FeaturedAppActivityMarker templateId from the Splice amulet package.
    //
    // IMPORTANT for MainNet: `#` shorthand (dynamic package resolution) is
    // unreliable in production. Always set CANTON_FEATURED_APP_MARKER_TEMPLATE_ID
    // to the FULL package hash of the deployed splice-amulet DAR:
    //   "<64-char-package-hash>:Splice.Amulet:FeaturedAppActivityMarker"
    //
    // You can find the hash via:
    //   node apps/api/scripts/find-v7-package.cjs splice-amulet
    //
    // The `#` shorthand fallback is ONLY for DevNet/TestNet where package versions
    // change frequently.
    const templateId =
      this.config.get<string>('CANTON_FEATURED_APP_MARKER_TEMPLATE_ID')?.trim() ||
      (() => {
        this.logger.warn(
          'CANTON_FEATURED_APP_MARKER_TEMPLATE_ID not set — FeaturedAppActivityMarker will be skipped. ' +
          'On MainNet this MUST be set to the full package hash of splice-amulet.',
        );
        return '';
      })();

    if (!templateId) return false;

    const commandId = `canquest-activity-${activityType}-${randomUUID()}`;
    const url = `${this.baseUrl}/v2/commands/submit-and-wait`;

    const body = {
      commands: [
        {
          CreateCommand: {
            templateId,
            createArguments: {
              provider: this.appProviderPartyId,
              user: userPartyId,
              activityType,
              description: description ?? `CanQuest ${activityType}`,
            },
          },
        },
      ],
      userId: this.ledgerApiUser,
      commandId,
      actAs: [this.appProviderPartyId],
      readAs: [this.appProviderPartyId],
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        this.logger.debug(
          `FeaturedAppActivityMarker created: ${activityType} for ${userPartyId.split('::')[0]}`,
        );
        return true;
      }

      // 400-level errors on this are non-critical — log and continue
      const text = await res.text();
      this.logger.warn(
        `FeaturedAppActivityMarker ${res.status}: ${text.slice(0, 200)}`,
      );
      return false;
    } catch (err) {
      // Network error — non-critical, the main operation already succeeded
      this.logger.warn(`FeaturedAppActivityMarker submit failed: ${String(err)}`);
      return false;
    }
  }
}
