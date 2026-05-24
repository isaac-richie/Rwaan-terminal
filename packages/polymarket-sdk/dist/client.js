export class PolymarketClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async getGeoblockStatus() {
        return this.getJson(this.config.geoblockUrl);
    }
    async getSupportedAssets() {
        return this.getJson(`${this.config.bridgeBaseUrl}/supported-assets`);
    }
    async postQuote(payload) {
        return this.postJson(`${this.config.bridgeBaseUrl}/quote`, payload);
    }
    async postDeposit(payload) {
        return this.postJson(`${this.config.bridgeBaseUrl}/deposit`, payload);
    }
    async postWithdraw(payload) {
        return this.postJson(`${this.config.bridgeBaseUrl}/withdraw`, payload);
    }
    async getStatus(address) {
        return this.getJson(`${this.config.bridgeBaseUrl}/status/${address}`);
    }
    async getGamma(path, query = {}) {
        return this.getJson(this.withQuery(`${this.config.gammaBaseUrl}${path}`, query));
    }
    async getData(path, query = {}) {
        return this.getJson(this.withQuery(`${this.config.dataBaseUrl}${path}`, query));
    }
    async getClobPublic(path, query = {}) {
        return this.getJson(this.withQuery(`${this.config.clobBaseUrl}${path}`, query));
    }
    async getClobAuthenticated(path, query = {}, headers) {
        return this.getJson(this.withQuery(`${this.config.clobBaseUrl}${path}`, query), headers);
    }
    async postClobPublic(path, payload) {
        return this.postJson(`${this.config.clobBaseUrl}${path}`, payload);
    }
    async clobAuth(path, headers) {
        return this.postJson(`${this.config.clobBaseUrl}${path}`, undefined, headers);
    }
    async clobCreateApiKey(headers) {
        return this.postJson(`${this.config.clobBaseUrl}/auth/api-key`, undefined, headers);
    }
    withQuery(url, query) {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value === undefined)
                return;
            params.set(key, String(value));
        });
        const suffix = params.toString();
        return suffix ? `${url}?${suffix}` : url;
    }
    async getJson(url, headers = {}) {
        const res = await fetch(url, { headers });
        if (!res.ok)
            throw new Error(`Request failed: ${res.status}`);
        return res.json();
    }
    async postJson(url, payload, headers = {}) {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": payload ? "application/json" : "text/plain",
                ...headers
            },
            body: payload ? JSON.stringify(payload) : undefined
        });
        if (!res.ok)
            throw new Error(`Request failed: ${res.status}`);
        return res.json();
    }
}
//# sourceMappingURL=client.js.map