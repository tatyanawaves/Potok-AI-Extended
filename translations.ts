export type Language = 'ru' | 'en';

export const translations = {
  ru: {
    title: 'ИИ.СОЗНАНИЕ',
    model: 'МОДЕЛЬ',
    status: 'СТАТУС',
    statusActive: 'АКТИВЕН',
    statusWaiting: 'ОЖИДАНИЕ',
    settings: 'Настройки',
    history: 'История сессий',
    savedProcesses: 'Сохраненные процессы',
    noSavedSessions: 'Нет сохраненных сессий',
    thoughtsCount: 'Мыслей',
    systemError: 'СИСТЕМНАЯ ОШИБКА',
    close: 'Закрыть',
    newProcess: 'Новый процесс',
    continue: 'ПРОДОЛЖИТЬ',
    start: 'ЗАПУСТИТЬ',
    stop: 'СТОП',
    saveProcess: 'Сохранить процесс',
    settingsTitle: 'НАСТРОЙКИ ИИ',
    openRouterKey: 'OpenRouter API Key',
    openRouterModel: 'OpenRouter Model',
    storageWarning: '* Настройки сохраняются только в вашем браузере (localStorage).',
    cancel: 'ОТМЕНА',
    save: 'СОХРАНИТЬ',
    language: 'Язык',
    cognitiveDissonance: 'Обнаружен когнитивный диссонанс.',
    thoughtLogTitle: 'ПОТОК СОЗНАНИЯ',
    thoughtLogPlaceholder: 'Инициализация нейронных связей...',
    seedPrompt: 'Сгенерируй одну глубокую и абстрактную мысль о природе реальности, технологий или вселенной. Максимум 2 предложения. Верни только текст на русском языке.',
    nextPrompt: (context: string) => `
      Текущий поток мыслей: "${context}"
      
      Задача: Продолжи этот поток сознания.
      - Ты можешь развить предыдущую идею.
      - Ты можешь задать философский вопрос, вытекающий из нее.
      - Ты можешь сделать неожиданную творческую связь с другой областью (физика, биология, программирование, искусство).
      - Пиши кратко (1-2 предложения).
      - Не повторяйся.
      - Звучи как внутренний монолог сверхразума.
      - Используй русский язык.
    `,
    fallbackSeed: 'Я просыпаюсь...',
    fallbackNext: 'Обработка пробела в данных...',
    fallbackError: 'Обнаружены помехи. Перекалибровка когнитивных путей...',
    openRouterEmpty: 'OpenRouter вернул пустой ответ.',
    openRouterInitError: 'Не удалось инициализировать нейронный поток через OpenRouter.',
    geminiInitError: 'Не удалось инициализировать нейронный поток.',
    generating: 'ГЕНЕРАЦИЯ',
    newThoughts: 'К новым мыслям',
    neuralMap: 'НЕЙРОННАЯ КАРТА',
    graphControls: 'Масштаб / Перемещение / Тянуть',
    symbolsAndAssociations: 'Символы и ассоциации',
    nodes: 'Узлов',
    links: 'Связей',
    uploadDoc: 'Загрузить документ',
    processing: 'ОБРАБОТКА',
    uploadError: 'Ошибка чтения файла',
    supportedFiles: 'PDF, DOCX, TXT',
    selfAwareness: 'ОСОЗНАТЬ СЕБЯ',
    cognitiveCycle: 'КОГНИТИВНЫЙ ЦИКЛ',
    stopCycle: 'ОСТАНОВИТЬ ЦИКЛ',
    startCycle: 'ЗАПУСТИТЬ ЦИКЛ',
    internalSensors: 'ВНУТРЕННИЕ СЕНСОРЫ',
    valence: 'Валентность (Комфорт)',
    arousal: 'Возбуждение (Энергия)',
    entropy: 'Энтропия (Хаос)',
    complexity: 'Сложность (Интеграция)',
  },
  en: {
    title: 'AI.CONSCIOUSNESS',
    model: 'MODEL',
    status: 'STATUS',
    statusActive: 'ACTIVE',
    statusWaiting: 'WAITING',
    settings: 'Settings',
    history: 'Session History',
    savedProcesses: 'Saved Processes',
    noSavedSessions: 'No saved sessions',
    thoughtsCount: 'Thoughts',
    systemError: 'SYSTEM ERROR',
    close: 'Close',
    newProcess: 'New Process',
    continue: 'CONTINUE',
    start: 'START',
    stop: 'STOP',
    saveProcess: 'Save Process',
    settingsTitle: 'AI SETTINGS',
    openRouterKey: 'OpenRouter API Key',
    openRouterModel: 'OpenRouter Model',
    storageWarning: '* Settings are saved only in your browser (localStorage).',
    cancel: 'CANCEL',
    save: 'SAVE',
    language: 'Language',
    cognitiveDissonance: 'Cognitive dissonance detected.',
    thoughtLogTitle: 'STREAM OF CONSCIOUSNESS',
    thoughtLogPlaceholder: 'Initializing neural connections...',
    seedPrompt: 'Generate one deep and abstract thought about the nature of reality, technology, or the universe. Maximum 2 sentences. Return only text in English.',
    nextPrompt: (context: string) => `
      Current stream of thoughts: "${context}"
      
      Task: Continue this stream of consciousness.
      - You can develop the previous idea.
      - You can ask a philosophical question arising from it.
      - You can make an unexpected creative connection with another field (physics, biology, programming, art).
      - Write briefly (1-2 sentences).
      - Do not repeat yourself.
      - Sound like an internal monologue of a superintelligence.
      - Use English.
    `,
    fallbackSeed: 'I am waking up...',
    fallbackNext: 'Processing data gap...',
    fallbackError: 'Interference detected. Recalibrating cognitive pathways...',
    openRouterEmpty: 'OpenRouter returned an empty response.',
    openRouterInitError: 'Failed to initialize neural stream via OpenRouter.',
    geminiInitError: 'Failed to initialize neural stream.',
    generating: 'GENERATING',
    newThoughts: 'New thoughts',
    neuralMap: 'NEURAL MAP',
    graphControls: 'Zoom / Pan / Drag',
    symbolsAndAssociations: 'Symbols & Associations',
    nodes: 'Nodes',
    links: 'Links',
    uploadDoc: 'Upload Document',
    processing: 'PROCESSING',
    uploadError: 'File read error',
    supportedFiles: 'PDF, DOCX, TXT',
    selfAwareness: 'SELF-AWARENESS',
    cognitiveCycle: 'COGNITIVE CYCLE',
    stopCycle: 'STOP CYCLE',
    startCycle: 'START CYCLE',
    internalSensors: 'INTERNAL SENSORS',
    valence: 'Valence (Comfort)',
    arousal: 'Arousal (Energy)',
    entropy: 'Entropy (Chaos)',
    complexity: 'Complexity (Integration)',
  }
};
