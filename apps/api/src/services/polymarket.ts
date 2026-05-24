import { config } from "../config.js";
import { PolymarketClient, BridgeQuoteRequest, BridgeDepositRequest, BridgeWithdrawRequest } from "@smartmarket/polymarket-sdk";

const client = new PolymarketClient(config.polymarket);

export async function getGeoblockStatus(): Promise<unknown> {
  return client.getGeoblockStatus();
}

export async function getSupportedAssets(): Promise<unknown> {
  return client.getSupportedAssets();
}

export async function postQuote(payload: BridgeQuoteRequest): Promise<unknown> {
  return client.postQuote(payload);
}

export async function postDeposit(payload: BridgeDepositRequest): Promise<unknown> {
  return client.postDeposit(payload);
}

export async function postWithdraw(payload: BridgeWithdrawRequest): Promise<unknown> {
  return client.postWithdraw(payload);
}

export async function getStatus(address: string): Promise<unknown> {
  return client.getStatus(address);
}

export async function getGamma(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
  return client.getGamma(path, query);
}

export async function getData(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
  return client.getData(path, query);
}

export async function getClobPublic(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
  return client.getClobPublic(path, query);
}

export async function getClobAuthenticated(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  headers: Record<string, string>
): Promise<unknown> {
  return client.getClobAuthenticated(path, query, headers);
}

export async function postClobPublic(path: string, payload: unknown): Promise<unknown> {
  return client.postClobPublic(path, payload);
}

export async function clobAuth(path: string, headers: Record<string, string>): Promise<unknown> {
  return client.clobAuth(path, headers);
}

export async function clobCreateApiKey(headers: Record<string, string>): Promise<unknown> {
  return client.clobCreateApiKey(headers);
}
