import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { assertHasRealWallet } from './wallet-policy';

@Injectable()
export class WalletRequiredGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>();
    const userId = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.users.findById(userId);
    assertHasRealWallet(user?.cantonPartyId);

    return true;
  }
}
