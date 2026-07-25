from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.config import Settings
from app.engine import IndexRepository, IndexUnavailableError, LineageMismatchError

BOOK_ID = "fichas-matematica-1-secundaria"
SHA256 = "c" * 64


def index_document() -> dict:
    return {
        "version": 2,
        "extractorVersion": "aimauta-pdf-parse-2.4.5-chunker-2",
        "bookId": BOOK_ID,
        "sourceSha256": SHA256,
        "pageCount": 100,
        "curriculum": {"version": "2024.1"},
        "chunks": [
            {
                "id": "visible-current",
                "page": 13,
                "text": "Compara las cantidades y explica qué dato observas primero.",
                "kind": "exercise",
                "teacherOnly": False,
                "stage": "learn",
                "unitId": "ficha-1-fracciones",
            },
            {
                "id": "teacher-current",
                "page": 13,
                "text": "Respuesta reservada para docentes.",
                "kind": "instruction",
                "teacherOnly": True,
                "stage": "learn",
                "unitId": "ficha-1-fracciones",
            },
            {
                "id": "assessment-neighbour",
                "page": 21,
                "text": "Clave de la evaluación.",
                "kind": "exercise",
                "teacherOnly": False,
                "stage": "assessment",
                "unitId": "ficha-1-fracciones",
            },
            {
                "id": "other-unit",
                "page": 23,
                "text": "Contenido de otra ficha.",
                "kind": "content",
                "teacherOnly": False,
                "stage": "learn",
                "unitId": "ficha-2-proporcionalidad",
            },
        ],
    }


class IndexRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.index_dir = Path(self.temp.name)
        self.path = self.index_dir / f"{BOOK_ID}.json"
        self.path.write_text(json.dumps(index_document()), encoding="utf-8")
        self.repository = IndexRepository(Settings(index_dir=self.index_dir))

    def tearDown(self):
        self.temp.cleanup()

    def retrieve(self):
        return self.repository.retrieve(
            book_id=BOOK_ID,
            source_sha256=SHA256,
            curriculum_version="2024.1",
            page=13,
            allowed_pages=(13,),
            unit_id="ficha-1-fracciones",
            stage="learn",
            query="¿Cómo comparo las cantidades?",
            top_k=3,
        )

    def test_returns_only_visible_content_inside_exact_scope(self):
        result = self.retrieve()
        self.assertEqual([source.identifier for source in result.sources], ["visible-current"])
        self.assertNotIn("Respuesta reservada", result.sources[0].text)

    def test_rejects_stale_lineage(self):
        with self.assertRaises(LineageMismatchError):
            self.repository.retrieve(
                book_id=BOOK_ID,
                source_sha256="d" * 64,
                curriculum_version="2024.1",
                page=13,
                allowed_pages=(13,),
                unit_id="ficha-1-fracciones",
                stage="learn",
                query="",
                top_k=3,
            )

    def test_rejects_an_incompatible_extractor(self):
        document = index_document()
        document["extractorVersion"] = "unknown-extractor"
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
