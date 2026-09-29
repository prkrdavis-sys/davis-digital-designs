#!/usr/bin/env node
/**
 * RCSB Protein Data Bank structures (CC0).
 *   node art/fetch/pdb.mjs 1KX5 [format=cif|pdb]
 */
import { cachePath, download, log } from "./lib.mjs";

export async function fetchStructure(code, format = "cif") {
  const id = code.toUpperCase();
  const dest = cachePath("pdb", `${id}.${format}`);
  await download(`https://files.rcsb.org/download/${id}.${format}`, dest);
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [code, format] = process.argv.slice(2);
  fetchStructure(code, format ?? "cif")
    .then((p) => {
      log("pdb", code);
      console.log(p);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
