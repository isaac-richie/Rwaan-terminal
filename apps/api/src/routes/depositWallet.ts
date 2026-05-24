import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  deployDepositWallet,
  getDepositWalletStatus,
  prepareDepositWalletApproval,
  prepareDepositWalletWithdraw,
  submitDepositWalletApproval,
  submitDepositWalletWithdraw
} from "../services/depositWallet.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const statusQuerySchema = z.object({
  owner: evmAddressSchema,
});

const deploySchema = z.object({
  owner: evmAddressSchema,
});

const approvalPrepareSchema = z.object({
  owner: evmAddressSchema,
  depositWallet: evmAddressSchema,
});

const depositWalletCallSchema = z.object({
  target: evmAddressSchema,
  value: z.string().regex(/^\d+$/),
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
});

const approvalSubmitSchema = z.object({
  owner: evmAddressSchema,
  depositWallet: evmAddressSchema,
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
  calls: z.array(depositWalletCallSchema).min(1).max(8),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

const withdrawPrepareSchema = z.object({
  owner: evmAddressSchema,
  depositWallet: evmAddressSchema,
  withdrawalAddress: evmAddressSchema,
  amountBaseUnit: z.string().regex(/^\d+$/),
});

const withdrawSubmitSchema = z.object({
  owner: evmAddressSchema,
  depositWallet: evmAddressSchema,
  withdrawalAddress: evmAddressSchema,
  amountBaseUnit: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
  calls: z.array(depositWalletCallSchema).min(1).max(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export async function depositWalletRoutes(app: FastifyInstance): Promise<void> {
  app.get("/deposit-wallet/status", async (req, reply) => {
    const parsed = statusQuerySchema.safeParse(req.query ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_status_query", issues: parsed.error.issues };
    }

    try {
      return await getDepositWalletStatus(parsed.data.owner);
    } catch (err) {
      req.log.error({ err }, "Deposit wallet status check failed");
      reply.status(502);
      return { ok: false, error: "deposit_wallet_status_failed" };
    }
  });

  app.post("/deposit-wallet/deploy", async (req, reply) => {
    const parsed = deploySchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_deploy_payload", issues: parsed.error.issues };
    }

    try {
      const result = await deployDepositWallet(parsed.data.owner);
      if (!result.ok && !result.builderConfigured) {
        reply.status(503);
        return { ...result, error: "builder_relayer_not_configured" };
      }
      return result;
    } catch (err) {
      req.log.error({ err }, "Deposit wallet deploy failed");
      reply.status(502);
      return { ok: false, error: "deposit_wallet_deploy_failed" };
    }
  });

  app.post("/deposit-wallet/approval/prepare", async (req, reply) => {
    const parsed = approvalPrepareSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_approval_prepare_payload", issues: parsed.error.issues };
    }

    try {
      return await prepareDepositWalletApproval(parsed.data.owner, parsed.data.depositWallet);
    } catch (err: any) {
      req.log.error({ err }, "Deposit wallet approval prepare failed");
      const clientErrors = new Set(["deposit_wallet_owner_mismatch", "deposit_wallet_not_deployed"]);
      reply.status(clientErrors.has(err?.message) ? 400 : 502);
      return { ok: false, error: err?.message ?? "deposit_wallet_approval_prepare_failed" };
    }
  });

  app.post("/deposit-wallet/approval/submit", async (req, reply) => {
    const parsed = approvalSubmitSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_approval_submit_payload", issues: parsed.error.issues };
    }

    try {
      return await submitDepositWalletApproval(parsed.data);
    } catch (err: any) {
      req.log.error({ err }, "Deposit wallet approval submit failed");
      const clientErrors = new Set([
        "deposit_wallet_owner_mismatch",
        "deposit_wallet_not_deployed",
        "deposit_wallet_deadline_too_soon",
        "deposit_wallet_signature_owner_mismatch",
        "stale_deposit_wallet_batch",
        "expired_deposit_wallet_batch",
        "invalid_deposit_wallet_deadline",
        "deposit_wallet_batch_mismatch",
        "invalid_signature",
      ]);
      reply.status(clientErrors.has(err?.message) ? 400 : err?.message === "builder_relayer_not_configured" ? 503 : 502);
      return { ok: false, error: err?.message ?? "deposit_wallet_approval_submit_failed" };
    }
  });

  app.post("/deposit-wallet/withdraw/prepare", async (req, reply) => {
    const parsed = withdrawPrepareSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_withdraw_prepare_payload", issues: parsed.error.issues };
    }

    try {
      return await prepareDepositWalletWithdraw(
        parsed.data.owner,
        parsed.data.depositWallet,
        parsed.data.withdrawalAddress,
        parsed.data.amountBaseUnit
      );
    } catch (err: any) {
      req.log.error({ err }, "Deposit wallet withdrawal prepare failed");
      const clientErrors = new Set([
        "deposit_wallet_owner_mismatch",
        "deposit_wallet_not_deployed",
        "invalid_withdraw_amount",
      ]);
      reply.status(clientErrors.has(err?.message) ? 400 : 502);
      return { ok: false, error: err?.message ?? "deposit_wallet_withdraw_prepare_failed" };
    }
  });

  app.post("/deposit-wallet/withdraw/submit", async (req, reply) => {
    const parsed = withdrawSubmitSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_deposit_wallet_withdraw_submit_payload", issues: parsed.error.issues };
    }

    try {
      return await submitDepositWalletWithdraw(parsed.data);
    } catch (err: any) {
      req.log.error({ err }, "Deposit wallet withdrawal submit failed");
      const clientErrors = new Set([
        "deposit_wallet_owner_mismatch",
        "deposit_wallet_not_deployed",
        "deposit_wallet_deadline_too_soon",
        "deposit_wallet_signature_owner_mismatch",
        "stale_deposit_wallet_batch",
        "expired_deposit_wallet_batch",
        "invalid_deposit_wallet_deadline",
        "deposit_wallet_batch_mismatch",
        "invalid_signature",
        "invalid_withdraw_amount",
      ]);
      reply.status(clientErrors.has(err?.message) ? 400 : err?.message === "builder_relayer_not_configured" ? 503 : 502);
      return { ok: false, error: err?.message ?? "deposit_wallet_withdraw_submit_failed" };
    }
  });
}
