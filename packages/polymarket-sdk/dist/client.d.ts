import type { BridgeDepositRequest, BridgeQuoteRequest, BridgeWithdrawRequest, PolymarketConfig } from "@smartmarket/types";
export declare class PolymarketClient {
    private config;
    constructor(config: PolymarketConfig);
    getGeoblockStatus(): Promise<unknown>;
    getSupportedAssets(): Promise<unknown>;
    postQuote(payload: BridgeQuoteRequest): Promise<unknown>;
    postDeposit(payload: BridgeDepositRequest): Promise<unknown>;
    postWithdraw(payload: BridgeWithdrawRequest): Promise<unknown>;
    getStatus(address: string): Promise<unknown>;
    getGamma(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    getData(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    getClobPublic(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    getClobAuthenticated(path: string, query: Record<string, string | number | boolean | undefined> | undefined, headers: Record<string, string>): Promise<unknown>;
    postClobPublic(path: string, payload: unknown): Promise<unknown>;
    clobAuth(path: string, headers: Record<string, string>): Promise<unknown>;
    clobCreateApiKey(headers: Record<string, string>): Promise<unknown>;
    private withQuery;
    private getJson;
    private postJson;
}
//# sourceMappingURL=client.d.ts.map