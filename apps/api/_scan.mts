import { scanForEdges } from "./src/services/edgeScanner.js";

console.log("Scanning live Polymarket crypto markets for edges...\n");
const t0 = Date.now();
const result = await scanForEdges({ minAbsEdge: 0.05, maxResults: 15 });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`Scanned ${result.marketsScanned} markets across ${result.symbolsAnalyzed} symbols in ${elapsed}s`);
console.log(`Found ${result.edgeHits.length} edges (≥5pt)\n`);

if (result.errors.length) {
  console.log(`⚠ ${result.errors.length} errors:`);
  for (const e of result.errors.slice(0, 5)) console.log(`  ${e}`);
  console.log();
}

for (const hit of result.edgeHits) {
  const flag = hit.absEdge >= 0.12 ? "🔥" : "⚡";
  const dir = hit.edge > 0 ? "YES underpriced" : "YES overpriced";
  console.log(`${flag} ${hit.symbol} | edge ${hit.edge > 0 ? "+" : ""}${(hit.edge * 100).toFixed(0)}pt (${dir})`);
  console.log(`  "${hit.question}"`);
  console.log(`  ${hit.direction} @ ${hit.confidence}% | model=${(hit.modelProbability * 100).toFixed(0)}% market=${(hit.marketProbability * 100).toFixed(0)}% | signals ${hit.signalAgreement.toFixed(0)}% net=${hit.netScore.toFixed(0)} | ${hit.regime}`);
  console.log(`  spot $${hit.currentPrice.toLocaleString()} | ends ${hit.endDate ?? "open"}\n`);
}
