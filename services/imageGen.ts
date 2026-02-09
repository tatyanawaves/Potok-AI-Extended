import { AISettings } from "../types";

/**
 * Service for generating images via external APIs.
 */

export const generateImage = async (prompt: string, settings?: AISettings): Promise<string> => {
  const provider = settings?.imageGenProvider || 'pollinations';
  
  console.log(`[ImageGen] Generating image with provider: ${provider}, prompt: ${prompt}`);

  if (provider === 'pollinations') {
    // Pollinations.ai is free and doesn't require a key for basic usage
    // It returns an image directly from the URL
    const encodedPrompt = encodeURIComponent(prompt);
    const width = 1024;
    const height = 1024;
    const seed = Math.floor(Math.random() * 1000000);
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
  }

  if (provider === 'flux' || provider === 'replicate') {
    if (!settings?.imageGenKey) {
      throw new Error("Image generation key is required for this provider");
    }
    // Placeholder for Replicate/Fal.ai implementation
    // For now, fallback to pollinations if key is missing or just return a placeholder
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux`;
  }

  return `https://placehold.co/1024x1024/0f172a/6366f1?text=${encodeURIComponent('Generation Error')}`;
};
