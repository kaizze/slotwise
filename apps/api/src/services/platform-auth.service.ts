import type { PlatformAuthTokenPayload, PlatformUser } from '@slotwise/types';
import { PlatformUserService } from './platform-user.service.js';
import { PlatformRefreshTokenService } from './platform-refresh-token.service.js';

export interface PlatformAuthResult {
  user: PlatformUser;
  accessPayload: PlatformAuthTokenPayload;
  refreshToken: string;
}

export const PlatformAuthService = {
  async login(email: string, password: string): Promise<PlatformAuthResult | null> {
    const user = await PlatformUserService.verifyCredentials(email, password);
    if (!user) return null;

    const refreshToken = await PlatformRefreshTokenService.issue(user.id);
    return {
      user,
      accessPayload: {
        typ: 'platform',
        userId: user.id,
        role: user.role,
      },
      refreshToken,
    };
  },

  async refresh(rawRefreshToken: string): Promise<{
    accessPayload: PlatformAuthTokenPayload;
    refreshToken: string;
    user: PlatformUser;
  } | null> {
    const verified = await PlatformRefreshTokenService.verify(rawRefreshToken);
    if (!verified) return null;

    const user = await PlatformUserService.getById(verified.userId);
    if (!user || !user.isActive) return null;

    const refreshToken = await PlatformRefreshTokenService.rotate(
      verified.tokenId,
      user.id,
    );

    return {
      user,
      accessPayload: {
        typ: 'platform',
        userId: user.id,
        role: user.role,
      },
      refreshToken,
    };
  },

  async logout(rawRefreshToken: string): Promise<void> {
    await PlatformRefreshTokenService.revoke(rawRefreshToken);
  },
};
