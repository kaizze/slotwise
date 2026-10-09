import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/client.js';

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const PlatformRefreshTokenService = {
  async issue(userId: string): Promise<string> {
    const rawToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    await db.query(`
      INSERT INTO platform_refresh_tokens (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    `, [randomUUID(), userId, tokenHash, expiresAt]);

    return rawToken;
  },

  async verify(rawToken: string): Promise<{ userId: string; tokenId: string } | null> {
    const tokenHash = hashToken(rawToken);
    const row = await db.queryOne<{ id: string; user_id: string }>(`
      SELECT id, user_id FROM platform_refresh_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `, [tokenHash]);

    if (!row) return null;
    return { userId: row.user_id, tokenId: row.id };
  },

  async rotate(oldTokenId: string, userId: string): Promise<string> {
    await db.query(
      'UPDATE platform_refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [oldTokenId],
    );
    return this.issue(userId);
  },

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await db.query(
      `UPDATE platform_refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  },
};
