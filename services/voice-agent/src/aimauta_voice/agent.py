import asyncio
import json
import logging
from collections.abc import Awaitable, Mapping
from contextlib import suppress

import aiohttp
from livekit import agents, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    ChatContext,
    ChatMessage,
    StopResponse,
    inference,
    room_io,
)
from livekit.plugins import silero

from aimauta_voice.config import get_settings
from aimauta_voice.metadata import parse_dispatch_metadata, parse_room_metadata
from aimauta_voice.tutor_client import TutorClient, TutorServiceError, TutorTurn

logger = logging.getLogger("aimauta.voice")
CONTEXT_TOPIC = "aimauta.context.v1"
SESSION_TOPIC = "aimauta.session.v1"
_ROOM_DISCONNECTED_WHILE_WAITING = (
    "room disconnected while waiting for participant"
)
_SESSION_CLOSING_WHILE_SAYING = (
    "AgentSession is closing, cannot use say()"
)
_SENSITIVE_LOG_FIELDS = frozenset(
    {
        "message_text",
        "text",
        "transcript",
        "user_input",
        "user_transcript",
    }
)


def _start_speech_if_open(
    session: AgentSession,
    text: str,
    *,
    add_to_chat_ctx: bool = True,
    allow_interruptions: bool = True,
) -> Awaitable[None] | None:
    try:
        return session.say(
            text,
            add_to_chat_ctx=add_to_chat_ctx,
            allow_interruptions=allow_interruptions,
        )
    except RuntimeError as error:
        if str(error) != _SESSION_CLOSING_WHILE_SAYING:
            raise
        return None


class SensitiveLogFilter(logging.Filter):
    """Remove transcript-shaped structured fields before a record is emitted."""

    def filter(self, record: logging.LogRecord) -> bool:
        for field in _SENSITIVE_LOG_FIELDS:
            if field in record.__dict__:
                record.__dict__[field] = "[redacted]"

        if isinstance(record.args, Mapping):
            record.args = {
                key: "[redacted]" if key in _SENSITIVE_LOG_FIELDS else value
                for key, value in record.args.items()
            }
        return True


def install_privacy_log_filter() -> None:
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if not any(isinstance(item, SensitiveLogFilter) for item in handler.filters):
            handler.addFilter(SensitiveLogFilter())

    # LiveKit emits raw STT text only at DEBUG today. Keep dependencies above
    # that level as a second layer in case a handler is replaced later.
    logging.getLogger("livekit.agents").setLevel(logging.WARNING)
    logging.getLogger("livekit.agents.inference").setLevel(logging.WARNING)


class AImautaVoiceAgent(Agent):
    def __init__(
        self,
        *,
        room: rtc.Room,
        tutor: TutorClient,
        session_token: str,
        student_identity: str,
    ) -> None:
        super().__init__(
            instructions=(
                "Canal de voz de AImauta. La política y la respuesta se obtienen "
                "exclusivamente del backend pedagógico."
            ),
            llm=None,
        )
        self._room = room
        self._tutor = tutor
        self._session_token = session_token
        self._student_identity = student_identity

    def replace_session_token(self, token: str) -> None:
        if 20 <= len(token) <= 4096:
            self._session_token = token

    async def _publish_session(self, turn: TutorTurn) -> None:
        payload = {
            "v": 1,
            "sessionToken": turn.session_token,
            "session": turn.session,
            "activity": turn.activity,
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            reliable=True,
            destination_identities=[self._student_identity],
            topic=SESSION_TOPIC,
        )

    async def on_user_turn_completed(
        self,
        turn_ctx: ChatContext,
        new_message: ChatMessage,
    ) -> None:
        transcript = (new_message.text_content or "").strip()
        if not transcript:
            raise StopResponse()

        try:
            turn = await self._tutor.turn(
                session_token=self._session_token,
                message=transcript,
            )
            self._session_token = turn.session_token
            await self._publish_session(turn)
            answer = turn.message
        except TutorServiceError as error:
            # TutorServiceError messages contain only a status/category. Avoid
            # traceback chaining here because a JSON decoder can embed response
            # fragments in its exception details.
            logger.warning("Tutor backend failed: %s", error)
            answer = (
                "No pude preparar una pista en este momento. "
                "Puedes continuar escribiendo tu intento."
            )

        turn_ctx.add_message(role="user", content=transcript)
        await self.update_chat_ctx(turn_ctx)
        _start_speech_if_open(
            self.session,
            answer,
            add_to_chat_ctx=True,
            allow_interruptions=True,
        )
        raise StopResponse()


def install_context_listener(
    room: rtc.Room,
    agent: AImautaVoiceAgent,
    *,
    student_identity: str,
) -> None:
    @room.on("data_received")
    def on_data_received(packet: rtc.DataPacket) -> None:
        if packet.topic != CONTEXT_TOPIC or len(packet.data) > 8192:
            return
        participant = packet.participant
        if participant is None or participant.identity != student_identity:
            return
        try:
            payload = json.loads(packet.data.decode("utf-8"))
            if not isinstance(payload, dict):
                return
            if payload.get("v") != 1:
                return
            token = payload.get("sessionToken")
            if isinstance(token, str):
                agent.replace_session_token(token)
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Ignored malformed context packet")


def prewarm(proc: agents.JobProcess) -> None:
    install_privacy_log_filter()
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=0.45,
        activation_threshold=0.55,
        min_speech_duration=0.1,
        prefix_padding_duration=0.35,
    )


async def shutdown_at_deadline(
    ctx: agents.JobContext,
    max_session_seconds: int,
) -> None:
    await asyncio.sleep(max_session_seconds)
    logger.warning(
        "Voice session reached its server-side duration limit",
        extra={"max_session_seconds": max_session_seconds},
    )
    ctx.shutdown("voice session duration limit reached")


def install_session_deadline(
    ctx: agents.JobContext,
    max_session_seconds: int,
) -> asyncio.Task[None]:
    task = asyncio.create_task(
        shutdown_at_deadline(ctx, max_session_seconds),
        name="aimauta-voice-session-deadline",
    )

    async def cancel_deadline(_: str) -> None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    ctx.add_shutdown_callback(cancel_deadline)
    return task


async def entrypoint(ctx: agents.JobContext) -> None:
    if not ctx.room.name.startswith("aimauta-"):
        return

    try:
        await ctx.connect()
        room_metadata = parse_room_metadata(ctx.room.metadata, ctx.room.name)
        dispatch_metadata = parse_dispatch_metadata(
            ctx.job.metadata,
            room_metadata.session_id,
        )
        settings = get_settings()
        install_session_deadline(ctx, settings.max_session_seconds)

        student_identity = f"student-{room_metadata.session_id}"
        await ctx.wait_for_participant(identity=student_identity)
    except asyncio.CancelledError:
        return
    except RuntimeError as error:
        if str(error) != _ROOM_DISCONNECTED_WHILE_WAITING:
            raise
        return

    http = aiohttp.ClientSession()

    async def close_http(_: str) -> None:
        if not http.closed:
            await http.close()

    ctx.add_shutdown_callback(close_http)

    try:
        tutor = TutorClient(
            http,
            endpoint=settings.turn_endpoint,
            secret=settings.aimauta_agent_secret,
            timeout_seconds=settings.request_timeout_seconds,
        )
        agent = AImautaVoiceAgent(
            room=ctx.room,
            tutor=tutor,
            session_token=dispatch_metadata.session_token,
            student_identity=student_identity,
        )
        install_context_listener(
            ctx.room,
            agent,
            student_identity=student_identity,
        )

        session = AgentSession(
            vad=ctx.proc.userdata.get("vad") if ctx.proc else silero.VAD.load(),
            stt=inference.STT(
                model=settings.stt_model,
                language=settings.stt_language,
                api_key=settings.livekit_api_key,
                api_secret=settings.livekit_api_secret,
                extra_kwargs={
                    "interim_results": True,
                    "smart_format": True,
                    "punctuate": True,
                    "profanity_filter": True,
                    "endpointing": 350,
                    "mip_opt_out": True,
                },
            ),
            llm=None,
            tts=inference.TTS(
                model=settings.tts_model,
                voice=settings.tts_voice,
                language=settings.tts_language,
                api_key=settings.livekit_api_key,
                api_secret=settings.livekit_api_secret,
            ),
            turn_detection="stt",
            allow_interruptions=True,
            min_endpointing_delay=0.4,
            max_endpointing_delay=2.2,
        )
        await session.start(
            room=ctx.room,
            agent=agent,
            record=False,
            room_options=room_io.RoomOptions(
                participant_identity=student_identity,
                text_input=False,
                text_output=False,
                video_input=False,
                delete_room_on_close=True,
            ),
        )
        greeting = _start_speech_if_open(
            session,
            "Te escucho. Cuéntame qué intentaste y avanzaremos con una pregunta.",
            allow_interruptions=True,
        )
        if greeting is None:
            await http.close()
            return
        await greeting
    except BaseException as error:
        if not http.closed:
            await http.close()
        if isinstance(error, asyncio.CancelledError):
            return
        raise


def main() -> None:
    settings = get_settings()
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="aimauta-socratic-tutor",
            ws_url=settings.livekit_url,
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
            host="127.0.0.1",
            log_level="WARN",
        )
    )


if __name__ == "__main__":
    main()
