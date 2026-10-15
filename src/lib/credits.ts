/**
 * Attribution for third-party data and assets used by the 3D worlds.
 * The art pipeline (art/) pulls from these sources; add an entry whenever a
 * build script fetches something new. Rendered in the footer's Credits list.
 */
export interface Credit {
  source: string;
  what: string;
  license: string;
  href: string;
  /** Exact attribution text where the license asks for specific wording. */
  notice?: string;
}

export const CREDITS: Credit[] = [
  {
    source: "Copernicus DEM GLO-30",
    what: "Everest terrain elevation",
    license: "Copernicus DEM licence",
    href: "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
    notice: "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved.",
  },
  {
    source: "Copernicus Sentinel-2",
    what: "Everest satellite color reference",
    license: "Copernicus data policy",
    href: "https://registry.opendata.aws/sentinel-2-l2a-cogs/",
    notice: "Contains modified Copernicus Sentinel data.",
  },
  {
    source: "OpenStreetMap",
    what: "Everest Base Camp trek trail geometry",
    license: "ODbL",
    href: "https://www.openstreetmap.org/copyright",
    notice: "© OpenStreetMap contributors.",
  },
  {
    source: "RCSB Protein Data Bank",
    what: "Nucleosome and enzyme structures in the DNA world",
    license: "CC0",
    href: "https://www.rcsb.org/",
  },
  {
    source: "Poly Haven",
    what: "HDRIs, textures, and plant models",
    license: "CC0",
    href: "https://polyhaven.com/",
  },
  {
    source: "ambientCG",
    what: "PBR materials (marble, sand, metal, wood)",
    license: "CC0",
    href: "https://ambientcg.com/",
  },
];
