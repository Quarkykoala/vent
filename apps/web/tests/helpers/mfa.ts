import crypto from 'node:crypto';

function decodeBase32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/**
 * Elevate a real local Supabase session from AAL1 to AAL2 using a TOTP factor.
 * CI enables local TOTP enrollment/verification before `supabase start`.
 */
export async function elevateTestSessionToAal2(client: any): Promise<string> {
  const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `test-${crypto.randomUUID().slice(0, 8)}`,
  });
  if (enrollError || !enrolled?.id || !enrolled?.totp?.secret) {
    throw new Error(`Unable to enroll test TOTP factor: ${enrollError?.message ?? 'missing enrollment data'}`);
  }

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrolled.id,
  });
  if (challengeError || !challenge?.id) {
    throw new Error(`Unable to challenge test TOTP factor: ${challengeError?.message ?? 'missing challenge'}`);
  }

  const { data: verified, error: verifyError } = await client.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge.id,
    code: currentTotp(enrolled.totp.secret),
  });
  if (verifyError) {
    throw new Error(`Unable to verify test TOTP factor: ${verifyError.message}`);
  }

  const accessToken = verified?.access_token ?? verified?.session?.access_token;
  if (accessToken) return accessToken;

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session?.access_token) {
    throw new Error('AAL2 verification succeeded but no access token was returned');
  }
  return sessionData.session.access_token;
}
