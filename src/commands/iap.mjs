import sharp from "sharp";
import { green, yellow, red } from "../util.mjs";

// Validate IAP fields (Display Name <=30, Description <=45) + remind of the two image slots. Optional:
// VYDANNE_FLATTEN=<png> flattens a screenshot to RGB (sim captures are RGBA → ASC rejects them).
export async function run(config) {
  if (process.env.VYDANNE_FLATTEN) return flatten(process.env.VYDANNE_FLATTEN);
  const iaps = config.iaps || [];
  if (!iaps.length) { console.log(yellow("no iaps in config")); return true; }
  let ok = true;
  for (const i of iaps) {
    const dn = (i.displayName || "").length, de = (i.description || "").length;
    const bad = [];
    if (dn > 30) bad.push(`display_name ${dn}>30`);
    if (de > 45) bad.push(`description ${de}>45`);
    if (bad.length) ok = false;
    console.log(`IAP ${i.productId} (${i.type}) ${i.price}`);
    console.log(`  Display Name (<=30): ${dn}  ${bad.length ? red(bad.join(", ")) : green("ok")}`);
    console.log(`  Description  (<=45): ${de}`);
    console.log(`  Review note: ${(i.reviewNote || "").slice(0, 120)}`);
  }
  console.log(yellow("Two image slots: Review Screenshot (tall, required, RGB) + Promotional Image (1024x1024, optional — from zdymak)."));
  return ok;
}

async function flatten(input) {
  const out = input.replace(/(\.\w+)?$/, "-iap.png");
  await sharp(input).flatten({ background: "#ffffff" }).removeAlpha().png().toFile(out);
  console.log(green(`flattened -> ${out} (RGB, no alpha)`));
  return true;
}
