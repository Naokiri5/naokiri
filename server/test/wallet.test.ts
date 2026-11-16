import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb } from './helpers.js';
import { keccak256 } from '../src/wallet/keccak.js';
import { validateAddress, toChecksum, addAddress, previewWithdrawal, verifyAddress } from '../src/wallet/wallet.js';

describe('wallet center (Part 24)', () => {
  beforeAll(() => freshDb());
  it('keccak256 known vectors', () => {
    expect(keccak256(new Uint8Array())).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccak256(new TextEncoder().encode('abc'))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });
  it('EIP-55 checksum', () => {
    for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB']) expect(toChecksum(a.toLowerCase())).toBe(a);
    expect(validateAddress('ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD').valid).toBe(false);
    expect(validateAddress('solana', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').valid).toBe(false);
    expect(validateAddress('foo', 'x').error).toMatch(/network/);
  });
  it('withdrawals are blocked by release gate; mismatches detected; bot/assistant have no path', () => {
    const { id } = addAddress('owner', 'cold', 'ethereum', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
    verifyAddress('owner', id);
    const p = previewWithdrawal('owner', { network: 'ethereum', asset: 'SOL', amount: 1, addressId: id });
    expect(p.status).toBe('BLOCKED_BY_RELEASE_GATE');
    expect(p.reasons.join()).toMatch(/MISMATCH/); expect(p.reasons.join()).toMatch(/cooling-off/);
    expect(() => previewWithdrawal('bot', { network: 'ethereum', asset: 'ETH', amount: 1, addressId: id })).toThrow();
    expect(() => addAddress('trader-joe', 'x', 'ethereum', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toThrow();
  });
});
