export type Book = {
  id: string;
  title: string;
  subject: string;
  grade: string;
  level: "Primaria" | "Secundaria";
  description: string;
  pages: number;
  sourceLabel: string;
  sourcePageUrl: string;
  sourcePdfUrl: string;
  discoveredViaUrl: string;
  storageFile: string;
  expectedBytes?: number;
  expectedSha256?: string;
  edition: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  provenance: "official-minedu";
};

const books: readonly Book[] = [
  {
    id: "fichas-matematica-1-secundaria",
    title: "Fichas de Matemática 1",
    subject: "Matemática",
    grade: "1.er grado",
    level: "Secundaria",
    description:
      "Situaciones de la vida cotidiana para construir, comprobar y evaluar aprendizajes matemáticos.",
    pages: 100,
    sourceLabel: "Repositorio Institucional del MINEDU",
    sourcePageUrl:
      "https://repositorio.minedu.gob.pe/handle/20.500.12799/10834",
    sourcePdfUrl:
      "https://repositorio.minedu.gob.pe/bitstream/handle/20.500.12799/10834/Fichas%20de%20Matem%C3%A1tica%201.pdf?isAllowed=y&sequence=1",
    discoveredViaUrl:
      "https://librosescolaresperu.com/1-secundaria/fichas-de-matematica/",
    storageFile: "fichas-matematica-1-secundaria.pdf",
    expectedBytes: 32_895_443,
    expectedSha256:
      "c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0",
    edition: "Primera reimpresión, setiembre de 2024",
    licenseName: "Creative Commons Atribución 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution:
      "Ministerio de Educación del Perú; Larisa Mansilla Fernández; Olber Muñoz Solís; Juan Carlos Chávez Espino; Hugo Luis Támara Salazar; Hubner Luque Cristóbal Jave; Enrique García Manyari; Emilia Gabriela Del Busto Sipán",
    provenance: "official-minedu"
  }
];

export function getBooks(): readonly Book[] {
  return books;
}

export function getBook(id: string): Book | undefined {
  return books.find((book) => book.id === id);
}

export function isAllowedOfficialSource(source: URL): boolean {
  return (
    source.protocol === "https:" &&
    ((source.hostname === "repositorios.perueduca.pe" &&
      source.pathname.startsWith("/pe-recursos/")) ||
      (source.hostname === "repositorio.minedu.gob.pe" &&
        source.pathname.startsWith("/bitstream/handle/")))
  );
}
