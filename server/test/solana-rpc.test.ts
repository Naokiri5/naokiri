import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { provider } from '../src/providers/http.js';
import { fetchFinalizedMintObservations } from '../src/providers/solanaRpc.js';

const mint = 'So11111111111111111111111111111111111111112';
const secondMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const info = { decimals: 9, isInitialized: true, mintAuthority: null, freezeAuthority: null };
const spl = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const account = (fields: unknown = info, owner = spl) => ({ owner, executable: false, data: { parsed: { type: 'mint', info: fields } } });
const reply = (values: unknown[], slot: unknown = 274) => Response.json({ jsonrpc: '2.0', id: 1, result: { context: { slot }, value: values } });

describe('finalized FAST mint observations', () => {
  const fetchRpc = vi.fn<typeof fetch>();
  let offline: boolean;
  beforeEach(() => {
    offline = config.offline;
    config.offline = false;
    fetchRpc.mockReset();
    vi.stubGlobal('fetch', fetchRpc);
  });
  afterEach(() => { config.offline = offline; vi.unstubAllGlobals(); });

  it('makes one bounded finalized account read and attributes results in requested order', async () => {
    fetchRpc.mockResolvedValueOnce(reply([account(), account({ ...info, freezeAuthority: mint })]));
    const observed = await fetchFinalizedMintObservations([mint, secondMint]);
    expect(observed).toMatchObject([
      { mintAddress: mint, commitment: 'finalized', slot: 274, program: 'SPL_TOKEN', status: 'MINT_CHECKS_PASSED' },
      { mintAddress: secondMint, status: 'BLOCKED', reasons: ['ACTIVE_FREEZE_AUTHORITY'] },
    ]);
    expect(fetchRpc).toHaveBeenCalledTimes(1);
    const [url, init] = fetchRpc.mock.calls[0];
    expect(url).toBe('https://api.mainnet-beta.solana.com/');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: 'getMultipleAccounts',
      params: [[mint, secondMint], { encoding: 'jsonParsed', commitment: 'finalized' }] });
  });

  it('keeps missing and unknown token permissions unverified, and blocks restrictive extensions', async () => {
    fetchRpc.mockResolvedValueOnce(reply([null, account(info, token2022)]));
    expect(await fetchFinalizedMintObservations([mint, secondMint])).toMatchObject([
      { status: 'UNVERIFIED' }, { status: 'UNVERIFIED', reasons: ['TOKEN_EXTENSIONS_REQUIRE_REVIEW'] },
    ]);
    fetchRpc.mockResolvedValueOnce(reply([
      account({ ...info, extensions: [{ extension: 'transferHook' }] }, token2022),
      account({ ...info, extensions: [{ extension: 'unrecognizedProviderExtension' }] }, token2022),
    ]));
    expect(await fetchFinalizedMintObservations([mint, secondMint])).toMatchObject([
      { status: 'BLOCKED', reasons: ['RESTRICTIVE_TOKEN_EXTENSION'] },
      { status: 'UNVERIFIED', reasons: ['TOKEN_EXTENSIONS_REQUIRE_REVIEW'] },
    ]);
  });

  it('rejects invalid identities, misaligned responses, oversize bodies and all RPC redirects', async () => {
    await expect(fetchFinalizedMintObservations(['not-a-mint'])).rejects.toThrow('invalid mint batch');
    await expect(fetchFinalizedMintObservations([mint, mint])).rejects.toThrow('invalid mint batch');
    expect(fetchRpc).not.toHaveBeenCalled();
    fetchRpc.mockResolvedValueOnce(reply([account(), account()]));
    await expect(fetchFinalizedMintObservations([mint])).rejects.toThrow('invalid finalized mint response');
    expect(provider('solana_rpc_mint')?.lastError).toContain('invalid finalized mint response');
    fetchRpc.mockResolvedValueOnce(new Response('x'.repeat(525_000)));
    await expect(fetchFinalizedMintObservations([mint])).rejects.toThrow('exceeds byte limit');
    fetchRpc.mockResolvedValueOnce(Response.redirect('https://api.mainnet-beta.solana.com/redirect', 307));
    await expect(fetchFinalizedMintObservations([mint])).rejects.toThrow('redirect refused');
    expect(fetchRpc).toHaveBeenCalledTimes(3);
  });
});
