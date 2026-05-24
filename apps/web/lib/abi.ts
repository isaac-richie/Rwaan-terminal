export function encodeErc20Transfer(to: string, amount: string): string {
  const selector = "0xa9059cbb";
  const paddedTo = to.slice(2).toLowerCase().padStart(64, "0");
  const paddedAmount = BigInt(amount).toString(16).padStart(64, "0");
  return selector + paddedTo + paddedAmount;
}
