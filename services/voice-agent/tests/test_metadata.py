import json

import pytest

from aimauta_voice.metadata import parse_dispatch_metadata, parse_room_metadata


def valid_metadata() -> str:
    return json.dumps(
        {
            "v": 1,
            "app": "aimauta",
            "session_id": "session-12345678",
            "book_id": "fichas-matematica-1-secundaria",
            "page": 13,
            "total_pages": 100,
            "subject": "Matemática",
            "grade": "1.er grado",
            "language": "es-PE",
            "stage": "learn",
            "mode": "socratic",
        }
    )


def valid_dispatch_metadata() -> str:
    return json.dumps(
        {
            "v": 1,
            "app": "aimauta",
            "session_id": "session-12345678",
            "session_token": "x" * 40,
        }
    )


def test_accepts_server_metadata() -> None:
    parsed = parse_room_metadata(valid_metadata(), "aimauta-session-12345678")
    assert parsed.page == 13
    assert parsed.app == "aimauta"


def test_rejects_foreign_room_prefix() -> None:
    with pytest.raises(ValueError, match="Prefijo"):
        parse_room_metadata(valid_metadata(), "voice-session-123")


def test_rejects_page_outside_document() -> None:
    payload = json.loads(valid_metadata())
    payload["page"] = 101
    with pytest.raises(ValueError, match="Metadata"):
        parse_room_metadata(json.dumps(payload), "aimauta-session-12345678")


def test_rejects_room_for_another_session() -> None:
    with pytest.raises(ValueError, match="no corresponde"):
        parse_room_metadata(valid_metadata(), "aimauta-another-session")


def test_accepts_private_dispatch_metadata_for_same_session() -> None:
    parsed = parse_dispatch_metadata(
        valid_dispatch_metadata(),
        "session-12345678",
    )
    assert parsed.session_token == "x" * 40


def test_rejects_private_dispatch_for_another_session() -> None:
    with pytest.raises(ValueError, match="no corresponde"):
        parse_dispatch_metadata(
            valid_dispatch_metadata(),
            "another-session",
        )


def test_rejects_session_token_in_public_room_metadata() -> None:
    payload = json.loads(valid_metadata())
    payload["session_token"] = "x" * 40

    with pytest.raises(ValueError, match="Metadata"):
        parse_room_metadata(
            json.dumps(payload),
            "aimauta-session-12345678",
        )
