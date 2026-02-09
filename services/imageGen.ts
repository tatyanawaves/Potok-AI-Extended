import { AISettings } from "../types";

/**
 * In-memory cache for generated images to avoid re-fetching the same prompt.
 */
const imageCache = new Map<string, string>();

/**
 * Service for generating images via external APIs.
 */
export const generateImage = async (prompt: string, settings?: AISettings): Promise<string> => {
  const cacheKey = `${prompt}_${settings?.imageGenProvider || 'pollinations'}`;
  if (imageCache.has(cacheKey)) {
    console.log(`[ImageGen] Returning cached image for: ${prompt}`);
    return imageCache.get(cacheKey)!;
  }

  const provider = settings?.imageGenProvider || 'pollinations';
  let imageUrl = '';

  if (provider === 'pollinations') {
    const encodedPrompt = encodeURIComponent(prompt);
    const width = 1024;
    const height = 1024;
    const seed = Math.floor(Math.random() * 1000000);
    imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
  } else {
    // Fallback/Placeholder
    imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux`;
  }

  // ASYNCHRONOUS PRE-LOADING
  // We create a promise that resolves only when the image is actually downloaded by the browser
  try {
    console.log(`[ImageGen] Pre-loading image: ${imageUrl}`);
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(imageUrl);
      img.onerror = (e) => reject(e);
      img.src = imageUrl;
    });
    
    imageCache.set(cacheKey, imageUrl);
    return imageUrl;
  } catch (err) {
    console.warn("[ImageGen] Pre-loading failed, returning raw URL anyway", err);
    return imageUrl;
  }
};
