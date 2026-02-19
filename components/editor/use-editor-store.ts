"use client";

import { create } from "zustand";
import type { TemplateSlotSchemaJsonType } from "@/lib/template-schema";

export type EditorAsset = {
  id: string;
  projectId: string;
  slotKey: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  signedUrl: string;
};

export type EditorRenderJob = {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
  progress: number;
  outputStorageKey: string | null;
  outputUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type EditorStore = {
  projectId: string;
  projectTitle: string;
  projectStatus: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
  templateSlug: string;
  templateName: string;
  slotSchema: TemplateSlotSchemaJsonType;
  config: Record<string, string | number | boolean>;
  assets: Record<string, EditorAsset>;
  currentRenderJob: EditorRenderJob | null;
  hydrate: (payload: {
    projectId: string;
    projectTitle: string;
    projectStatus: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
    templateSlug: string;
    templateName: string;
    slotSchema: TemplateSlotSchemaJsonType;
    config: Record<string, string | number | boolean>;
    assets: EditorAsset[];
    currentRenderJob: EditorRenderJob | null;
  }) => void;
  setAsset: (asset: EditorAsset) => void;
  setConfigValue: (key: string, value: string | number | boolean) => void;
  setProjectStatus: (status: EditorStore["projectStatus"]) => void;
  setCurrentRenderJob: (job: EditorRenderJob | null) => void;
};

const emptySchema: TemplateSlotSchemaJsonType = {
  previewImage: "",
  slots: [],
  controls: [],
  recipeCard: {
    structure: [],
    filmingTips: [],
    caution: []
  }
};

export const useEditorStore = create<EditorStore>((set) => ({
  projectId: "",
  projectTitle: "",
  projectStatus: "DRAFT",
  templateSlug: "",
  templateName: "",
  slotSchema: emptySchema,
  config: {},
  assets: {},
  currentRenderJob: null,
  hydrate: (payload) =>
    set({
      projectId: payload.projectId,
      projectTitle: payload.projectTitle,
      projectStatus: payload.projectStatus,
      templateSlug: payload.templateSlug,
      templateName: payload.templateName,
      slotSchema: payload.slotSchema,
      config: payload.config,
      assets: Object.fromEntries(payload.assets.map((asset) => [asset.slotKey, asset])),
      currentRenderJob: payload.currentRenderJob
    }),
  setAsset: (asset) =>
    set((state) => ({
      assets: {
        ...state.assets,
        [asset.slotKey]: asset
      }
    })),
  setConfigValue: (key, value) =>
    set((state) => ({
      config: {
        ...state.config,
        [key]: value
      }
    })),
  setProjectStatus: (status) => set({ projectStatus: status }),
  setCurrentRenderJob: (job) => set({ currentRenderJob: job })
}));
