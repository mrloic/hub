import { readAudio, saveAudio } from "./audio/preferences";
import {
  constraintsFor,
  participantVolume,
  effectiveVolume,
  availableDevice,
  type AudioSettings,
} from "../../../../packages/audio/src/settings";
import { parseShortcut } from "../../../../packages/audio/src/shortcuts";
import {
  HubTrackProcessor,
  captureMicrophone,
  emptyMeter,
  type Meter,
} from "./audio/processor";
import type {} from "../../../../packages/shared/src/desktop";
import { useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  LocalAudioTrack,
  RemoteAudioTrack,
  setLogLevel,
  LogLevel,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  type RemoteTrack,
  type Participant,
  type VideoTrack,
} from "livekit-client";
import type {
  Channel,
  User,
  VoiceTicket,
} from "../../../../packages/shared/src";
import { ApiError, errorText, request } from "../api";
import { microphoneError } from "./microphoneError";
// SDK diagnostic messages can contain signaling URLs. Show safe UI errors instead.
setLogLevel(LogLevel.silent);
export type VoicePerson = {
  id: string;
  name: string;
  speaking: boolean;
  microphone: boolean;
  local: boolean;
  screen: boolean;
};
export function useVoice(user: User | null) {
  const [processing, setProcessing] = useState(readAudio);
  const processingRef = useRef(processing);
  const [processingNotice, setProcessingNotice] = useState("");
  const [processingBusy, setProcessingBusy] = useState(false);
  const processingPending = useRef(false);
  const [meter, setMeter] = useState<Meter>(emptyMeter);
  const processor = useRef<HubTrackProcessor | null>(null);
  const testCapture = useRef<{
    track: LocalAudioTrack;
    processor: HubTrackProcessor;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const testGeneration = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const remoteAudio = useRef(new Map<RemoteAudioTrack, string>());
  const [sharing, setSharing] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);
  const screenPending = useRef(false);
  const [screens, setScreens] = useState<
    { id: string; name: string; track?: VideoTrack }[]
  >([]);
  const [selectedScreen, setSelectedScreen] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState("Отключено");
  const [active, setActive] = useState<VoiceTicket | null>(null);
  const [people, setPeople] = useState<VoicePerson[]>([]);
  const [mic, setMic] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const room = useRef<Room | null>(null);
  const ticket = useRef<VoiceTicket | null>(null);
  const generation = useRef(0);
  const connecting = useRef(false);
  const mutedPlayback = useRef(false);
  const audioElements = useRef(new Set<HTMLMediaElement>());
  function removeAudio(element: HTMLMediaElement) {
    element.pause();
    element.srcObject = null;
    audioElements.current.delete(element);
    element.remove();
  }
  function clearAudio() {
    for (const element of audioElements.current) removeAudio(element);
    audioElements.current.clear();
  }
  async function release(notify = true) {
    const old = ticket.current;
    ticket.current = null;
    const current = room.current;
    room.current = null;
    current?.removeAllListeners();
    clearAudio();
    remoteAudio.current.clear();
    window.hubDesktop?.voiceActive(false);
    await stopTest();
    await processor.current?.destroy();
    processor.current = null;
    setMeter(emptyMeter);
    setActive(null);
    setPeople([]);
    setScreens([]);
    setSharing(false);
    setSelectedScreen(null);
    selectedRef.current = null;
    setMic(false);
    setState("Отключено");
    await current?.disconnect();
    if (old && notify)
      await request("/voice/leave", "POST", { leaseId: old.leaseId }).catch(
        () => {},
      );
  }
  useEffect(() => {
    if (user)
      void request<{ enabled: boolean }>("/voice/config")
        .then((v) => setEnabled(v.enabled))
        .catch(() => setEnabled(false));
    else setEnabled(false);
    return () => {
      ++generation.current;
      connecting.current = false;
      setBusy(false);
      setError("");
      void release(false);
    };
  }, [user?.id]);
  async function connect(channel: Channel) {
    if (connecting.current) return;
    connecting.current = true;
    setBusy(true);
    const revision = ++generation.current;
    setError("");
    setState("Подключение…");
    try {
      await release();
      setState("Подключение…");
      const access = await request<VoiceTicket>("/voice/join", "POST", {
        channelId: channel.id,
      });
      if (revision !== generation.current) {
        await request("/voice/leave", "POST", {
          leaseId: access.leaseId,
        }).catch(() => {});
        return;
      }
      ticket.current = access;
      const current = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: constraintsFor(
          processingRef.current,
          navigator.mediaDevices.getSupportedConstraints(),
        ),
        publishDefaults: {
          audioPreset: { maxBitrate: 32000 },
          screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 },
          simulcast: true,
        },
      });
      room.current = current;
      const refresh = () => {
        const participants: Participant[] = [
          current.localParticipant,
          ...current.remoteParticipants.values(),
        ];
        setPeople(
          participants.map((p) => ({
            id: p.identity,
            name: p.name || "Участник",
            speaking:
              p.isSpeaking &&
              p.isMicrophoneEnabled &&
              current.state === ConnectionState.Connected,
            microphone: p.isMicrophoneEnabled,
            local: p === current.localParticipant,
            screen: p.isScreenShareEnabled,
          })),
        );
        setMic(current.localParticipant.isMicrophoneEnabled);
        setSharing(current.localParticipant.isScreenShareEnabled);
        setScreens(
          participants
            .filter((p) => p.isScreenShareEnabled)
            .map((p) => ({
              id: p.identity,
              name: p.name || "Участник",
              track: p.getTrackPublication(Track.Source.ScreenShare)?.track as
                VideoTrack | undefined,
            })),
        );
        for (const participant of current.remoteParticipants.values())
          for (const publication of participant.trackPublications.values()) {
            const wanted =
              publication.source === Track.Source.Microphone ||
              (participant.identity === selectedRef.current &&
                [
                  Track.Source.ScreenShare,
                  Track.Source.ScreenShareAudio,
                ].includes(publication.source));
            if (publication.isSubscribed !== wanted)
              publication.setSubscribed(wanted);
          }
      };
      refreshRef.current = refresh;
      current.on(RoomEvent.ConnectionStateChanged, (status) => {
        setState(
          status === ConnectionState.Connected
            ? "Голос подключён"
            : status === ConnectionState.Reconnecting ||
                status === ConnectionState.SignalReconnecting
              ? "Голос: переподключение…"
              : status === ConnectionState.Connecting
                ? "Подключение…"
                : "Отключено",
        );
      });
      for (const event of [
        RoomEvent.ConnectionStateChanged,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
      ])
        current.on(event, refresh);
      current.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication, participant) => {
          if (track.kind !== Track.Kind.Audio) {
            refresh();
            return;
          }
          track.on(TrackEvent.ElementDetached, removeAudio);
          const element = track.attach();
          if (track instanceof RemoteAudioTrack) {
            remoteAudio.current.set(track, participant.identity);
            // LiveKit 2.22's attach only restores a truthy cached volume; apply 0
            // explicitly after attachment so a reconnect never unmutes this user.
            track.setVolume(
              effectiveVolume(
                participantVolume(processingRef.current, participant.identity),
                mutedPlayback.current,
              ),
            );
          }
          void setOutput(element, processingRef.current.outputDeviceId);
          element.autoplay = true;
          element.muted = mutedPlayback.current;
          element.dataset.hubVoiceAudio = "true";
          document.body.append(element);
          audioElements.current.add(element);
          refresh();
        },
      );
      current.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.off(TrackEvent.ElementDetached, removeAudio);
        if (track instanceof RemoteAudioTrack)
          remoteAudio.current.delete(track);
        for (const element of track.detach()) {
          if (audioElements.current.has(element)) removeAudio(element);
        }
        refresh();
      });
      current.on(RoomEvent.AudioPlaybackStatusChanged, () =>
        setPlaybackBlocked(!current.canPlaybackAudio),
      );
      current.on(RoomEvent.Disconnected, () => {
        if (room.current === current) {
          setError(
            "Голосовое соединение завершено. Проверьте доступ и подключитесь снова.",
          );
          void release();
        }
      });
      await current.connect(access.serverUrl, access.token, {
        autoSubscribe: false,
      });
      if (revision !== generation.current) {
        await current.disconnect();
        return;
      }
      setActive(access);
      window.hubDesktop?.voiceActive(true);
      setState("Голос подключён");
      refresh();
      if (!mutedPlayback.current)
        await current.startAudio().catch(() => setPlaybackBlocked(true));
    } catch (e) {
      if (revision !== generation.current) return;
      await release();
      setError(
        e instanceof ApiError
          ? errorText(e)
          : "Не удалось установить голосовую связь. Проверьте подключение и повторите попытку.",
      );
    } finally {
      if (revision === generation.current) {
        connecting.current = false;
        setBusy(false);
      }
    }
  }
  async function leave() {
    ++generation.current;
    connecting.current = false;
    setBusy(false);
    await release();
    setError("");
  }
  function makeProcessor() {
    return new HubTrackProcessor(processingRef.current, setMeter, () => {
      const next = {
        ...processingRef.current,
        noiseSuppressionMode: "standard" as const,
        profile: "custom" as const,
      };
      processingRef.current = next;
      setProcessing(next);
      saveAudio(next);
      setProcessingNotice(
        "Улучшенное шумоподавление недоступно. Включена стандартная обработка.",
      );
    });
  }
  async function stopTest() {
    ++testGeneration.current;
    const test = testCapture.current;
    testCapture.current = null;
    window.hubDesktop?.voiceActive(!!room.current, false);
    setTesting(false);
    if (test) {
      test.track.stop();
      await test.processor.destroy();
    }
    setMeter(emptyMeter);
  }
  async function startTest() {
    if (testCapture.current) {
      await stopTest();
      return;
    }
    if (room.current?.localParticipant.isMicrophoneEnabled) {
      setError(
        "Сначала выключите микрофон в звонке: проверка не отправляет звук участникам.",
      );
      return;
    }
    setError("");
    setBusy(true);
    const revision = ++testGeneration.current;
    try {
      const filter = makeProcessor();
      const track = await captureMicrophone(filter);
      if (revision !== testGeneration.current) {
        track.stop();
        await filter.destroy();
        return;
      }
      try {
        testCapture.current = { track, processor: filter };
        setTesting(true);
        window.hubDesktop?.voiceActive(!!room.current, true);
        await refreshDevices();
      } catch (e) {
        track.stop();
        await filter.destroy();
        throw e;
      }
    } catch (e) {
      setError(microphoneError(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleMicrophone() {
    const current = room.current;
    if (!current || busy) return;
    setBusy(true);
    try {
      await stopTest();
      const existing = current.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.track;
      if (existing) {
        if (existing.isMuted) await existing.unmute();
        else await existing.mute();
      } else {
        const permission = await navigator.permissions
          ?.query({ name: "microphone" as PermissionName })
          .catch(() => null);
        if (permission?.state === "denied")
          throw new DOMException("Denied", "NotAllowedError");
        const filter = makeProcessor();
        const track = await captureMicrophone(filter);
        try {
          if (room.current !== current) {
            track.stop();
            await filter.destroy();
            return;
          }
          processor.current = filter;
          await current.localParticipant.publishTrack(track, {
            source: Track.Source.Microphone,
          });
        } catch (e) {
          track.stop();
          await filter.destroy();
          throw e;
        }
      }
      setMic(current.localParticipant.isMicrophoneEnabled);
      setError("");
      await refreshDevices();
    } catch (e) {
      setError(microphoneError(e));
    } finally {
      setBusy(false);
    }
  }
  async function refreshDevices() {
    const list = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    setDevices(list);
    const current = processingRef.current;
    const inputDeviceId = !list.some(
      (d) => d.kind === "audioinput" && d.deviceId,
    )
      ? current.inputDeviceId
      : availableDevice(
          current.inputDeviceId,
          list.filter((d) => d.kind === "audioinput"),
        );
    const outputDeviceId = !list.some(
      (d) => d.kind === "audiooutput" && d.deviceId,
    )
      ? current.outputDeviceId
      : availableDevice(
          current.outputDeviceId,
          list.filter((d) => d.kind === "audiooutput"),
        );
    if (
      inputDeviceId !== current.inputDeviceId ||
      outputDeviceId !== current.outputDeviceId
    ) {
      await updateProcessing({ ...current, inputDeviceId, outputDeviceId });
      setProcessingNotice(
        "Устройство отключено. Выбрано устройство по умолчанию.",
      );
    }
  }
  async function setOutput(element: HTMLMediaElement, id: string) {
    if ("setSinkId" in element)
      try {
        await element.setSinkId(id === "default" ? "" : id);
      } catch {
        setProcessingNotice(
          "Не удалось выбрать устройство вывода. Используется Default.",
        );
        await element.setSinkId("").catch(() => {});
        if (processingRef.current.outputDeviceId === id && id !== "default") {
          const next = { ...processingRef.current, outputDeviceId: "default" };
          processingRef.current = next;
          setProcessing(next);
          saveAudio(next);
        }
      }
  }
  function setParticipantVolume(id: string, value: number) {
    const next = {
      ...processingRef.current,
      participantVolumes: {
        ...processingRef.current.participantVolumes,
        [id]: Math.max(0, Math.min(1, value)),
      },
    };
    processingRef.current = next;
    setProcessing(next);
    saveAudio(next);
    for (const [track, identity] of remoteAudio.current)
      if (identity === id)
        track.setVolume(effectiveVolume(value, mutedPlayback.current));
  }
  useEffect(() => {
    const update = () => void refreshDevices().catch(() => {});
    update();
    navigator.mediaDevices?.addEventListener("devicechange", update);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", update);
  }, []);
  const actions = useRef({ toggleMicrophone, togglePlayback });
  actions.current = { toggleMicrophone, togglePlayback };
  useEffect(() => {
    const send = (down: boolean) => {
      processor.current?.ptt(down);
      testCapture.current?.processor.ptt(down);
    };
    const off = window.hubDesktop?.onEvent((event) => {
      if (event.type === "ptt") send(event.down);
      if (event.type === "mute") void actions.current.toggleMicrophone();
      if (event.type === "deafen") actions.current.togglePlayback();
    });
    const key = (event: KeyboardEvent) => {
      if (window.hubDesktop || processingRef.current.inputMode !== "ptt")
        return;
      const binding = parseShortcut(processingRef.current.pushToTalkShortcut);
      if (!binding) return;
      if (event.type === "keyup") {
        send(false);
        return;
      }
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (
        event.code === binding.code &&
        event.ctrlKey === binding.ctrl &&
        event.altKey === binding.alt &&
        event.shiftKey === binding.shift
      ) {
        event.preventDefault();
        send(true);
      }
    };
    const blur = () => {
      if (!window.hubDesktop) send(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      off?.();
      send(false);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  function togglePlayback() {
    mutedPlayback.current = !mutedPlayback.current;
    setDeaf(mutedPlayback.current);
    for (const element of audioElements.current)
      element.muted = mutedPlayback.current;
    for (const [track, id] of remoteAudio.current)
      track.setVolume(
        effectiveVolume(
          participantVolume(processingRef.current, id),
          mutedPlayback.current,
        ),
      );
  }
  async function startAudio() {
    if (mutedPlayback.current) return;
    try {
      await room.current?.startAudio();
      setPlaybackBlocked(!room.current?.canPlaybackAudio);
    } catch {
      setError(
        "Браузер запрещает звук. Разрешите воспроизведение в настройках сайта.",
      );
    }
  }
  function selectScreen(id: string | null) {
    selectedRef.current = id;
    setSelectedScreen(id);
    refreshRef.current();
  }
  async function updateProcessing(next: AudioSettings) {
    if (processingPending.current) return;
    processingPending.current = true;
    setProcessingBusy(true);
    setProcessingNotice("");
    const previous = processingRef.current;
    processingRef.current = next;
    setProcessing(next);
    saveAudio(next);
    try {
      const track =
        testCapture.current?.track ??
        room.current?.localParticipant.getTrackPublication(
          Track.Source.Microphone,
        )?.track;
      const filter = testCapture.current?.processor ?? processor.current;
      filter?.update(next);
      filter?.ptt(false);
      const captureChanged = [
        "inputDeviceId",
        "noiseSuppressionMode",
        "echoCancellation",
        "autoGainControl",
      ].some(
        (key) =>
          previous[key as keyof AudioSettings] !==
          next[key as keyof AudioSettings],
      );
      if (track instanceof LocalAudioTrack && captureChanged)
        await track.restartTrack(
          constraintsFor(
            next,
            navigator.mediaDevices.getSupportedConstraints(),
          ),
        );
      if (track instanceof LocalAudioTrack) await filter?.settleCapture(track);
      for (const element of audioElements.current)
        await setOutput(element, next.outputDeviceId);
    } catch {
      setProcessingNotice(
        "Не удалось применить параметры. Проверьте разрешения и устройство микрофона.",
      );
    } finally {
      processingPending.current = false;
      setProcessingBusy(false);
    }
  }
  async function toggleScreen() {
    const current = room.current;
    if (
      !current ||
      current.state !== ConnectionState.Connected ||
      screenPending.current
    )
      return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Демонстрация экрана не поддерживается этим браузером.");
      return;
    }
    screenPending.current = true;
    setScreenBusy(true);
    setError("");
    try {
      await current.localParticipant.setScreenShareEnabled(
        !current.localParticipant.isScreenShareEnabled,
        {
          audio: true,
          systemAudio: "include",
          selfBrowserSurface: "exclude",
          suppressLocalAudioPlayback: true,
          resolution: { width: 1920, height: 1080, frameRate: 15 },
          contentHint: "text",
        },
      );
      if (room.current !== current)
        await current.localParticipant.setScreenShareEnabled(false);
      else refreshRef.current();
    } catch {
      if (room.current === current)
        setError(
          "Не удалось начать демонстрацию. Выбор отменён или браузер не разрешил захват экрана.",
        );
    } finally {
      screenPending.current = false;
      setScreenBusy(false);
    }
  }
  return {
    meter,
    testing,
    startTest,
    stopTest,
    devices,
    refreshDevices,
    setParticipantVolume,
    processing,
    processingNotice,
    processingBusy,
    updateProcessing,
    sharing,
    screenBusy,
    toggleScreen,
    screens,
    selectedScreen,
    selectScreen,
    enabled,
    state,
    active,
    people,
    mic,
    deaf,
    error,
    busy,
    playbackBlocked,
    connect,
    leave,
    toggleMicrophone,
    togglePlayback,
    startAudio,
  };
}
export type VoiceState = ReturnType<typeof useVoice>;
