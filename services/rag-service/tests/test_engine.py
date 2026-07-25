from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.config import Settings
from app.engine import IndexRepository, IndexUnavailableError, LineageMismatchError

BOOK_ID = "fichas-matematica-1-secundaria"
SHA256 = "c" * 64
SECRET = "test-rag-secret-with-at-least-32-characters"
EXERCISE_ID = "ejercicio-fracciones"
REVISION = 2
ANCHOR = "Compara las cantidades y explica qué dato observas primero."
ANCHOR_DIGEST = hashlib.sha256(ANCHOR.encode("utf-8")).hexdigest()
REGIONS = ("ejercicio-fracciones-contexto", "ejercicio-fracciones-pregunta")


def index_document() -> dict:
    chunks = [
        {
            "id": "visible-current",
            "page": 13,
            "text": ANCHOR,
            "kind": "exercise",
            "teacherOnly": False,
            "stage": "learn",
            "unitId": "ficha-1-fracciones",
        },
        {
            "id": "same-page-other-exercise",
            "page": 13,
            "text": "Clasifica los triángulos según sus ángulos y lados.",
            "kind": "exercise",
            "teacherOnly": False,
            "stage": "learn",
            "unitId": "ficha-1-fracciones",
        },
        {
            "id": "teacher-current",
            "page": 13,
            "text": f"{ANCHOR} Respuesta reservada para docentes.",
            "kind": "instruction",
            "teacherOnly": True,
            "stage": "learn",
            "unitId": "ficha-1-fracciones",
        },
        {
            "id": "assessment-neighbour",
            "page": 21,
            "text": f"{ANCHOR} Clave de la evaluación.",
            "kind": "exercise",
            "teacherOnly": False,
            "stage": "assessment",
            "unitId": "ficha-1-fracciones",
        },
        {
            "id": "other-unit",
            "page": 23,
            "text": f"{ANCHOR} Contenido de otra ficha.",
            "kind": "content",
            "teacherOnly": False,
            "stage": "learn",
            "unitId": "ficha-2-proporcionalidad",
        },
    ]
    covered = {chunk["page"] for chunk in chunks}
    return {
        "version": 2,
        "extractorVersion": "aimauta-pdf-parse-2.4.5-chunker-2",
        "generatedAt": "2026-07-25T00:05:00.000Z",
        "bookId": BOOK_ID,
        "sourceSha256": SHA256,
        "pageCount": 100,
        "taxonomy": {
            "levelId": "secundaria",
            "gradeNumber": 1,
            "courseId": "matematica",
            "materialType": "student-workbook",
            "language": "es-PE",
        },
        "curriculum": {"version": "2024.1"},
        "quality": {
            "missing": [page for page in range(1, 101) if page not in covered],
            "outliers": [],
            "teacherOnly": {"chunkCount": 1, "pages": [13]},
        },
        "license": {
            "name": "Creative Commons Atribución 4.0",
            "url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "Ministerio de Educación del Perú",
        },
        "chunks": chunks,
    }


class IndexRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.index_dir = Path(self.temp.name)
        self.path = self.index_dir / f"{BOOK_ID}.json"
        self.path.write_text(json.dumps(index_document()), encoding="utf-8")
        self.repository = IndexRepository(
            Settings(index_dir=self.index_dir.resolve(), service_secret=SECRET)
        )

    def tearDown(self):
        self.temp.cleanup()

    def retrieve(self, **overrides):
        request = {
            "book_id": BOOK_ID,
            "source_sha256": SHA256,
            "curriculum_version": "2024.1",
            "exercise_id": EXERCISE_ID,
            "exercise_revision": REVISION,
            "required_anchor": ANCHOR,
            "required_anchor_digest": ANCHOR_DIGEST,
            "region_ids": REGIONS,
            "page": 13,
            "allowed_pages": (13,),
            "unit_id": "ficha-1-fracciones",
            "stage": "learn",
            "query": "¿Cómo comparo las cantidades?",
            "top_k": 3,
        }
        request.update(overrides)
        return self.repository.retrieve(**request)

    def test_returns_only_exact_lexical_anchor_inside_scope(self):
        result = self.retrieve()
        self.assertEqual(
            [source.identifier for source in result.sources],
            ["visible-current"],
        )
        self.assertEqual(result.exercise_id, EXERCISE_ID)
        self.assertEqual(result.exercise_revision, REVISION)
        self.assertEqual(result.required_anchor_digest, ANCHOR_DIGEST)
        self.assertEqual(result.region_ids, REGIONS)

    def test_returns_zero_for_an_unrelated_anchor_on_the_same_page(self):
        unrelated = "Determina perímetros de polígonos usando medidas exactas."
        result = self.retrieve(
            required_anchor=unrelated,
            required_anchor_digest=hashlib.sha256(
                unrelated.encode("utf-8")
            ).hexdigest(),
        )
        self.assertEqual(result.sources, ())

    def test_rejects_a_mismatched_anchor_digest(self):
        with self.assertRaises(LineageMismatchError):
            self.retrieve(required_anchor_digest="d" * 64)

    def test_rejects_stale_index_lineage(self):
        with self.assertRaises(LineageMismatchError):
            self.retrieve(source_sha256="d" * 64)

    def test_rejects_an_incompatible_extractor(self):
        document = index_document()
        document["extractorVersion"] = "unknown-extractor"
        self.path.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaises(IndexUnavailableError):
            self.repository.load(BOOK_ID)

    def test_rejects_an_incomplete_index_contract(self):
        document = index_document()
        document.pop("quality")
        self.path.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaises(IndexUnavailableError):
            self.repository.load(BOOK_ID)

    def test_rejects_path_traversal(self):
        with self.assertRaises(IndexUnavailableError):
            self.repository.load("../secret")

    def test_reloads_an_index_after_an_atomic_content_change(self):
        first = self.retrieve()
        self.assertEqual(first.sources[0].identifier, "visible-current")
        document = index_document()
        document["chunks"][0]["id"] = "visible-updated"
        replacement = self.path.with_suffix(".next")
        replacement.write_text(json.dumps(document), encoding="utf-8")
        replacement.replace(self.path)
        second = self.retrieve()
        self.assertEqual(second.sources[0].identifier, "visible-updated")


if __name__ == "__main__":
    unittest.main()
