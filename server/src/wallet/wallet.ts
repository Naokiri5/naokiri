import { keccak256 } from './keccak.js';
import { all, get, run, J, P } from '../db/db.js';
import { uid } from '../core/util.js';
import { audit } from '../core/audit.js';
import { getSetting, setSetting } from '../core/settings.js';
import { releaseGates } from '../qa/gates.js';

/**
 * Part 24 Multi-network wallet & withdrawal center — READ-ONLY build.
 * No seed phrases or private keys are ever requested or stored. No signer exists. Withdrawals stop at
 * a validated preview and are BLOCKED_BY_RELEASE_GATE. The trading bot has no code path here.
 */
export interface Network { id: string; name: string; family: 'EVM' | 'BTC' | 'SOL' | 'TRON'; chainId?: number; nativeAsset: string; assets: string[]; addressHint: string; status: 'READ_ONLY_PENDING_RPC' }
export const NETWORKS: Network[] = [
  { id: 'bitcoin', name: 'Bitcoin', family: 'BTC', nativeAsset: 'BTC', assets: ['BTC'], addressHint: 'bc1… / 1… / 3…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'ethereum', name: 'Ethereum', family: 'EVM', chainId: 1, nativeAsset: 'ETH', assets: ['ETH', 'USDT', 'USDC'], addressHint: '0x… (EIP-55)', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'arbitrum', name: 'Arbitrum One', family: 'EVM', chainId: 42161, nativeAsset: 'ETH', assets: ['ETH', 'USDT', 'USDC', 'ARB'], addressHint: '0x…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'base', name: 'Base', family: 'EVM', chainId: 8453, nativeAsset: 'ETH', assets: ['ETH', 'USDC'], addressHint: '0x…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'optimism', name: 'OP Mainnet', family: 'EVM', chainId: 10, nativeAsset: 'ETH', assets: ['ETH', 'USDT', 'USDC', 'OP'], addressHint: '0x…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'polygon', name: 'Polygon PoS', family: 'EVM', chainId: 137, nativeAsset: 'POL', assets: ['POL', 'USDT', 'USDC'], addressHint: '0x…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'bsc', name: 'BNB Smart Chain', family: 'EVM', chainId: 56, nativeAsset: 'BNB', assets: ['BNB', 'USDT', 'USDC'], addressHint: '0x…', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'solana', name: 'Solana', family: 'SOL', nativeAsset: 'SOL', assets: ['SOL', 'USDC', 'USDT'], addressHint: 'base58, 32–44 chars', status: 'READ_ONLY_PENDING_RPC' },
  { id: 'tron', name: 'Tron', family: 'TRON', nativeAsset: 'TRX', assets: ['TRX', 'USDT'], addressHint: 'T… (34 chars)', status: 'READ_ONLY_PENDING_RPC' },
];
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function toChecksum(addr: string) {
  const a = addr.toLowerCase().replace(/^0x/, ''); const h = keccak256(new TextEncoder().encode(a));
  return '0x' + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
export function validateAddress(networkId: string, address: string): { valid: boolean; normalized?: string; warnings: string[]; error?: string } {
  const n = NETWORKS.find((x) => x.id === networkId); const w: string[] = [];
  if (!n) return { valid: false, warnings: w, error: 'unknown network — select the exact destination network' };
  const a = address.trim();
  switch (n.family) {
    case 'EVM': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { valid: false, warnings: w, error: 'not a 20-byte 0x address' };
      const mixed = /[a-f]/.test(a.slice(2)) && /[A-F]/.test(a.slice(2));
      if (mixed && toChecksum(a) !== a) return { valid: false, warnings: w, error: 'EIP-55 checksum mismatch (possible typo)' };
      if (!mixed) w.push('address has no checksum casing; verify it carefully');
      w.push('EVM addresses are valid on every EVM chain — confirm the recipient supports this specific network');
      return { valid: true, normalized: toChecksum(a), warnings: w };
    }
    case 'BTC':
      if (/^bc1[ac-hj-np-z02-9]{11,71}$/.test(a) || (/^[13]/.test(a) && B58.test(a) && a.length >= 26 && a.length <= 35)) return { valid: true, normalized: a, warnings: ['format check only (Base58Check/Bech32 checksum verified by the signer service)'] };
      return { valid: false, warnings: w, error: 'not a Bitcoin mainnet address' };
    case 'SOL':
      if (B58.test(a) && a.length >= 32 && a.length <= 44) return { valid: true, normalized: a, warnings: ['format check only; on-curve check requires RPC'] };
      return { valid: false, warnings: w, error: 'not a base58 Solana address' };
    case 'TRON':
      if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return { valid: true, normalized: a, warnings: ['format check only'] };
      return { valid: false, warnings: w, error: 'not a Tron address' };
  }
}
export const ADDRESS_COOLDOWN_MS = 24 * 3600_000;
export function addAddress(actor: string, label: string, networkId: string, address: string, memo?: string) {
  if (actor !== 'owner') throw new Error('only the owner may edit the address book');
  const v = validateAddress(networkId, address); if (!v.valid) throw new Error(v.error);
  if (get('SELECT 1 FROM address_book WHERE network=? AND address=?', networkId, v.normalized)) throw new Error('address already in book for this network');
  const id = uid('adr'); const t = Date.now();
  run('INSERT INTO address_book(id,label,network,address,memo,created_at,verified_at,cooldown_until) VALUES (?,?,?,?,?,?,?,?)', id, label.slice(0, 60), networkId, v.normalized, memo ?? null, t, null, t + ADDRESS_COOLDOWN_MS);
  audit(actor, 'addressbook.add', { id, networkId, address: v.normalized });
  return { id, warnings: v.warnings };
}
export function removeAddress(actor: string, id: string) { if (actor !== 'owner') throw new Error('owner only'); run('DELETE FROM address_book WHERE id=?', id); audit(actor, 'addressbook.remove', { id }); }
export function verifyAddress(actor: string, id: string) { if (actor !== 'owner') throw new Error('owner only'); run('UPDATE address_book SET verified_at=? WHERE id=?', Date.now(), id); audit(actor, 'addressbook.verify', { id }); }
export const listAddresses = () => all('SELECT * FROM address_book ORDER BY created_at DESC');
export const withdrawalFrozen = () => getSetting('withdrawalFreeze', false);
export function setWithdrawalFreeze(actor: string, on: boolean) { if (actor !== 'owner' && !on) throw new Error('only the owner may lift the freeze'); setSetting('withdrawalFreeze', on); audit(actor, 'withdrawal.freeze', { on }); }

/** Guided preview (Part 24.2 steps 1–9). Never submits: there is no signer in this build. */
export function previewWithdrawal(actor: string, input: { network: string; asset: string; amount: number; addressId: string }) {
  if (actor !== 'owner') throw new Error('owner only — the trading bot and assistant have no withdrawal path');
  const reasons: string[] = []; const n = NETWORKS.find((x) => x.id === input.network);
  const addr = get<any>('SELECT * FROM address_book WHERE id=?', input.addressId);
  if (!n) reasons.push('unknown network');
  if (n && !n.assets.includes(input.asset)) reasons.push(`ASSET/NETWORK MISMATCH: ${input.asset} is not supported on ${n.name}`);
  if (!addr) reasons.push('destination not in verified address book');
  else {
    if (addr.network !== input.network) reasons.push(`address saved for ${addr.network}, not ${input.network}`);
    if (!addr.verified_at) reasons.push('destination address not verified by owner');
    if (addr.cooldown_until > Date.now()) reasons.push(`new-address cooling-off until ${new Date(addr.cooldown_until).toISOString()}`);
  }
  if (!(input.amount > 0)) reasons.push('amount must be positive');
  if (withdrawalFrozen()) reasons.push('EMERGENCY WITHDRAWAL FREEZE active');
  reasons.push('BALANCE_UNAVAILABLE: no custody/RPC provider connected — cannot verify balance, fee or simulation');
  const gate = releaseGates(); if (!gate.liveAllowed) reasons.push('BLOCKED_BY_RELEASE_GATE: no isolated signing service is certified (Part 12.7 / 24.6)');
  const id = uid('wd');
  run('INSERT INTO withdrawal_requests(id,created_at,network,asset,amount,address_id,status,reasons) VALUES (?,?,?,?,?,?,?,?)', id, Date.now(), input.network, input.asset, input.amount, input.addressId, 'BLOCKED_BY_RELEASE_GATE', J(reasons));
  audit(actor, 'withdrawal.preview', { id, ...input, status: 'BLOCKED_BY_RELEASE_GATE' });
  return { id, status: 'BLOCKED_BY_RELEASE_GATE', preview: { network: n?.name, asset: input.asset, amount: input.amount, destination: addr?.address ?? null, fee: null, netReceipt: null }, reasons };
}
export const listWithdrawals = () => all<any>('SELECT * FROM withdrawal_requests ORDER BY created_at DESC LIMIT 100').map((r) => ({ ...r, reasons: P(r.reasons) }));
