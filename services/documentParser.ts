import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// This is the most reliable way to load the worker in Vite
// It tells Vite to treat the worker as a separate asset and gives us the URL
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsedDocument {
  text: string;
  chunks: string[];
  metadata: {
    name: string;
    size: number;
    type: string;
  };
}

// Helper: Split text into meaningful chunks (roughly by paragraph or length)
const chunkText = (text: string, maxChunkSize = 1000): string[] => {
  const chunks: string[] = [];
  let currentChunk = '';

  // Split by double newline (paragraphs)
  const paragraphs = text.split(/\n\s*\n/); 

  for (const paragraph of paragraphs) {
    const cleanPara = paragraph.trim();
    if (!cleanPara) continue;

    if ((currentChunk + cleanPara).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = cleanPara;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + cleanPara;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  
  // Safety: If a single paragraph is massive, force split it
  return chunks.flatMap(c => {
      if (c.length > maxChunkSize * 1.5) {
          const regex = new RegExp('.{1,' + maxChunkSize + '}', 'g');
          return c.match(regex) || [c];
      }
      return [c];
  });
};

export const parseDocument = async (file: File): Promise<ParsedDocument> => {
  let text = '';

  try {
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: false
      });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n\n';
      }
      text = fullText;
    } 
    else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = result.value;
    } 
    else if (file.type === 'text/plain') {
      text = await file.text();
    } 
    else {
      // Try reading as text anyway for unknown types if they are text-like
      text = await file.text();
    }

    if (!text || text.trim().length === 0) {
        throw new Error('Document seems to be empty or unreadable.');
    }

    return {
      text,
      chunks: chunkText(text),
      metadata: {
        name: file.name,
        size: file.size,
        type: file.type
      }
    };
  } catch (err: any) {
    console.error("Parsing Error:", err);
    throw new Error(`Failed to parse ${file.name}: ${err.message}`);
  }
};
