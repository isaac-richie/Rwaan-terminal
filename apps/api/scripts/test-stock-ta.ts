import { computeStockTechnicals } from "../src/services/stock-ta.js";

async function main() {
  for (const sym of ["NVDA", "AAPL"]) {
    const t0 = Date.now();
    const r = await computeStockTechnicals(sym);
    console.log(`${sym}: ${Date.now() - t0}ms`);
    if (!r) { console.log("  NULL"); continue; }
    console.log("  " + r.summary);
    for (const s of r.signals) console.log(`   ${s.name}: ${s.direction} — ${s.reason}`);
  }
}
main();
