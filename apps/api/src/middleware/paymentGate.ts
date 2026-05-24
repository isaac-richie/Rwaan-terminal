import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyBscPayment, buildPaymentRequirement } from "../services/payment.js";

type PaymentGateOpts = {
  extractMarketId: (req: FastifyRequest) => string;
};

export function paymentGate(opts: PaymentGateOpts) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const paymentHeader =
      (req.headers["x-payment"] as string | undefined) ??
      (req.headers["X-PAYMENT"] as string | undefined);

    const marketId = opts.extractMarketId(req);

    if (!paymentHeader) {
      const requirement = buildPaymentRequirement();
      reply.header("X-Payment-Required", JSON.stringify(requirement));
      reply.status(402).send({
        ok: false,
        error: "payment_required",
        paymentRequired: requirement,
      });
      return;
    }

    const txHash = paymentHeader.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      reply.status(402).send({
        ok: false,
        error: "invalid_tx_hash",
        paymentRequired: buildPaymentRequirement(),
      });
      return;
    }

    const result = await verifyBscPayment(txHash, marketId);
    if (!result.valid) {
      reply.status(402).send({
        ok: false,
        error: result.error,
        paymentRequired: buildPaymentRequirement(),
      });
      return;
    }
  };
}
