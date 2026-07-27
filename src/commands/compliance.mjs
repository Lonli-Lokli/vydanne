import PDFDocument from "pdfkit";
import fs from "node:fs";
import { green, yellow, red } from "../util.mjs";

/**
 * The US encryption self-classification report PDF (ECCN 5D002, License Exception ENC 740.17(b)(1)) —
 * the document for the ASC "App Encryption Documentation" US slot. France is a separate ANSSI territory
 * upload; the US needs no CCATS. Native pdfkit, no Python.
 *
 * THIS COMMAND MAKES LEGAL ASSERTIONS, SO IT DOES NOT GUESS. It used to hold a hardcoded cryptography
 * inventory — AES-GCM, HMAC-SHA256, Ed25519, "resolves to Apple CryptoKit" — and a statement claiming
 * the product did end-to-end encryption for cross-device sync and that "a self-classification report
 * has been submitted to BIS and the NSA". Every app the tool was pointed at got the same page. That is
 * wrong twice over: it describes cryptography an app may not contain, and it asserts a filing with two
 * US government agencies that whoever ran the command may never have made. A wrong screenshot costs a
 * review cycle; this is a document someone signs their company's name under.
 *
 * So the app declares its own inventory and its own statement, exactly the way `accessibility` declares
 * its own claims, and for the same reason: silence is not consent. `export.filed` is separate and
 * defaults to false, because "we intend to file" and "we have filed" are different sentences and only
 * the filer knows which is true.
 */

const EXAMPLE = `  export: {
    encryption: "standard",          // "standard" | "none" | "exempt"
    appName: "Your App",
    version: "1.2",
    teamId: "ABCDE12345",
    // What the app actually contains. Every row is [purpose, algorithm, key size].
    algorithms: [
      ["Transport", "TLS 1.2 / 1.3", "standard"],
    ],
    // One paragraph in your own words, describing what the app does with cryptography.
    statement: "The product uses TLS for network transport only. It is a mass-market consumer " +
      "application distributed through public app stores, uses only standard published algorithms, " +
      "and qualifies for export under License Exception ENC, EAR 740.17(b)(1), ECCN 5D002.",
    // Only true once the report has ACTUALLY been emailed to BIS and the NSA.
    filed: false,
  },`;

/** Returns a human-readable problem, or null when the declaration is usable. */
export function validate(config) {
  const e = config.export || {};
  if ((e.encryption || "standard") !== "standard") return null; // nothing to self-classify
  const missing = [];
  if (!Array.isArray(e.algorithms) || !e.algorithms.length) missing.push("algorithms");
  if (typeof e.statement !== "string" || !e.statement.trim()) missing.push("statement");
  if (!missing.length) return null;
  return [
    `compliance: export.${missing.join(" and export.")} missing.`,
    "This command generates a US export-compliance document that makes factual claims about your",
    "app's cryptography. It will not supply them for you — the previous default described a specific",
    "app's crypto and asserted a BIS/NSA filing, for every app it was run against.",
    "",
    "Declare what your app actually contains:",
    "",
    EXAMPLE,
  ].join("\n");
}

export async function run(config) {
  const e = config.export || {};
  if ((e.encryption || "standard") !== "standard") { console.log(yellow(`export.encryption = ${e.encryption} — nothing to self-classify`)); return true; }

  const problem = validate(config);
  if (problem) { console.error(red(problem)); return false; }

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
    p("The application uses only standard, published cryptographic algorithms (NIST / IETF). No proprietary or non-standard cryptography is implemented.");
    doc.moveDown(0.4);
    for (const row of e.algorithms) {
      const [purpose, alg, ks] = row;
      doc.font("Helvetica").fontSize(10.5).fillColor("#1e1e1e").text(`•  ${purpose} — ${alg}${ks ? ` (${ks})` : ""}`);
    }
    h("Statement");
    // The declared statement, and NOTHING appended to it. The filing sentence is added only when the
    // app says the filing happened, because a PDF that claims it has been submitted is the one thing
    // here that cannot be walked back.
    p(e.statement.trim());
    if (e.filed) {
      doc.moveDown(0.4);
      p("A self-classification report has been submitted to BIS (crypt-supp8@bis.doc.gov) and the NSA (enc@nsa.gov).");
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(green(`wrote ${out}`));
  if (!e.filed) {
    console.log(yellow("  export.filed is false — the PDF does NOT claim the report was submitted."));
    console.log("  Email it to crypt-supp8@bis.doc.gov and enc@nsa.gov, then set export.filed: true.");
  }
  if (e.france) console.log(yellow("France: file + upload the ANSSI declaration too (territory rule). US: email BIS+NSA, no CCATS."));
  return true;
}
