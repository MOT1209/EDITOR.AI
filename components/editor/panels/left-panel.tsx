"use client";

import type { AppNotification, ProjectState } from "@/lib/types";
import { TABS } from "../state";
import type { State, Action } from "../state";
import { AIQuickPanel } from "./ai-quick-panel";
import { AudioPanel } from "./audio-panel";
import { ColorPanel } from "./color-panel";
import { EffectsPanel } from "./effects-panel";
import { ExportPanel } from "./export-panel";
import { MediaPanel } from "./media-panel";
import { MusicPanel } from "./music-panel";
import { TextPanel } from "./text-panel";

export function LeftPanel(props: {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: (type: AppNotification["type"], title: string, message?: string) => void;
  ensureBase: (p: ProjectState) => ProjectState;
  setAudio: (a: { url: string; name: string } | null) => void;
  onFullAuto: () => void;
  onDirector: (requestText: string) => void;
  onFullPipeline: () => void;
  agentRequest: string;
  setAgentRequest: (s: string) => void;
  onSilence: () => void;
  onSubtitles: () => void;
  onEnhanceAudio: () => void;
  onColor: () => void;
  onStabilize: () => void;
  onBRoll: () => void;
  onShorts: () => void;
  onSceneDetect: () => void;
  onFaceDetect: () => void;
  onObjectDetect: () => void;
  onHighlight: () => void;
  onReframe: () => void;
  onMusicSync: () => void;
  onTranslate: () => void;
  onDub: () => void;
  onThumbnail: () => void;
  onTitleDesc: () => void;
  audioDenoise: number;
  setAudioDenoise: (n: number) => void;
  audioEnhance: number;
  setAudioEnhance: (n: number) => void;
  colorGrading: number;
  setColorGrading: (n: number) => void;
  videoStabilize: boolean;
  setVideoStabilize: (b: boolean) => void;
  subtitleText: string;
  setSubtitleText: (s: string) => void;
  voiceoverText: string;
  setVoiceoverText: (s: string) => void;
  subLang: string;
  setSubLang: (s: string) => void;
  translateTarget: string;
  setTranslateTarget: (s: string) => void;
  ttsVoice: string;
  setTtsVoice: (s: string) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontColor: string;
  setFontColor: (s: string) => void;
  fontBg: string;
  setFontBg: (s: string) => void;
  fontFamily: string;
  setFontFamily: (s: string) => void;
  bpmInput: number;
  setBpmInput: (n: number) => void;
  onAddSubtitle: () => void;
  onExportSRT: () => void;
  onExportVTT: () => void;
  onExportProject: () => void;
}) {
  const { state, dispatch } = props;
  return (
    <>
      <div className="border-b border-line p-3">
        <div className="grid grid-cols-2 gap-1">
          {TABS.map((t) => {
            const Active = t.icon;
            const active = state.activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] transition ${
                  active
                    ? "bg-brand/15 text-brand-glow border border-brand/30"
                    : "text-ink-soft hover:bg-bg-soft border border-transparent"
                }`}
              >
                <Active className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {state.activeTab === "ai" && (
          <AIQuickPanel
            state={state}
            dispatch={dispatch}
            onFullAuto={props.onFullAuto}
            onDirector={props.onDirector}
            onFullPipeline={props.onFullPipeline}
            agentRequest={props.agentRequest}
            setAgentRequest={props.setAgentRequest}
            onSilence={props.onSilence}
            onSubtitles={props.onSubtitles}
            onColor={props.onColor}
            onStabilize={props.onStabilize}
            onBRoll={props.onBRoll}
            onShorts={props.onShorts}
            onSceneDetect={props.onSceneDetect}
            onFaceDetect={props.onFaceDetect}
            onObjectDetect={props.onObjectDetect}
            onHighlight={props.onHighlight}
            onReframe={props.onReframe}
            onMusicSync={props.onMusicSync}
            onThumbnail={props.onThumbnail}
            onTitleDesc={props.onTitleDesc}
            bpmInput={props.bpmInput}
            setBpmInput={props.setBpmInput}
          />
        )}

        {state.activeTab === "media" && (
          <MediaPanel state={state} dispatch={dispatch} notify={props.notify} prepare={props.ensureBase} />
        )}

        {state.activeTab === "effects" && (
          <EffectsPanel state={state} dispatch={dispatch} />
        )}

        {state.activeTab === "music" && (
          <MusicPanel
            state={state}
            dispatch={dispatch}
            onPlay={(m) => {
              props.setAudio({ url: m.url, name: m.title });
              dispatch({ type: "SET_MUSIC", id: m.id });
            }}
            onStop={() => {
              props.setAudio(null);
              dispatch({ type: "SET_MUSIC", id: undefined });
            }}
          />
        )}

        {state.activeTab === "text" && (
          <TextPanel
            props={{
              ...props,
              dispatch,
              state,
            }}
          />
        )}

        {state.activeTab === "audio" && (
          <AudioPanel
            state={state}
            dispatch={dispatch}
            onEnhanceAudio={props.onEnhanceAudio}
            audioDenoise={props.audioDenoise}
            setAudioDenoise={props.setAudioDenoise}
            audioEnhance={props.audioEnhance}
            setAudioEnhance={props.setAudioEnhance}
          />
        )}

        {state.activeTab === "color" && (
          <ColorPanel
            state={state}
            dispatch={dispatch}
            colorGrading={props.colorGrading}
            setColorGrading={props.setColorGrading}
            videoStabilize={props.videoStabilize}
            setVideoStabilize={props.setVideoStabilize}
          />
        )}

        {state.activeTab === "export" && (
          <ExportPanel
            state={state}
            dispatch={dispatch}
            onExportSRT={props.onExportSRT}
            onExportVTT={props.onExportVTT}
            onExportProject={props.onExportProject}
          />
        )}
      </div>
    </>
  );
}
