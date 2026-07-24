from dataclasses import dataclass
from json import JSONDecodeError
from typing import Any

import aiohttp


class TutorServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class TutorTurn:
    message: str
    session_token: str
    session: dict[str, Any]
    activity: dict[str, Any]


class TutorClient:
    def __init__(
        self,
        http: aiohttp.ClientSession,
        endpoint: str,
        secret: str,
        timeout_seconds: float,
    ) -> None:
        self._http = http
        self._endpoint = endpoint
        self._secret = secret
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    async def turn(
        self,
        *,
        session_token: str,
        message: str,
    ) -> TutorTurn:
        try:
            async with self._http.post(
                self._endpoint,
                headers={"Authorization": f"Bearer {self._secret}"},
                json={
                    "sessionToken": session_token,
                    "message": message,
                    # A spoken turn can be a question, request or reflection. Do
                    # not count every transcript as a submitted exercise attempt.
                    "attempt": "",
                },
                timeout=self._timeout,
            ) as response:
                if response.status != 200:
                    raise TutorServiceError(
                        f"AImauta backend respondió HTTP {response.status}"
                    )
                payload = await response.json()
        except TutorServiceError:
            raise
        except (
            aiohttp.ClientError,
            TimeoutError,
            RuntimeError,
            JSONDecodeError,
        ) as error:
            raise TutorServiceError("AImauta backend no está disponible") from error

        if not isinstance(payload, dict):
            raise TutorServiceError("Respuesta inválida de AImauta backend")

        tutor_message = payload.get("message")
        next_token = payload.get("sessionToken")
        session = payload.get("session")
        activity = payload.get("activity")
        if (
            not isinstance(tutor_message, str)
            or not tutor_message.strip()
            or not isinstance(next_token, str)
            or not isinstance(session, dict)
            or not isinstance(activity, dict)
        ):
            raise TutorServiceError("Respuesta incompleta de AImauta backend")

        return TutorTurn(
            message=tutor_message.strip(),
            session_token=next_token,
            session=session,
            activity=activity,
        )
