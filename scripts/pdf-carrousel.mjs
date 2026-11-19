/* Assemble des slides JPEG en un PDF de carrousel LinkedIn, sans dépendance npm.
   Pourquoi sans dépendance : le dépôt portfolio n'a pas de package.json, l'Action tourne
   en Node nu, et un PDF n'a besoin que de trois choses — un catalogue, des pages, et les
   octets JPEG tels quels (`/DCTDecode`). Rien à installer, rien à compiler.

   Une page = une slide, 1080×1350 par défaut. La première page sert de couverture : c'est
   elle que LinkedIn affiche comme vignette.

   Usage :
     node scripts/pdf-carrousel.mjs --dossier sorties/slides --sortie sorties/x.pdf
     node scripts/pdf-carrousel.mjs a.jpg b.jpg --sortie sorties/x.pdf */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const LARGEUR = 1080;
const HAUTEUR = 1350;

/* Dimensions et nombre de composantes lues dans les marqueurs SOF du JPEG.
   On ne décode pas l'image : on lit juste sa tête, ce qui suffit à écrire /Width /Height. */
export function enteteJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("ce fichier n'est pas un JPEG (pas de SOI)");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marque = buf[i + 1];
    /* SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 : tous portent les dimensions.
       On exclut C4 (DHT), C8 (JPG) et CC (DAC), qui partagent la plage. */
    const estSof = marque >= 0xc0 && marque <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marque);
    if (estSof) {
      const hauteur = buf.readUInt16BE(i + 5);
      const largeur = buf.readUInt16BE(i + 7);
      const composantes = buf[i + 9];
      return { largeur, hauteur, composantes };
    }
    const longueur = buf.readUInt16BE(i + 2);
    if (!longueur) break;
    i += 2 + longueur;
  }
  throw new Error("dimensions JPEG introuvables");
}

const espaceCouleur = (n) => (n === 1 ? "/DeviceGray" : n === 4 ? "/DeviceCMYK" : "/DeviceRGB");

export function assemblerPdf(images, options = {}) {
  const largeurPage = options.largeur || LARGEUR;
  const hauteurPage = options.hauteur || HAUTEUR;
  if (!images.length) throw new Error("aucune image à assembler");

  const morceaux = [];
  let position = 0;
  const push = (b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1");
    morceaux.push(buf);
    position += buf.length;
    return position;
  };
  const decalages = [];   // decalages[n] = position de l'objet n
  const objet = (n, corps, flux) => {
    decalages[n] = position;
    push(`${n} 0 obj\n${corps}\n`);
    if (flux) {
      push("stream\n");
      push(flux);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const nb = images.length;
  const refPage = (i) => 3 + i * 3;
  const refContenu = (i) => 4 + i * 3;
  const refImage = (i) => 5 + i * 3;

  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${refPage(i)} 0 R`).join(" ")}] /Count ${nb} >>`);

  images.forEach((img, i) => {
    const { largeur, hauteur, composantes } = enteteJpeg(img);
    const contenu = Buffer.from(
      `q\n${largeurPage} 0 0 ${hauteurPage} 0 0 cm\n/Im0 Do\nQ\n`,
      "latin1",
    );
    objet(refPage(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largeurPage} ${hauteurPage}] `
      + `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${refImage(i)} 0 R >> >> `
      + `/Contents ${refContenu(i)} 0 R >>`);
    objet(refContenu(i), `<< /Length ${contenu.length} >>`, contenu);
    objet(refImage(i),
      `<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} `
      + `/ColorSpace ${espaceCouleur(composantes)} /BitsPerComponent 8 /Filter /DCTDecode `
      + `/Length ${img.length} >>`, img);
  });

  const taille = 6 + (nb - 1) * 3;
  const debutXref = position;
  let xref = `xref\n0 ${taille}\n0000000000 65535 f \n`;
  for (let n = 1; n < taille; n++) {
    xref += `${String(decalages[n]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${taille} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`);

  return Buffer.concat(morceaux);
}

/* --- CLI ---------------------------------------------------------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (nom, defaut) => {
    const i = args.indexOf(`--${nom}`);
    return i >= 0 ? args[i + 1] : defaut;
  };
  const dossier = option("dossier");
  const sortie = option("sortie", "sorties/carrousel.pdf");

  const fichiers = dossier
    ? readdirSync(dossier)
        .filter((f) => [".jpg", ".jpeg"].includes(extname(f).toLowerCase()))
        .sort()
        .map((f) => join(dossier, f))
    : args.filter((a) => [".jpg", ".jpeg"].includes(extname(a).toLowerCase()));

  if (!fichiers.length) {
    console.error("aucun JPEG : passe --dossier <dir> ou des chemins de fichiers");
    process.exit(1);
  }
  const pdf = assemblerPdf(fichiers.map((f) => readFileSync(f)));
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, pdf);
  console.log(`${fichiers.length} page(s) → ${sortie} (${(pdf.length / 1024).toFixed(0)} Ko)`);
}
