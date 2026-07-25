"use client";

import { useEffect, useRef, useState } from "react";

import type {
  Group,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from "three";
import {
  resolveTutorMouthPose,
  type TutorAvatarState,
  type TutorMouthPose,
} from "@/lib/tutor-avatar";

type TutorAvatar3DProps = {
  state: TutorAvatarState;
  audioTrack: MediaStreamTrack | null;
  onReadyChange: (ready: boolean) => void;
};

type MorphMesh = Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type AvatarRuntime = {
  avatar: Group;
  camera: PerspectiveCamera;
  head: Object3D | null;
  meshes: MorphMesh[];
  renderer: WebGLRenderer;
  scene: Scene;
};

const ACTIVE_STATES = new Set<TutorAvatarState>([
  "preview",
  "connecting",
  "ready",
  "listening",
  "speaking",
  "reconnecting",
]);

const AVATAR_URL = "/avatars/aimauta-teacher-v1.glb";
const ANALYSIS_INTERVAL_MS = 1_000 / 30;
const SILENT_MOUTH_POSE = resolveTutorMouthPose({
  level: 0,
  low: 0,
  mid: 0,
  high: 0,
});

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setMorph(meshes: MorphMesh[], name: string, value: number) {
  for (const mesh of meshes) {
    const index = mesh.morphTargetDictionary?.[name];
    if (
      index === undefined ||
      !mesh.morphTargetInfluences ||
      index >= mesh.morphTargetInfluences.length
    ) {
      continue;
    }
    mesh.morphTargetInfluences[index] = value;
  }
}

function averageSpectrumBand(
  spectrum: Uint8Array,
  sampleRate: number,
  fftSize: number,
  minimumHz: number,
  maximumHz: number,
): number {
  const hzPerBin = sampleRate / fftSize;
  const firstBin = Math.max(1, Math.floor(minimumHz / hzPerBin));
  const lastBin = Math.min(
    spectrum.length,
    Math.ceil(maximumHz / hzPerBin),
  );
  if (lastBin <= firstBin) return 0;

  let total = 0;
  for (let index = firstBin; index < lastBin; index += 1) {
    total += spectrum[index] ?? 0;
  }
  return total / (lastBin - firstBin) / 255;
}

function blendMouthPose(
  current: TutorMouthPose,
  target: TutorMouthPose,
  amount: number,
): TutorMouthPose {
  const blend = (from: number, to: number) => from + (to - from) * amount;
  return {
    jawOpen: blend(current.jawOpen, target.jawOpen),
    visemeAa: blend(current.visemeAa, target.visemeAa),
    visemeE: blend(current.visemeE, target.visemeE),
    visemeFf: blend(current.visemeFf, target.visemeFf),
    visemeI: blend(current.visemeI, target.visemeI),
    visemeO: blend(current.visemeO, target.visemeO),
    visemeSs: blend(current.visemeSs, target.visemeSs),
    visemeU: blend(current.visemeU, target.visemeU),
  };
}

function disposeMaterial(material: Material, textures: Set<Texture>) {
  for (const value of Object.values(material)) {
    if (
      value &&
      typeof value === "object" &&
      "isTexture" in value &&
      value.isTexture === true
    ) {
      textures.add(value as Texture);
    }
  }
  material.dispose();
}

function disposeAvatar(avatar: Group) {
  const textures = new Set<Texture>();
  avatar.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;

    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (material) disposeMaterial(material, textures);
    }
  });
  for (const texture of textures) texture.dispose();
}

function disposeRenderer(renderer: WebGLRenderer) {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}

function disposeRuntime(runtime: AvatarRuntime) {
  disposeAvatar(runtime.avatar);
  disposeRenderer(runtime.renderer);
}

function createAudioAnalysisGraph(audioTrack: MediaStreamTrack) {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    const stream = new MediaStream([audioTrack]);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentOutput = context.createGain();
    analyser.fftSize = 1_024;
    analyser.smoothingTimeConstant = 0.42;
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    return { analyser, context, silentOutput, source };
  } catch (error) {
    void context.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Optional WebGL layer powered by Three.js. The model loads for the explicit
 * silent preview or an active voice session. Mouth motion is derived locally
 * from the validated agent audio track. The illustrated SVG remains the
 * no-WebGL fallback.
 */
export function TutorAvatar3D({
  state,
  audioTrack,
  onReadyChange,
}: TutorAvatar3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouthPoseRef = useRef<TutorMouthPose>(SILENT_MOUTH_POSE);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const enabled = ACTIVE_STATES.has(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (
      !enabled ||
      !containerRef.current ||
      prefersReducedMotion() ||
      !supportsWebGl()
    ) {
      setReady(false);
      onReadyChange(false);
      return;
    }

    const target = containerRef.current;
    let animationFrame = 0;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let runtime: AvatarRuntime | null = null;
    let renderer: WebGLRenderer | null = null;
    let resourcesDisposed = false;

    const disposeResources = () => {
      if (resourcesDisposed) return;
      resourcesDisposed = true;
      if (runtime) {
        disposeRuntime(runtime);
        runtime = null;
      } else if (renderer) {
        disposeRenderer(renderer);
      }
      renderer = null;
    };

    async function initialize() {
      const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/libs/meshopt_decoder.module.js"),
      ]);
      if (cancelled) return;

      const createdRenderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer = createdRenderer;
      createdRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      createdRenderer.outputColorSpace = THREE.SRGBColorSpace;
      createdRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      createdRenderer.toneMappingExposure = 1.1;
      target.appendChild(createdRenderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(16, 1, 0.1, 20);
      camera.position.set(0, 0.55, 4.2);
      camera.lookAt(0, 0.55, 0);
      scene.add(new THREE.HemisphereLight(0xfff9e9, 0x49645d, 2.5));
      const keyLight = new THREE.DirectionalLight(0xffd9be, 4.5);
      keyLight.position.set(2.5, 3.5, 4);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xd9edff, 2);
      fillLight.position.set(-3, 1.5, 2);
      scene.add(fillLight);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(AVATAR_URL);
      const avatar = gltf.scene;
      if (cancelled) {
        disposeAvatar(avatar);
        return;
      }
      const bounds = new THREE.Box3().setFromObject(avatar);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = size.y > 0 ? 2 / size.y : 1;
      avatar.scale.setScalar(scale);
      avatar.position.set(
        -center.x * scale,
        -center.y * scale,
        -center.z * scale,
      );
      const baseAvatarY = avatar.position.y;

      const meshes: MorphMesh[] = [];
      avatar.traverse((object) => {
        const mesh = object as MorphMesh;
        if (mesh.isMesh && mesh.morphTargetInfluences) meshes.push(mesh);
      });
      scene.add(avatar);

      runtime = {
        avatar,
        camera,
        head: avatar.getObjectByName("Head") ?? null,
        meshes,
        renderer: createdRenderer,
        scene,
      };

      const resize = () => {
        const width = Math.max(1, target.clientWidth);
        const height = Math.max(1, target.clientHeight);
        createdRenderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(target);
      resize();

      let lastRenderedAt = 0;
      const render = (now: number) => {
        animationFrame = window.requestAnimationFrame(render);
        if (now - lastRenderedAt < ANALYSIS_INTERVAL_MS) return;
        lastRenderedAt = now;

        const seconds = now / 1_000;
        const speaking = stateRef.current === "speaking";
        const mouth = speaking ? mouthPoseRef.current : SILENT_MOUTH_POSE;
        const blinkPhase = now % 5_200;
        const blink =
          blinkPhase > 4_980
            ? Math.sin(((blinkPhase - 4_980) / 220) * Math.PI)
            : 0;

        setMorph(meshes, "jawOpen", mouth.jawOpen);
        setMorph(meshes, "viseme_aa", mouth.visemeAa);
        setMorph(meshes, "viseme_E", mouth.visemeE);
        setMorph(meshes, "viseme_FF", mouth.visemeFf);
        setMorph(meshes, "viseme_I", mouth.visemeI);
        setMorph(meshes, "viseme_O", mouth.visemeO);
        setMorph(meshes, "viseme_SS", mouth.visemeSs);
        setMorph(meshes, "viseme_U", mouth.visemeU);
        setMorph(meshes, "mouthSmileLeft", speaking ? 0.03 : 0.08);
        setMorph(meshes, "mouthSmileRight", speaking ? 0.03 : 0.08);
        setMorph(meshes, "eyeBlinkLeft", blink);
        setMorph(meshes, "eyeBlinkRight", blink);
        avatar.position.y =
          baseAvatarY + Math.sin(seconds * 1.05) * 0.028;
        avatar.rotation.y = Math.sin(seconds * 0.7) * 0.036;
        avatar.rotation.x = Math.sin(seconds * 0.43) * 0.012;
        if (runtime?.head) {
          runtime.head.rotation.z = Math.sin(seconds * 0.55) * 0.024;
        }
        createdRenderer.render(scene, camera);
      };
      animationFrame = window.requestAnimationFrame(render);
      setReady(true);
      onReadyChange(true);
    }

    void initialize().catch(() => {
      if (cancelled) return;
      disposeResources();
      setReady(false);
      onReadyChange(false);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mouthPoseRef.current = SILENT_MOUTH_POSE;
      disposeResources();
      onReadyChange(false);
    };
  }, [enabled, onReadyChange]);

  useEffect(() => {
    if (!ready || !audioTrack || audioTrack.readyState !== "live") {
      mouthPoseRef.current = SILENT_MOUTH_POSE;
      return;
    }

    let graph: ReturnType<typeof createAudioAnalysisGraph>;
    try {
      graph = createAudioAnalysisGraph(audioTrack);
    } catch {
      mouthPoseRef.current = SILENT_MOUTH_POSE;
      return;
    }
    const { analyser, context, silentOutput, source } = graph;
    const samples = new Float32Array(analyser.fftSize);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);

    let animationFrame = 0;
    let lastAnalysisAt = 0;

    const resumeContext = () => {
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
    };
    document.addEventListener("pointerdown", resumeContext, { passive: true });
    document.addEventListener("keydown", resumeContext);
    resumeContext();

    const analyse = (now: number) => {
      if (now - lastAnalysisAt >= ANALYSIS_INTERVAL_MS) {
        analyser.getFloatTimeDomainData(samples);
        analyser.getByteFrequencyData(spectrum);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        const targetLevel = Math.min(1, Math.max(0, (rms - 0.012) * 12));
        const targetPose = resolveTutorMouthPose({
          level: targetLevel,
          low: averageSpectrumBand(
            spectrum,
            context.sampleRate,
            analyser.fftSize,
            80,
            500,
          ),
          mid: averageSpectrumBand(
            spectrum,
            context.sampleRate,
            analyser.fftSize,
            500,
            2_200,
          ),
          high: averageSpectrumBand(
            spectrum,
            context.sampleRate,
            analyser.fftSize,
            2_200,
            6_000,
          ),
        });
        const currentPose = mouthPoseRef.current;
        const blendAmount =
          targetPose.jawOpen > currentPose.jawOpen ? 0.58 : 0.24;
        mouthPoseRef.current = blendMouthPose(
          currentPose,
          targetPose,
          blendAmount,
        );
        lastAnalysisAt = now;
      }
      animationFrame = window.requestAnimationFrame(analyse);
    };
    animationFrame = window.requestAnimationFrame(analyse);

    const resetMouth = () => {
      mouthPoseRef.current = SILENT_MOUTH_POSE;
    };
    audioTrack.addEventListener("ended", resetMouth);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      audioTrack.removeEventListener("ended", resetMouth);
      document.removeEventListener("pointerdown", resumeContext);
      document.removeEventListener("keydown", resumeContext);
      resetMouth();
      source.disconnect();
      analyser.disconnect();
      silentOutput.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [audioTrack, ready]);

  return (
    <div
      className={`tutor-avatar-3d${ready ? " tutor-avatar-3d-ready" : ""}`}
      ref={containerRef}
      aria-hidden="true"
    />
  );
}
