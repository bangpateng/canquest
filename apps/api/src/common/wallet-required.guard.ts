import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from './wallet-policy';

@Injectable()
export class WalletRequiredGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { userId: string } }>();
    const userId = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.users.findById(userId);
    if (!hasRealWallet(user?.cantonPartyId)) {
      throw new ForbiddenException(
        'Please create your Canton wallet first to access Earn and Spin Reward.',
      );
    }

    return true;
  }
}
