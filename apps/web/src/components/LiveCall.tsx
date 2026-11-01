"use client";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

export default function LiveCall({ serverUrl, token, onLeave }: { serverUrl: string; token: string; onLeave: () => void }) {
  return (
    <LiveKitRoom token={token} serverUrl={serverUrl} connect audio video data-lk-theme="default" onDisconnected={onLeave} style={{ height: "min(70vh, 650px)", borderRadius: 14, overflow: "hidden" }}>
      <VideoConference />
    </LiveKitRoom>
  );
}
