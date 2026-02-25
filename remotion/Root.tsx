import { Composition } from "remotion";
import type { RemotionTemplateProps } from "./types";
import { GreenScreenCommentatorTemplate } from "./templates/green-screen-commentator";
import { TweetCommentPopupReplyTemplate } from "./templates/tweet-comment-popup-reply";
import { ThreeBeatMontageIntroTemplate } from "./templates/three-beat-montage-intro-main-talk";
import { SplitScreenReactionTemplate } from "./templates/split-screen-reaction";
import { FakeFaceTimeIncomingCallTemplate } from "./templates/fake-facetime-incoming-call";
import { SystemFreeformEditorTemplate } from "./templates/system-freeform-editor";

const defaultProps: RemotionTemplateProps = {
  assets: {
    background: {
      id: "demo-background",
      slotKey: "background",
      src: "/demo-assets/pattern-grid.svg",
      kind: "IMAGE",
      mimeType: "image/svg+xml"
    },
    foreground: {
      id: "demo-foreground",
      slotKey: "foreground",
      src: "/demo-assets/demo-portrait.mp4",
      kind: "VIDEO",
      mimeType: "video/mp4",
      durationSec: 6
    },
    main: {
      id: "demo-main",
      slotKey: "main",
      src: "/demo-assets/demo-portrait.mp4",
      kind: "VIDEO",
      mimeType: "video/mp4",
      durationSec: 6
    },
    overlay: {
      id: "demo-overlay",
      slotKey: "overlay",
      src: "/demo-assets/mock-comment.png",
      kind: "IMAGE",
      mimeType: "image/png"
    },
    montage_1: {
      id: "demo-m1",
      slotKey: "montage_1",
      src: "/demo-assets/pattern-grid.svg",
      kind: "IMAGE",
      mimeType: "image/svg+xml"
    },
    montage_2: {
      id: "demo-m2",
      slotKey: "montage_2",
      src: "/demo-assets/pattern-waves.svg",
      kind: "IMAGE",
      mimeType: "image/svg+xml"
    },
    montage_3: {
      id: "demo-m3",
      slotKey: "montage_3",
      src: "/demo-assets/pattern-steps.svg",
      kind: "IMAGE",
      mimeType: "image/svg+xml"
    },
    top: {
      id: "demo-top",
      slotKey: "top",
      src: "/demo-assets/demo-portrait.mp4",
      kind: "VIDEO",
      mimeType: "video/mp4",
      durationSec: 6
    },
    bottom: {
      id: "demo-bottom",
      slotKey: "bottom",
      src: "/demo-assets/demo-landscape.mp4",
      kind: "VIDEO",
      mimeType: "video/mp4",
      durationSec: 6
    },
    caller_photo: {
      id: "demo-caller",
      slotKey: "caller_photo",
      src: "/demo-assets/caller-avatar.svg",
      kind: "IMAGE",
      mimeType: "image/svg+xml"
    },
    seed_media: {
      id: "demo-seed",
      slotKey: "seed_media",
      src: "/demo-assets/demo-portrait.mp4",
      kind: "VIDEO",
      mimeType: "video/mp4",
      durationSec: 6
    }
  },
  config: {
    blurBackground: true,
    foregroundCornerRadius: 28,
    captionText: "Here is the structural hook breakdown.",
    subjectIsolation: true,
    subjectIsolationMode: "blur",
    subjectIsolationSimilarity: 0.25,
    subjectIsolationBlend: 0.08,
    overlayAppearSec: 1,
    animation: "pop",
    notificationSfx: true,
    beatDurationSec: 0.5,
    includeBoomSfx: true,
    showBorder: true,
    topVolume: 1,
    bottomVolume: 0.3,
    callerName: "Creator Hotline",
    ringDurationSec: 2
  },
  durationInFrames: 180,
  fps: 30
};

const calculateMetadata = ({ props }: { props: Partial<RemotionTemplateProps> }) => ({
  durationInFrames: Math.max(60, Math.floor(props.durationInFrames ?? 180)),
  fps: Math.max(24, Math.floor(props.fps ?? 30))
});

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="green-screen-commentator"
        component={GreenScreenCommentatorTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
      <Composition
        id="tweet-comment-popup-reply"
        component={TweetCommentPopupReplyTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
      <Composition
        id="three-beat-montage-intro-main-talk"
        component={ThreeBeatMontageIntroTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
      <Composition
        id="split-screen-reaction"
        component={SplitScreenReactionTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
      <Composition
        id="fake-facetime-incoming-call"
        component={FakeFaceTimeIncomingCallTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
      <Composition
        id="system-freeform-editor"
        component={SystemFreeformEditorTemplate}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={180}
        calculateMetadata={calculateMetadata}
        defaultProps={defaultProps}
      />
    </>
  );
};
