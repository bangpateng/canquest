import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { SpinService } from './spin.service';

/**
 * SpinAdminController — endpoints admin untuk manage spin items & stats.
 * Terpisah dari SpinController agar tidak ada circular dependency dengan AdminModule.
 * Menggunakan AuthGuard('admin-jwt') — sama dengan admin panel lainnya.
 */
@Controller('admin/spin')
@UseGuards(AuthGuard('admin-jwt'))
@SkipThrottle()
export class SpinAdminController {
  constructor(private readonly spin: SpinService) {}

  @Get('items')
  getAllItems() {
    return this.spin.listAllItems();
  }

  @Post('items')
  createItem(
    @Body()
    body: {
      label: string;
      rewardType: string;
      rewardCc?: number;
      rewardPoints?: number;
      probability: number;
      color?: string;
      icon?: string;
      inventory?: number | null;
    },
  ) {
    return this.spin.createItem(body);
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body()
    body: Partial<{
      label: string;
      rewardType: string;
      rewardCc: number;
      rewardPoints: number;
      probability: number;
      color: string;
      icon: string;
      inventory: number | null;
      active: boolean;
    }>,
  ) {
    return this.spin.updateItem(itemId, body);
  }

  @Delete('items/:itemId')
  deleteItem(@Param('itemId') itemId: string) {
    return this.spin.deleteItem(itemId);
  }

  @Get('stats')
  getStats() {
    return this.spin.getAdminStats();
  }

  @Get('settings')
  getSettings() {
    return this.spin.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() body: { spinCost?: number }) {
    if (body.spinCost !== undefined) {
      return this.spin.updateSpinCost(body.spinCost).then((spinCost) => ({ spinCost }));
    }
    return this.spin.getSettings();
  }
}
