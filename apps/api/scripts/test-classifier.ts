import { classifyCryptoPriceQuestion } from "../src/services/ta-engine.js";

// Real Polymarket question formats
const tests = [
  "Bitcoin above 63,600 on June 8, 6AM ET?",                // hourly market — comma, no $
  "Will the price of Bitcoin be above $72,000 on June 9?",  // $ + comma
  "Will Bitcoin hit $1m before GTA VI?",                    // $ + m suffix
  "Ethereum above 2,400 on June 10?",                       // comma, no $
  "Will Solana reach 200 by July?",                         // bare number, no $
  "Bitcoin Up or Down on June 8?",                          // directional
  "Will Bitcoin dip below 58,000 in June?",                 // comma, below
  "Will Ethereum hit $5,000 in 2026?",                      // $ + comma + year present
];

for (const q of tests) {
  const r = classifyCryptoPriceQuestion(q);
  console.log(
    JSON.stringify({
      q: q.slice(0, 50),
      isPrice: r.isPriceQuestion,
      target: r.target,
      comp: r.comparator,
      yesUp: r.yesMeansUp,
    })
  );
}
