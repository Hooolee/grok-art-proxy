/**
 * Model mapping from OpenAI model IDs to Grok internal model names and modes
 */

export interface ModelInfo {
  id: string;
  grokModel: string;
  modelMode: string;
  displayName: string;
  type: "text" | "image" | "video" | "edit";
}

// Supported aspect ratios
const SUPPORTED_RATIOS = ["1:1", "2:3", "3:2", "16:9", "9:16"] as const;
type AspectRatio = (typeof SUPPORTED_RATIOS)[number];

// Ratio suffix to actual ratio mapping
const RATIO_SUFFIX_MAP: Record<string, AspectRatio> = {
  "1_1": "1:1",
  "2_3": "2:3",
  "3_2": "3:2",
  "16_9": "16:9",
  "9_16": "9:16",
};

// Grok model modes
const MODEL_MODE_AUTO = "MODEL_MODE_AUTO";
const MODEL_MODE_FAST = "MODEL_MODE_FAST";
const MODEL_MODE_HEAVY = "MODEL_MODE_HEAVY";
const MODEL_MODE_GROK_4_MINI_THINKING = "MODEL_MODE_GROK_4_MINI_THINKING";
const MODEL_MODE_GROK_4_1_THINKING = "MODEL_MODE_GROK_4_1_THINKING";
const MODEL_MODE_EXPERT = "MODEL_MODE_EXPERT";

export const MODELS: ModelInfo[] = [
  // Grok 3 series
  {
    id: "grok-3",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_AUTO,
    displayName: "Grok 3",
    type: "text",
  },
  {
    id: "grok-3-fast",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok 3 Fast",
    type: "text",
  },
  // Grok 4 series
  {
    id: "grok-4",
    grokModel: "grok-4",
    modelMode: MODEL_MODE_AUTO,
    displayName: "Grok 4",
    type: "text",
  },
  {
    id: "grok-4-mini",
    grokModel: "grok-4-mini-thinking-tahoe",
    modelMode: MODEL_MODE_GROK_4_MINI_THINKING,
    displayName: "Grok 4 Mini",
    type: "text",
  },
  {
    id: "grok-4-fast",
    grokModel: "grok-4",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok 4 Fast",
    type: "text",
  },
  {
    id: "grok-4-heavy",
    grokModel: "grok-4",
    modelMode: MODEL_MODE_HEAVY,
    displayName: "Grok 4 Heavy",
    type: "text",
  },
  // Grok 4.1 series
  {
    id: "grok-4.1",
    grokModel: "grok-4-1-thinking-1129",
    modelMode: MODEL_MODE_AUTO,
    displayName: "Grok 4.1",
    type: "text",
  },
  {
    id: "grok-4.1-fast",
    grokModel: "grok-4-1-thinking-1129",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok 4.1 Fast",
    type: "text",
  },
  {
    id: "grok-4.1-expert",
    grokModel: "grok-4-1-thinking-1129",
    modelMode: MODEL_MODE_EXPERT,
    displayName: "Grok 4.1 Expert",
    type: "text",
  },
  {
    id: "grok-4.1-thinking",
    grokModel: "grok-4-1-thinking-1129",
    modelMode: MODEL_MODE_GROK_4_1_THINKING,
    displayName: "Grok 4.1 Thinking",
    type: "text",
  },
  // Image models with aspect ratios
  {
    id: "grok-image",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (1:1)",
    type: "image",
  },
  {
    id: "grok-image-1_1",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (1:1)",
    type: "image",
  },
  {
    id: "grok-image-2_3",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (2:3)",
    type: "image",
  },
  {
    id: "grok-image-3_2",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (3:2)",
    type: "image",
  },
  {
    id: "grok-image-16_9",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (16:9)",
    type: "image",
  },
  {
    id: "grok-image-9_16",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Image (9:16)",
    type: "image",
  },
  // Image edit models
  {
    id: "grok-imagine-1.0-edit",
    grokModel: "imagine-1.0-edit",
    modelMode: MODEL_MODE_AUTO,
    displayName: "Grok Imagine 1.0 Edit",
    type: "edit",
  },
  // Video models with aspect ratios
  {
    id: "grok-video",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (16:9)",
    type: "video",
  },
  {
    id: "grok-video-1_1",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (1:1)",
    type: "video",
  },
  {
    id: "grok-video-2_3",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (2:3)",
    type: "video",
  },
  {
    id: "grok-video-3_2",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (3:2)",
    type: "video",
  },
  {
    id: "grok-video-16_9",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (16:9)",
    type: "video",
  },
  {
    id: "grok-video-9_16",
    grokModel: "grok-3",
    modelMode: MODEL_MODE_FAST,
    displayName: "Grok Video (9:16)",
    type: "video",
  },
];

/**
 * Get model info by OpenAI model ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === modelId);
}

/**
 * Convert OpenAI model ID to Grok model name and mode
 */
export function toGrokModel(modelId: string): { grokModel: string; modelMode: string } | null {
  const model = getModelInfo(modelId);
  if (!model) return null;
  return { grokModel: model.grokModel, modelMode: model.modelMode };
}

/**
 * Check if model is a text model
 */
export function isTextModel(modelId: string): boolean {
  const model = getModelInfo(modelId);
  return model?.type === "text";
}

/**
 * Check if model is a thinking model (shows reasoning process)
 */
export function isThinkingModel(modelId: string): boolean {
  const thinkingModels = ["grok-4-mini", "grok-4.1-thinking"];
  return thinkingModels.includes(modelId);
}

/**
 * Check if model is an image generation model
 */
export function isImageModel(modelId: string): boolean {
  return modelId === "grok-image" || modelId.startsWith("grok-image-");
}

/**
 * Check if model is a video generation model
 */
export function isVideoModel(modelId: string): boolean {
  return modelId === "grok-video" || modelId.startsWith("grok-video-");
}

/**
 * Parse model ID to extract base model and aspect ratio
 * e.g., "grok-image-16_9" -> { baseModel: "grok-image", aspectRatio: "16:9" }
 */
export function parseModelWithRatio(modelId: string): { baseModel: string; aspectRatio: string } {
  // Check for image model with ratio suffix
  if (modelId.startsWith("grok-image-")) {
    const suffix = modelId.slice("grok-image-".length);
    const ratio = RATIO_SUFFIX_MAP[suffix];
    if (ratio) {
      return { baseModel: "grok-image", aspectRatio: ratio };
    }
  }

  // Check for video model with ratio suffix
  if (modelId.startsWith("grok-video-")) {
    const suffix = modelId.slice("grok-video-".length);
    const ratio = RATIO_SUFFIX_MAP[suffix];
    if (ratio) {
      return { baseModel: "grok-video", aspectRatio: ratio };
    }
  }

  // Default ratios for base models
  if (modelId === "grok-image") {
    return { baseModel: "grok-image", aspectRatio: "1:1" };
  }
  if (modelId === "grok-video") {
    return { baseModel: "grok-video", aspectRatio: "16:9" };
  }

  // Unknown model
  return { baseModel: modelId, aspectRatio: "1:1" };
}

/**
 * Check if model requires an input image (video from image)
 * @deprecated No longer used - grok-video-from-image model removed
 */
export function requiresInputImage(_modelId: string): boolean {
  return false;
}
