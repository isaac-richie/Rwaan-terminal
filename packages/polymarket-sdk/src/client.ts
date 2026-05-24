import type {
  BridgeDepositRequest,
  BridgeQuoteRequest,
  BridgeWithdrawRequest,
  PolymarketConfig
} from "@smartmarket/types";

export class PolymarketClient {
  private config: PolymarketConfig;

  constructor(config: PolymarketConfig) {
    this.config = config;
  }

  async getGeoblockStatus(): Promise<unknown> {
    return this.getJson(this.config.geoblockUrl);
  }

  async getSupportedAssets(): Promise<unknown> {
    return this.getJson(`${this.config.bridgeBaseUrl}/supported-assets`);
  }

  async postQuote(payload: BridgeQuoteRequest): Promise<unknown> {
    return this.postJson(`${this.config.bridgeBaseUrl}/quote`, payload);
  }

  async postDeposit(payload: BridgeDepositRequest): Promise<unknown> {
    return this.postJson(`${this.config.bridgeBaseUrl}/deposit`, payload);
  }

  async postWithdraw(payload: BridgeWithdrawRequest): Promise<unknown> {
    return this.postJson(`${this.config.bridgeBaseUrl}/withdraw`, payload);
  }

  async getStatus(address: string): Promise<unknown> {
    return this.getJson(`${this.config.bridgeBaseUrl}/status/${address}`);
  }

  async getGamma(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.getJson(this.withQuery(`${this.config.gammaBaseUrl}${path}`, query));
  }

  async getData(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.getJson(this.withQuery(`${this.config.dataBaseUrl}${path}`, query));
  }

  async getClobPublic(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.getJson(this.withQuery(`${this.config.clobBaseUrl}${path}`, query));
  }

  async getClobAuthenticated(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    headers: Record<string, string>
  ): Promise<unknown> {
    return this.getJson(this.withQuery(`${this.config.clobBaseUrl}${path}`, query), headers);
  }

  async postClobPublic(path: string, payload: unknown): Promise<unknown> {
    return this.postJson(`${this.config.clobBaseUrl}${path}`, payload);
  }

  async clobAuth(path: string, headers: Record<string, string>): Promise<unknown> {
    return this.postJson(`${this.config.clobBaseUrl}${path}`, undefined, headers);
  }

  async clobCreateApiKey(headers: Record<string, string>): Promise<unknown> {
    return this.postJson(`${this.config.clobBaseUrl}/auth/api-key`, undefined, headers);
  }

  private withQuery(url: string, query: Record<string, string | number | boolean | undefined>): string {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined) return;
      params.set(key, String(value));
    });
    const suffix = params.toString();
    return suffix ? `${url}?${suffix}` : url;
  }

  private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  }

  private async postJson(url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": payload ? "application/json" : "text/plain",
        ...headers
      },
      body: payload ? JSON.stringify(payload) : undefined
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  }
}
