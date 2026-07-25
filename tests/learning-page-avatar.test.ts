import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/components/learning-workspace", () => ({
  LearningWorkspace: () => null,
}));

import LearningPage from "@/app/aprender/[bookId]/page";

type WorkspaceProps = {
  avatarPreviewEnabled: boolean;
  voiceTutorEnabled: boolean;
};

type PageProps = {
  "data-avatar-preview": "enabled" | "disabled";
  children: ReactElement<WorkspaceProps>;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("página de aprendizaje con avatar", () => {
  it("habilita avatar y voz mediante flags sin exigir un query de preview", async () => {
    vi.stubEnv("AIMAUTA_AVATAR_ENABLED", "true");
    vi.stubEnv("AIMAUTA_VOICE_TUTOR_ENABLED", "true");

    const page = (await LearningPage({
      params: Promise.resolve({
        bookId: "fichas-matematica-1-secundaria",
      }),
    })) as ReactElement<PageProps>;

    expect(page.props["data-avatar-preview"]).toBe("enabled");
    expect(page.props.children.props.avatarPreviewEnabled).toBe(true);
    expect(page.props.children.props.voiceTutorEnabled).toBe(true);
  });

  it("mantiene ambas funciones cerradas para valores distintos de true", async () => {
    vi.stubEnv("AIMAUTA_AVATAR_ENABLED", "TRUE");
    vi.stubEnv("AIMAUTA_VOICE_TUTOR_ENABLED", "1");

    const page = (await LearningPage({
      params: Promise.resolve({
        bookId: "fichas-matematica-1-secundaria",
      }),
    })) as ReactElement<PageProps>;

    expect(page.props["data-avatar-preview"]).toBe("disabled");
    expect(page.props.children.props.avatarPreviewEnabled).toBe(false);
    expect(page.props.children.props.voiceTutorEnabled).toBe(false);
  });
});
