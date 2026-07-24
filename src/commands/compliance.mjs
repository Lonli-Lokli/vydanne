import PDFDocument from "pdfkit";
import fs from "node:fs";
import { green, yellow } from "../util.mjs";

// Generate the US encryption self-classification report PDF (ECCN 5D002, License Exception ENC 740.17(b)(1))
// for standard-crypto apps — the document for the ASC "App Encryption Documentation" US slot. France = a
// separate ANSSI territory upload; US needs no CCATS. Native pdfkit (no python).
export async function run(config) {
  const e = config.export || {};
  if ((e.encryption || "standard") !== "standard") { console.log(yellow("export.encryption != standard — nothing to self-classify")); return true; }
  const appName = e.appName || config.bundleId.split(".").pop();
  const out = `export-compliance/${config.bundleId}-US-encryption-self-classification.pdf`;
  fs.mkdirSync("export-compliance", { recursive: true });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const stream = fs.createWriteStream(out);
    doc.pipe(stream);
    const kv = (k, v) => { doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0b0b0a").text(k, { continued: true }); doc.font("Helvetica").fillColor("#1e1e1e").text("  " + v); };
    const h = (t) => { doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor("#0b0b0a").text(t); doc.moveDown(0.2); };
    const p = (t) => { doc.font("Helvetica").fontSize(10.5).fillColor("#1e1e1e").text(t); };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0b0b0a").text("Encryption Export Self-Classification Report");
    doc.moveTo(56, doc.y + 4).lineTo(539, doc.y + 4).strokeColor("#c8c8c8").stroke();
    doc.moveDown();
    kv("Product:", appName); kv("Bundle ID:", config.bundleId); kv("Version:", String(e.version || "1.0")); kv("Developer (Apple Team ID):", String(e.teamId || "-"));
    h("Classification");
    kv("ECCN:", "5D002 (encryption 'software')"); kv("Authorization:", "License Exception ENC, EAR 740.17(b)(1)"); kv("Basis:", "Mass-market, self-classified (Note 3 to Cat. 5 Part 2)");
    h("Cryptography inventory");
    p("The application uses only standard, published cryptographic algorithms (NIST / IETF). No proprietary or non-standard cryptography is implemented. On Apple platforms the primitives resolve to Apple CryptoKit.");
    doc.moveDown(0.4);
    for (const [purpose, alg, ks] of [["Content & media confidentiality", "AES-GCM (AEAD)", "256-bit"], ["Key derivation / addressing", "HMAC-SHA256", "256-bit"], ["Token signing", "Ed25519", "255-bit curve"], ["Transport", "TLS 1.2 / 1.3", "standard"]]) {
      doc.font("Helvetica").fontSize(10.5).fillColor("#1e1e1e").text(`•  ${purpose} — ${alg} (${ks})`);
    }
    h("Statement");
    p("The product provides general data-confidentiality end-to-end encryption of the user's own data for optional cross-device sync. It is a mass-market consumer application distributed through public app stores, uses only standard published algorithms, and qualifies for export under License Exception ENC, EAR 740.17(b)(1), ECCN 5D002. A self-classification report has been submitted to BIS (crypt-supp8@bis.doc.gov) and the NSA (enc@nsa.gov).");
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(green(`wrote ${out}`));
  if (e.france) console.log(yellow("France: file + upload the ANSSI declaration too (territory rule). US: email BIS+NSA, no CCATS."));
  return true;
}
