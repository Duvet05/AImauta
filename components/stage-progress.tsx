import type { PageActivity } from "@/lib/curriculum";
import type { LearningSessionState } from "@/lib/learning-session";

type StageProgressProps = {
  activity: PageActivity;
  session: LearningSessionState;
  supportAvailable: boolean;
};

const stages = [
  {
    id: "learn",
    label: "Construimos",
    description: "Comprendemos la idea",
  },
  {
    id: "practice",
    label: "Comprobamos",
    description: "Probamos una estrategia",
  },
  {
    id: "assessment",
    label: "Evaluamos",
    description: "Lo resuelves por tu cuenta",
  },
] as const;

export function StageProgress({
  activity,
  session,
  supportAvailable,
}: StageProgressProps) {
  const currentIndex = stages.findIndex((stage) => stage.id === activity.stage);
  const stagePages = Math.max(1, activity.endPage - activity.startPage + 1);
  const stagePage = Math.min(
    stagePages,
    Math.max(1, session.page - activity.startPage + 1),
  );

  return (
    <section className="stage-progress" aria-labelledby="learning-route-title">
      <div className="stage-progress-heading">
        <div>
          <p>Ruta de la ficha</p>
          <h2 id="learning-route-title">{activity.stageLabel}</h2>
        </div>
        <span>
          Página {stagePage} de {stagePages} en esta etapa
        </span>
      </div>

      <ol className="stage-stepper" aria-label="Etapas de aprendizaje">
        {stages.map((stage, index) => {
          const isCurrent = index === currentIndex;
          const isComplete = currentIndex >= 0 && index < currentIndex;

          return (
            <li
              className={[
                isCurrent ? "stage-current" : "",
                isComplete ? "stage-complete" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={stage.id}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="stage-marker" aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span className="stage-copy">
                <strong>{stage.label}</strong>
                <small>{stage.description}</small>
              </span>
            </li>
          );
        })}
      </ol>

      <progress
        className="stage-page-progress"
        max={stagePages}
        value={stagePage}
        aria-label={`Avance en ${activity.stageLabel}: página ${stagePage} de ${stagePages}`}
      />

      <dl className="learning-metrics">
        <div>
          <dt>Nivel de apoyo</dt>
          <dd>
            {activity.tutorAvailable && supportAvailable
              ? `${session.hintLevel} de 3`
              : "En pausa"}
          </dd>
        </div>
        <div>
          <dt>Intentos registrados</dt>
          <dd>{session.attemptCount}</dd>
        </div>
        <div>
          <dt>Turnos de reflexión</dt>
          <dd>{session.turnCount}</dd>
        </div>
      </dl>

      {!activity.tutorAvailable ? (
        <div className="assessment-lock" role="note">
          <LockIcon />
          <div>
            {activity.stage === "assessment" ? (
              <>
                <strong>Ahora demuestras lo aprendido</strong>
                <p>
                  En Evaluamos, la ayuda se pausa. Tu espacio de respuesta sigue
                  disponible.
                </p>
              </>
            ) : (
              <>
                <strong>Primero ubica una ficha de trabajo</strong>
                <p>
                  Esta sección explica cómo usar el libro. Las pistas están
                  disponibles en Construimos y Comprobamos.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6V10Z" />
      <path d="M12 14v2" />
    </svg>
  );
}
